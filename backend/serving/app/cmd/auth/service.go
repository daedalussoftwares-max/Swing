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
)

var (
	ErrEmailInUse     = errors.New("email in use")
	ErrAccountNotFound = errors.New("account not found")
	ErrUserNotFound   = ErrAccountNotFound // controllers alias
	ErrWrongPassword  = errors.New("wrong password")
	ErrInvalidToken   = errors.New("invalid refresh token")
	ErrNothingToUpdate = errors.New("nothing to update")
	ErrInvalidInput   = errors.New("invalid input")
)

type Service struct {
	db               *sql.DB
	tokens           *TokenService
	googleClientIDs  []string
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
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthResponse{}, ErrAccountNotFound
		}
		return AuthResponse{}, err
	}
	if !passwordHash.Valid || !stdpasswd.Compare(passwordHash.String, password) {
		return AuthResponse{}, ErrWrongPassword
	}
	return s.issueSession(ctx, accountID)
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

	// Link to existing email/password account when email matches.
	err = s.db.QueryRowContext(ctx, `
		SELECT id FROM accounts WHERE email = $1
	`, info.Email).Scan(&accountID)
	if err == nil {
		_, err = s.db.ExecContext(ctx, `
			UPDATE accounts SET google_sub = $2, updated_at = NOW() WHERE id = $1
		`, accountID, info.Sub)
		if err != nil {
			if pg.IsUniqueViolation(err) {
				return AuthResponse{}, ErrEmailInUse
			}
			return AuthResponse{}, err
		}
		return s.issueSession(ctx, accountID)
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

func (s *Service) Refresh(ctx context.Context, refreshRaw string) (AuthResponse, error) {
	hash := HashRefreshToken(refreshRaw)
	var accountID stdid.UUID
	var tokenID stdid.UUID
	var expiresAt time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT id, account_id, expires_at
		FROM refresh_tokens
		WHERE token_hash = $1 AND revoked_at IS NULL
	`, hash).Scan(&tokenID, &accountID, &expiresAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthResponse{}, ErrInvalidToken
		}
		return AuthResponse{}, err
	}
	if time.Now().UTC().After(expiresAt) {
		return AuthResponse{}, ErrInvalidToken
	}

	_, _ = s.db.ExecContext(ctx, `
		UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1
	`, tokenID)

	return s.issueSession(ctx, accountID)
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
	refreshRaw, refreshHash, expiresAt, err := s.tokens.IssueRefresh()
	if err != nil {
		return AuthResponse{}, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO refresh_tokens (account_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, accountID, refreshHash, expiresAt)
	if err != nil {
		return AuthResponse{}, fmt.Errorf("insert refresh token: %w", err)
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
