package planes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"lib/stdid"
)

var (
	ErrNotFound           = errors.New("plane not found")
	ErrInvalidInput       = errors.New("invalid input")
	ErrNoCandidates       = errors.New("no matching recipients")
	ErrForbidden          = errors.New("forbidden")
	ErrExpired            = errors.New("plane expired")
	ErrAlreadyActed       = errors.New("already responded")
	ErrInsufficientPlanes = errors.New("insufficient planes")
)

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) TouchLastActive(ctx context.Context, accountID stdid.UUID) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO profile_stats (account_id, last_active_at, updated_at)
		VALUES ($1, NOW(), NOW())
		ON CONFLICT (account_id) DO UPDATE
		SET last_active_at = NOW(), updated_at = NOW()
	`, accountID)
	return err
}

func (s *Service) Send(ctx context.Context, senderID stdid.UUID, in SendInput) (Plane, error) {
	message := strings.TrimSpace(in.Message)
	if message == "" || len(message) > MaxMessageLen {
		return Plane{}, ErrInvalidInput
	}

	sender, err := s.loadProfile(ctx, senderID)
	if err != nil {
		return Plane{}, err
	}
	if err := s.TouchLastActive(ctx, senderID); err != nil {
		return Plane{}, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Plane{}, err
	}
	defer func() { _ = tx.Rollback() }()

	if err := spendPlaneTx(ctx, tx, senderID); err != nil {
		return Plane{}, err
	}

	recipient, err := s.pickRecipient(ctx, sender, in.Filters, nil)
	if err != nil {
		return Plane{}, err
	}

	plane, err := s.insertPlaneTx(ctx, tx, senderID, recipient, message, in.Filters)
	if err != nil {
		return Plane{}, err
	}

	if err := tx.Commit(); err != nil {
		return Plane{}, err
	}
	return plane, nil
}

func (s *Service) insertPlaneTx(
	ctx context.Context,
	tx *sql.Tx,
	senderID stdid.UUID,
	recipient Candidate,
	message string,
	filters Filters,
) (Plane, error) {
	planeID, err := stdid.New()
	if err != nil {
		return Plane{}, err
	}
	deliveryID, err := stdid.New()
	if err != nil {
		return Plane{}, err
	}

	now := time.Now().UTC()
	expires := now.Add(PlaneLifetime)
	filtersJSON, err := json.Marshal(filters)
	if err != nil {
		return Plane{}, err
	}

	status := StatusPending
	deliveryStatus := DeliveryPending

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO planes (
			id, sender_account_id, message, status, filters,
			recipient_is_dummy, expires_at, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
	`, planeID, senderID, message, status, filtersJSON, recipient.IsDummy, expires, now); err != nil {
		return Plane{}, err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO plane_deliveries (id, plane_id, recipient_account_id, status, delivered_at)
		VALUES ($1, $2, $3, $4, $5)
	`, deliveryID, planeID, recipient.AccountID, deliveryStatus, now); err != nil {
		return Plane{}, err
	}

	if !recipient.IsDummy {
		if err := touchLastActiveTx(ctx, tx, recipient.AccountID); err != nil {
			return Plane{}, err
		}
	}

	return Plane{
		ID:               planeID,
		Message:          message,
		Status:           status,
		Filters:          filters,
		SentAt:           now,
		ExpiresAt:        expires,
		RecipientIsDummy: recipient.IsDummy,
		Recipient:        recipientPreview(recipient),
	}, nil
}

func (s *Service) ListInbox(ctx context.Context, accountID stdid.UUID) ([]Plane, error) {
	if err := s.TouchLastActive(ctx, accountID); err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			pl.id, pl.message, pl.status, pl.filters, pl.created_at, pl.expires_at,
			pd.id, pd.status,
			s.account_id, s.name, s.username, s.avatar_url, s.city, s.country
		FROM plane_deliveries pd
		JOIN planes pl ON pl.id = pd.plane_id
		JOIN profiles s ON s.account_id = pl.sender_account_id
		WHERE pd.recipient_account_id = $1
		  AND pd.status = 'pending'
		  AND pl.status = 'pending'
		  AND pl.expires_at > NOW()
		ORDER BY pd.delivered_at DESC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	return scanInboundPlanes(rows)
}

func (s *Service) ListOutbox(ctx context.Context, accountID stdid.UUID) ([]Plane, error) {
	if err := s.TouchLastActive(ctx, accountID); err != nil {
		return nil, err
	}
	if err := s.settleDummyAccepts(ctx, accountID); err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			pl.id, pl.message, pl.status, pl.filters, pl.created_at, pl.expires_at,
			pl.recipient_is_dummy,
			pd.status, pd.responded_at,
			r.account_id, r.name, r.username, r.avatar_url, r.city, r.country
		FROM planes pl
		LEFT JOIN LATERAL (
			SELECT recipient_account_id, status, responded_at, delivered_at
			FROM plane_deliveries
			WHERE plane_id = pl.id
			ORDER BY delivered_at DESC
			LIMIT 1
		) pd ON TRUE
		LEFT JOIN profiles r ON r.account_id = pd.recipient_account_id
		WHERE pl.sender_account_id = $1
		ORDER BY pl.created_at DESC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Plane
	for rows.Next() {
		var p Plane
		var filtersJSON []byte
		var deliveryStatus sql.NullString
		var respondedAt sql.NullTime
		var recipientID stdid.UUID
		var recipientName, recipientUsername, recipientAvatar, recipientCity, recipientCountry sql.NullString

		if err := rows.Scan(
			&p.ID, &p.Message, &p.Status, &filtersJSON, &p.SentAt, &p.ExpiresAt,
			&p.RecipientIsDummy,
			&deliveryStatus, &respondedAt,
			&recipientID, &recipientName, &recipientUsername, &recipientAvatar, &recipientCity, &recipientCountry,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(filtersJSON, &p.Filters)
		if respondedAt.Valid {
			t := respondedAt.Time
			p.RespondedAt = &t
		}
		if recipientID != (stdid.UUID{}) {
			p.Recipient = &RecipientPreview{
				ID:        recipientID,
				Name:      coalesceName(recipientName.String, recipientUsername.String),
				AvatarURL: recipientAvatar.String,
				Location:  formatLocation(recipientCity.String, recipientCountry.String),
			}
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Service) Accept(ctx context.Context, accountID, planeID stdid.UUID) (Plane, error) {
	if err := s.TouchLastActive(ctx, accountID); err != nil {
		return Plane{}, err
	}
	return s.respond(ctx, accountID, planeID, DeliveryAccepted)
}

func (s *Service) Reject(ctx context.Context, accountID, planeID stdid.UUID) (Plane, error) {
	if err := s.TouchLastActive(ctx, accountID); err != nil {
		return Plane{}, err
	}
	return s.respond(ctx, accountID, planeID, DeliveryRejected)
}

func (s *Service) respond(
	ctx context.Context,
	accountID, planeID stdid.UUID,
	action DeliveryStatus,
) (Plane, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Plane{}, err
	}
	defer func() { _ = tx.Rollback() }()

	var senderID stdid.UUID
	var message string
	var status Status
	var filtersJSON []byte
	var expiresAt time.Time
	var sentAt time.Time
	var deliveryID stdid.UUID
	var deliveryStatus DeliveryStatus

	err = tx.QueryRowContext(ctx, `
		SELECT
			pl.sender_account_id, pl.message, pl.status, pl.filters, pl.expires_at, pl.created_at,
			pd.id, pd.status
		FROM planes pl
		JOIN plane_deliveries pd ON pd.plane_id = pl.id
		WHERE pl.id = $1
		  AND pd.recipient_account_id = $2
		  AND pd.status = 'pending'
		  AND pl.status = 'pending'
		ORDER BY pd.delivered_at DESC
		LIMIT 1
		FOR UPDATE OF pl, pd
	`, planeID, accountID).Scan(
		&senderID, &message, &status, &filtersJSON, &expiresAt, &sentAt,
		&deliveryID, &deliveryStatus,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Plane{}, ErrNotFound
		}
		return Plane{}, err
	}
	if time.Now().UTC().After(expiresAt) {
		_, _ = tx.ExecContext(ctx, `UPDATE planes SET status = 'expired', updated_at = NOW() WHERE id = $1`, planeID)
		if err := tx.Commit(); err != nil {
			return Plane{}, err
		}
		return Plane{}, ErrExpired
	}

	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `
		UPDATE plane_deliveries
		SET status = $2, responded_at = $3
		WHERE id = $1
	`, deliveryID, action, now); err != nil {
		return Plane{}, err
	}

	var filters Filters
	_ = json.Unmarshal(filtersJSON, &filters)

	if action == DeliveryAccepted {
		chatUUID, err := finalizeRealAcceptTx(ctx, tx, planeID, senderID, accountID, now)
		if err != nil {
			return Plane{}, err
		}
		if err := tx.Commit(); err != nil {
			return Plane{}, err
		}
		chatID := chatUUID.String()
		return Plane{
			ID:          planeID,
			Message:     message,
			Status:      StatusAccepted,
			Filters:     filters,
			SentAt:      sentAt,
			ExpiresAt:   expiresAt,
			RespondedAt: &now,
			ChatID:      &chatID,
		}, nil
	}

	// Reject → try next recipient inside the same transaction context.
	sender, err := s.loadProfileTx(ctx, tx, senderID)
	if err != nil {
		return Plane{}, err
	}

	recipient, pickErr := s.pickRecipient(ctx, sender, filters, &planeID)
	if pickErr != nil {
		if _, err := tx.ExecContext(ctx, `
			UPDATE planes SET status = 'expired', updated_at = $2 WHERE id = $1
		`, planeID, now); err != nil {
			return Plane{}, err
		}
		if err := tx.Commit(); err != nil {
			return Plane{}, err
		}
		return Plane{
			ID:          planeID,
			Message:     message,
			Status:      StatusExpired,
			Filters:     filters,
			SentAt:      sentAt,
			ExpiresAt:   expiresAt,
			RespondedAt: &now,
		}, nil
	}

	nextDeliveryID, err := stdid.New()
	if err != nil {
		return Plane{}, err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE planes SET recipient_is_dummy = $2, updated_at = $3 WHERE id = $1
	`, planeID, recipient.IsDummy, now); err != nil {
		return Plane{}, err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO plane_deliveries (id, plane_id, recipient_account_id, status, delivered_at)
		VALUES ($1, $2, $3, 'pending', $4)
	`, nextDeliveryID, planeID, recipient.AccountID, now); err != nil {
		return Plane{}, err
	}
	if !recipient.IsDummy {
		if err := touchLastActiveTx(ctx, tx, recipient.AccountID); err != nil {
			return Plane{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Plane{}, err
	}

	return Plane{
		ID:               planeID,
		Message:          message,
		Status:           StatusPending,
		Filters:          filters,
		SentAt:           sentAt,
		ExpiresAt:        expiresAt,
		RespondedAt:      &now,
		RecipientIsDummy: recipient.IsDummy,
		Recipient:        recipientPreview(recipient),
	}, nil
}

func (s *Service) loadProfile(ctx context.Context, accountID stdid.UUID) (Profile, error) {
	return s.loadProfileTx(ctx, s.db, accountID)
}

func (s *Service) loadProfileTx(ctx context.Context, q sqlQuerier, accountID stdid.UUID) (Profile, error) {
	var p Profile
	var name, username, avatar, city, country, gender, interests sql.NullString
	var dob sql.NullTime
	var lastActive sql.NullTime
	err := q.QueryRowContext(ctx, `
		SELECT
			p.account_id, p.interests, p.created_at,
			p.name, p.username, p.avatar_url, p.city, p.country, p.gender, p.dob,
			ps.last_active_at
		FROM profiles p
		LEFT JOIN profile_stats ps ON ps.account_id = p.account_id
		WHERE p.account_id = $1
	`, accountID).Scan(
		&p.AccountID, &interests, &p.CreatedAt,
		&name, &username, &avatar, &city, &country, &gender, &dob,
		&lastActive,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Profile{}, ErrNotFound
		}
		return Profile{}, err
	}
	p.Interests = interests.String
	p.Name = name.String
	p.Username = username.String
	p.AvatarURL = avatar.String
	p.City = city.String
	p.Country = country.String
	p.Gender = gender.String
	if dob.Valid {
		t := dob.Time
		p.DOB = &t
	}
	if lastActive.Valid {
		p.LastActiveAt = lastActive.Time
	} else {
		p.LastActiveAt = p.CreatedAt
	}
	return p, nil
}

type sqlQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func touchLastActiveTx(ctx context.Context, tx *sql.Tx, accountID stdid.UUID) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO profile_stats (account_id, last_active_at, updated_at)
		VALUES ($1, NOW(), NOW())
		ON CONFLICT (account_id) DO UPDATE
		SET last_active_at = NOW(), updated_at = NOW()
	`, accountID)
	return err
}

func scanInboundPlanes(rows *sql.Rows) ([]Plane, error) {
	var out []Plane
	for rows.Next() {
		var p Plane
		var filtersJSON []byte
		var deliveryID stdid.UUID
		var deliveryStatus DeliveryStatus
		var sender SenderPreview

		var senderName sql.NullString
		var senderUsername sql.NullString

		if err := rows.Scan(
			&p.ID, &p.Message, &p.Status, &filtersJSON, &p.SentAt, &p.ExpiresAt,
			&deliveryID, &deliveryStatus,
			&sender.ID, &senderName, &senderUsername, &sender.AvatarURL, &sender.City, &sender.Country,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(filtersJSON, &p.Filters)
		sender.Name = coalesceName(senderName.String, senderUsername.String)
		p.Sender = &sender
		out = append(out, p)
	}
	return out, rows.Err()
}

func recipientPreview(c Candidate) *RecipientPreview {
	return &RecipientPreview{
		ID:        c.AccountID,
		Name:      coalesceName(c.Name, c.Username),
		AvatarURL: c.AvatarURL,
		Location:  formatLocation(c.City, c.Country),
	}
}

func coalesceName(name, username string) string {
	if strings.TrimSpace(name) != "" {
		return strings.TrimSpace(name)
	}
	if strings.TrimSpace(username) != "" {
		return "@" + strings.TrimSpace(username)
	}
	return "Anonymous"
}

func formatLocation(city, country string) string {
	city = strings.TrimSpace(city)
	country = strings.TrimSpace(country)
	switch {
	case city != "" && country != "":
		return fmt.Sprintf("%s, %s", city, country)
	case city != "":
		return city
	default:
		return country
	}
}
