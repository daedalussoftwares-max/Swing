package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"lib/pg"
	"lib/stdid"
	"lib/stdpasswd"

	"serving/app/pkg/logx"
)

var (
	ErrEmailInUse      = errors.New("email in use")
	ErrAccountNotFound = errors.New("account not found")
	ErrUserNotFound    = ErrAccountNotFound // controllers alias
	// ErrInvalidCredentials is the single login failure: unknown email,
	// wrong password and Google-only accounts are indistinguishable.
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrWrongPassword      = ErrInvalidCredentials
	ErrPasswordTooLong    = stdpasswd.ErrPasswordTooLong
	ErrInvalidToken       = errors.New("invalid refresh token")
	ErrNothingToUpdate    = errors.New("nothing to update")
	ErrInvalidInput       = errors.New("invalid input")
)

type Service struct {
	db              *sql.DB
	tokens          *TokenService
	googleClientIDs []string
}

func NewService(database *sql.DB, tokens *TokenService, googleClientIDs []string) *Service {
	return &Service{db: database, tokens: tokens, googleClientIDs: googleClientIDs}
}

func normalizeEmail(email string) string {
	return strings.TrimSpace(strings.ToLower(email))
}

func (s *Service) Register(ctx context.Context, email, password string) (AuthResponse, error) {
	email = normalizeEmail(email)
	hash, err := stdpasswd.Hash(password)
	if err != nil {
		return AuthResponse{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return AuthResponse{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var accountID stdid.UUID
	err = tx.QueryRowContext(ctx, `
		INSERT INTO accounts (email, password_hash)
		VALUES ($1, $2)
		RETURNING id
	`, email, hash).Scan(&accountID)
	if err != nil {
		if pg.IsUniqueViolation(err) {
			return AuthResponse{}, ErrEmailInUse
		}
		return AuthResponse{}, fmt.Errorf("register insert account: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO profiles (account_id) VALUES ($1)
	`, accountID); err != nil {
		return AuthResponse{}, fmt.Errorf("register insert profile: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO profile_stats (account_id, planes_remaining) VALUES ($1, $2)
	`, accountID, 5); err != nil {
		return AuthResponse{}, fmt.Errorf("register insert profile_stats: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return AuthResponse{}, err
	}
	return s.issueSession(ctx, accountID)
}

func (s *Service) Login(ctx context.Context, email, password string) (AuthResponse, error) {
	email = normalizeEmail(email)
	var accountID stdid.UUID
	var passwordHash sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT id, password_hash FROM accounts WHERE email = $1
	`, email).Scan(&accountID, &passwordHash)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return AuthResponse{}, err
	}
	if err != nil || !passwordHash.Valid {
		// Unknown email or Google-only account: spend the same CPU as a real
		// check so timing doesn't reveal which accounts exist.
		stdpasswd.CompareDummy(password)
		return AuthResponse{}, ErrInvalidCredentials
	}
	if !stdpasswd.Compare(passwordHash.String, password) {
		return AuthResponse{}, ErrInvalidCredentials
	}
	if stdpasswd.NeedsRehash(passwordHash.String) {
		s.upgradePasswordHash(ctx, accountID, passwordHash.String, password)
	}
	return s.issueSession(ctx, accountID)
}

// upgradePasswordHash transparently replaces a legacy (or low-cost) hash
// after a successful login. One-time cost per account; failures are logged
// and never block the login.
func (s *Service) upgradePasswordHash(ctx context.Context, accountID stdid.UUID, oldHash, password string) {
	newHash, err := stdpasswd.Hash(password)
	if err != nil {
		// e.g. legacy password longer than bcrypt's 72-byte limit; keep the old hash.
		logx.Warn("auth: password rehash skipped", "account_id", accountID.String(), "err", err.Error())
		return
	}
	// Compare-and-swap on the old hash so a concurrent password change wins.
	if _, err := s.db.ExecContext(ctx, `
		UPDATE accounts SET password_hash = $3, updated_at = NOW()
		WHERE id = $1 AND password_hash = $2
	`, accountID, oldHash, newHash); err != nil {
		logx.Error("auth: password rehash failed", err, "account_id", accountID.String())
	}
}

func (s *Service) LoginGoogle(ctx context.Context, idToken string) (AuthResponse, error) {
	info, err := VerifyGoogleIDToken(ctx, s.googleClientIDs, idToken)
	if err != nil {
		return AuthResponse{}, err
	}

	var accountID stdid.UUID
	err = s.db.QueryRowContext(ctx, `
		SELECT id FROM accounts WHERE google_sub = $1
	`, info.Sub).Scan(&accountID)
	if err == nil {
		return s.issueSession(ctx, accountID)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return AuthResponse{}, err
	}

	// Link to an existing email/password account when the email matches.
	// Register never verifies email ownership, so anyone could have
	// pre-registered this address. A verified Google token proves ownership:
	// drop the password and revoke every refresh token so a squatter loses
	// access, then issue the new session. One statement = atomic and one
	// round trip.
	//
	// Revoked tokens are backdated past Refresh's rotation grace window
	// (refreshGrace), otherwise a just-revoked token could still be rotated.
	// Accounts already linked to a different Google sub are never relinked
	// (they fall through to the insert below and fail with ErrEmailInUse).
	err = s.db.QueryRowContext(ctx, `
		WITH linked AS (
			UPDATE accounts
			SET google_sub = $2, password_hash = NULL, updated_at = NOW()
			WHERE email = $1 AND google_sub IS NULL
			RETURNING id
		), revoked AS (
			UPDATE refresh_tokens rt
			SET revoked_at = NOW() - INTERVAL '1 day'
			FROM linked
			WHERE rt.account_id = linked.id
			  AND (rt.revoked_at IS NULL OR rt.revoked_at > NOW() - INTERVAL '1 day')
		)
		SELECT id FROM linked
	`, info.Email, info.Sub).Scan(&accountID)
	if err == nil {
		return s.issueSession(ctx, accountID)
	}
	if pg.IsUniqueViolation(err) {
		return AuthResponse{}, ErrEmailInUse
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return AuthResponse{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return AuthResponse{}, err
	}
	defer func() { _ = tx.Rollback() }()

	err = tx.QueryRowContext(ctx, `
		INSERT INTO accounts (email, google_sub)
		VALUES ($1, $2)
		RETURNING id
	`, info.Email, info.Sub).Scan(&accountID)
	if err != nil {
		if pg.IsUniqueViolation(err) {
			return AuthResponse{}, ErrEmailInUse
		}
		return AuthResponse{}, fmt.Errorf("google insert account: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO profiles (account_id) VALUES ($1)
	`, accountID); err != nil {
		return AuthResponse{}, fmt.Errorf("google insert profile: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO profile_stats (account_id, planes_remaining) VALUES ($1, $2)
	`, accountID, 5); err != nil {
		return AuthResponse{}, fmt.Errorf("google insert profile_stats: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return AuthResponse{}, err
	}
	return s.issueSession(ctx, accountID)
}

// refreshGrace lets a just-rotated refresh token be presented again for a
// short while. Mobile clients routinely lose the refresh response (app
// backgrounded, network drop); without a grace window that lost response
// would leave them holding a dead token and they'd be logged out.
const refreshGrace = 60 * time.Second

// Refresh rotates a refresh token. Claiming the old token and storing the
// new one happen in one transaction, so a failure can never leave the
// client without a valid token.
func (s *Service) Refresh(ctx context.Context, refreshRaw string) (AuthResponse, error) {
	hash := HashRefreshToken(refreshRaw)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return AuthResponse{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var accountID stdid.UUID
	err = tx.QueryRowContext(ctx, `
		UPDATE refresh_tokens
		SET revoked_at = COALESCE(revoked_at, NOW())
		WHERE token_hash = $1
		  AND expires_at > NOW()
		  AND (revoked_at IS NULL OR revoked_at > NOW() - make_interval(secs => $2))
		RETURNING account_id
	`, hash, refreshGrace.Seconds()).Scan(&accountID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthResponse{}, ErrInvalidToken
		}
		return AuthResponse{}, err
	}

	refreshNew, err := s.insertRefreshToken(ctx, tx, accountID)
	if err != nil {
		return AuthResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return AuthResponse{}, err
	}

	me, err := s.GetMe(ctx, accountID)
	if err != nil {
		return AuthResponse{}, err
	}
	access, _, err := s.tokens.IssueAccess(accountID)
	if err != nil {
		return AuthResponse{}, err
	}
	return AuthResponse{User: me, AccessToken: access, RefreshToken: refreshNew}, nil
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func (s *Service) insertRefreshToken(ctx context.Context, db execer, accountID stdid.UUID) (string, error) {
	refreshRaw, refreshHash, expiresAt, err := s.tokens.IssueRefresh()
	if err != nil {
		return "", err
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO refresh_tokens (account_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, accountID, refreshHash, expiresAt); err != nil {
		return "", fmt.Errorf("insert refresh token: %w", err)
	}
	return refreshRaw, nil
}

func (s *Service) Logout(ctx context.Context, refreshRaw string) error {
	hash := HashRefreshToken(refreshRaw)
	_, err := s.db.ExecContext(ctx, `
		UPDATE refresh_tokens SET revoked_at = NOW()
		WHERE token_hash = $1 AND revoked_at IS NULL
	`, hash)
	return err
}

func (s *Service) GetMe(ctx context.Context, accountID stdid.UUID) (MeUser, error) {
	a, p, err := s.loadAccountProfile(ctx, accountID)
	if err != nil {
		return MeUser{}, err
	}
	return ToMeUser(a, p), nil
}

func (s *Service) IsUsernameAvailable(ctx context.Context, username string) (bool, error) {
	if err := ValidateUsername(username); err != nil {
		return false, err
	}
	username = NormalizeUsername(username)
	var exists bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM profiles WHERE username = $1)
	`, username).Scan(&exists)
	if err != nil {
		return false, err
	}
	return !exists, nil
}

func (s *Service) UpdateProfile(ctx context.Context, accountID stdid.UUID, patch ProfilePatch) (MeUser, error) {
	if patch.Username == nil && patch.Name == nil && patch.Dob == nil &&
		patch.Gender == nil && patch.Bio == nil && patch.Interests == nil &&
		patch.City == nil && patch.Country == nil && patch.AvatarURL == nil &&
		patch.ProfileComplete == nil {
		return MeUser{}, ErrNothingToUpdate
	}

	if patch.Username != nil {
		if err := ValidateUsername(*patch.Username); err != nil {
			return MeUser{}, err
		}
	}
	if err := validateProfileLengths(patch); err != nil {
		return MeUser{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MeUser{}, err
	}
	defer func() { _ = tx.Rollback() }()

	if patch.Username != nil {
		norm := NormalizeUsername(*patch.Username)
		_, err = tx.ExecContext(ctx, `
			UPDATE profiles SET username = $2, updated_at = NOW()
			WHERE account_id = $1
		`, accountID, norm)
		if err != nil {
			if pg.IsUniqueViolation(err) {
				return MeUser{}, ErrUsernameTaken
			}
			return MeUser{}, err
		}
	}
	if patch.Name != nil {
		_, err = tx.ExecContext(ctx, `
			UPDATE profiles SET name = $2, updated_at = NOW() WHERE account_id = $1
		`, accountID, strings.TrimSpace(*patch.Name))
		if err != nil {
			return MeUser{}, err
		}
	}
	if patch.Dob != nil {
		d, err := time.Parse("2006-01-02", strings.TrimSpace(*patch.Dob))
		if err != nil {
			return MeUser{}, ErrInvalidInput
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE profiles SET dob = $2, updated_at = NOW() WHERE account_id = $1
		`, accountID, d)
		if err != nil {
			return MeUser{}, err
		}
	}
	if patch.Gender != nil {
		g := strings.TrimSpace(*patch.Gender)
		if g != "M" && g != "F" && g != "NB" {
			return MeUser{}, ErrInvalidInput
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE profiles SET gender = $2, updated_at = NOW() WHERE account_id = $1
		`, accountID, g)
		if err != nil {
			return MeUser{}, err
		}
	}
	if patch.Bio != nil {
		_, err = tx.ExecContext(ctx, `
			UPDATE profiles SET bio = $2, updated_at = NOW() WHERE account_id = $1
		`, accountID, strings.TrimSpace(*patch.Bio))
		if err != nil {
			return MeUser{}, err
		}
	}
	if patch.Interests != nil {
		_, err = tx.ExecContext(ctx, `
			UPDATE profiles SET interests = $2, updated_at = NOW() WHERE account_id = $1
		`, accountID, NormalizeInterests(*patch.Interests))
		if err != nil {
			return MeUser{}, err
		}
	}
	if patch.City != nil {
		_, err = tx.ExecContext(ctx, `
			UPDATE profiles SET city = $2, updated_at = NOW() WHERE account_id = $1
		`, accountID, strings.TrimSpace(*patch.City))
		if err != nil {
			return MeUser{}, err
		}
	}
	if patch.Country != nil {
		_, err = tx.ExecContext(ctx, `
			UPDATE profiles SET country = $2, updated_at = NOW() WHERE account_id = $1
		`, accountID, strings.TrimSpace(*patch.Country))
		if err != nil {
			return MeUser{}, err
		}
	}
	if patch.AvatarURL != nil {
		_, err = tx.ExecContext(ctx, `
			UPDATE profiles SET avatar_url = $2, updated_at = NOW() WHERE account_id = $1
		`, accountID, strings.TrimSpace(*patch.AvatarURL))
		if err != nil {
			return MeUser{}, err
		}
	}
	if patch.ProfileComplete != nil {
		_, err = tx.ExecContext(ctx, `
			UPDATE profiles SET profile_complete = $2, updated_at = NOW() WHERE account_id = $1
		`, accountID, *patch.ProfileComplete)
		if err != nil {
			return MeUser{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return MeUser{}, err
	}
	return s.GetMe(ctx, accountID)
}

func (s *Service) DeleteAccount(ctx context.Context, accountID stdid.UUID) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM accounts WHERE id = $1`, accountID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrAccountNotFound
	}
	return nil
}

// SetProfileComplete kept for backward-compatible thin PATCH calls.
func (s *Service) SetProfileComplete(ctx context.Context, accountID stdid.UUID, complete bool) (MeUser, error) {
	return s.UpdateProfile(ctx, accountID, ProfilePatch{ProfileComplete: &complete})
}

func (s *Service) issueSession(ctx context.Context, accountID stdid.UUID) (AuthResponse, error) {
	me, err := s.GetMe(ctx, accountID)
	if err != nil {
		return AuthResponse{}, err
	}
	access, _, err := s.tokens.IssueAccess(accountID)
	if err != nil {
		return AuthResponse{}, err
	}
	refreshRaw, err := s.insertRefreshToken(ctx, s.db, accountID)
	if err != nil {
		return AuthResponse{}, err
	}
	return AuthResponse{
		User:         me,
		AccessToken:  access,
		RefreshToken: refreshRaw,
	}, nil
}

func (s *Service) loadAccountProfile(ctx context.Context, accountID stdid.UUID) (accountCredentials, profileRecord, error) {
	var a accountCredentials
	var p profileRecord
	err := s.db.QueryRowContext(ctx, `
		SELECT a.id, a.email, a.password_hash, a.google_sub, a.created_at,
		       p.account_id, p.username, p.name, p.dob, p.gender, p.bio,
		       p.interests, p.city, p.country, p.avatar_url, p.profile_complete,
		       COALESCE(ps.planes_remaining, 5)
		FROM accounts a
		JOIN profiles p ON p.account_id = a.id
		LEFT JOIN profile_stats ps ON ps.account_id = a.id
		WHERE a.id = $1
	`, accountID).Scan(
		&a.ID, &a.Email, &a.PasswordHash, &a.GoogleSub, &a.CreatedAt,
		&p.AccountID, &p.Username, &p.Name, &p.Dob, &p.Gender, &p.Bio,
		&p.Interests, &p.City, &p.Country, &p.AvatarURL, &p.ProfileComplete,
		&p.PlanesRemaining,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return accountCredentials{}, profileRecord{}, ErrAccountNotFound
		}
		return accountCredentials{}, profileRecord{}, err
	}
	return a, p, nil
}
