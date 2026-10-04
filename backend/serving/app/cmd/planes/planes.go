package planes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"lib/stdid"

	"serving/app/pkg/logx"
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

// MaxOutboxItems caps GET /v1/planes/outbox.
const MaxOutboxItems = 200

type Service struct {
	db     *sql.DB
	events EventSink
	rt     Notifier

	jobs          chan job
	blocksEnabled atomic.Bool
	started       atomic.Bool
	runCtx        context.Context
	cancel        context.CancelFunc
	wg            sync.WaitGroup
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db, jobs: make(chan job, DispatchQueueSize)}
}

func (s *Service) SetEventSink(sink EventSink) {
	s.events = sink
}

// SetRealtime wires realtime pushes (plane.outbox.updated / plane.inbox.updated).
func (s *Service) SetRealtime(n Notifier) {
	s.rt = n
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

// SendResult is what POST /v1/planes returns.
type SendResult struct {
	Plane           Plane
	PlanesRemaining int
}

// Send validates, spends one plane and stores the plane in a single statement,
// then hands matching to the async dispatcher. It never waits for matching.
func (s *Service) Send(ctx context.Context, senderID stdid.UUID, in SendInput) (SendResult, error) {
	message := strings.TrimSpace(in.Message)
	if message == "" || utf8.RuneCountInString(message) > MaxMessageLen {
		return SendResult{}, ErrInvalidInput
	}
	filters, err := normalizeFilters(in.Filters)
	if err != nil {
		return SendResult{}, err
	}
	filtersJSON, err := json.Marshal(filters)
	if err != nil {
		return SendResult{}, err
	}
	planeID, err := stdid.New()
	if err != nil {
		return SendResult{}, err
	}
	now := time.Now().UTC()
	expires := now.Add(PlaneLifetime)

	// One round trip, atomic: spend (creating the stats row with the initial
	// balance if missing, and bumping last_active_at) and insert the plane only
	// if the spend succeeded.
	var remaining int
	err = s.db.QueryRowContext(ctx, `
		WITH spend AS (
			INSERT INTO profile_stats (account_id, last_active_at, updated_at, planes_remaining)
			VALUES ($1::uuid, NOW(), NOW(), $7::int - 1)
			ON CONFLICT (account_id) DO UPDATE
			SET planes_remaining = profile_stats.planes_remaining - 1,
			    last_active_at = NOW(),
			    updated_at = NOW()
			WHERE profile_stats.planes_remaining > 0
			RETURNING planes_remaining
		), ins AS (
			INSERT INTO planes (
				id, sender_account_id, message, status, filters, recipient_is_dummy,
				expires_at, created_at, updated_at, next_attempt_at, dispatch_attempts
			)
			SELECT $2::uuid, $1::uuid, $3::text, 'pending', $4::jsonb, FALSE,
			       $5::timestamptz, $6::timestamptz, $6::timestamptz, $6::timestamptz, 0
			FROM spend
			RETURNING id
		)
		SELECT spend.planes_remaining FROM spend JOIN ins ON TRUE
	`, senderID, planeID, message, string(filtersJSON), expires, now, InitialPlaneBalance).Scan(&remaining)
	if errors.Is(err, sql.ErrNoRows) {
		return SendResult{}, ErrInsufficientPlanes
	}
	if err != nil {
		return SendResult{}, err
	}

	s.enqueue(job{kind: jobDispatch, planeID: planeID})
	logx.Info("plane accepted for dispatch",
		"plane_id", planeID.String(),
		"sender_id", senderID.String(),
		"filters_default", filtersAreDefault(filters),
		"planes_remaining", remaining,
	)
	return SendResult{
		Plane: Plane{
			ID:        planeID,
			Message:   message,
			Status:    StatusPending,
			State:     StateSearching,
			Filters:   filters,
			SentAt:    now,
			ExpiresAt: expires,
		},
		PlanesRemaining: remaining,
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

	planes, err := scanInboundPlanes(rows)
	if err != nil {
		return nil, err
	}
	logx.Info("planes inbox listed",
		"recipient_id", accountID.String(),
		"count", len(planes),
	)
	return planes, nil
}

// deriveState maps storage columns to the sender-facing State.
func deriveState(status Status, searching bool, latestDelivery DeliveryStatus, expiresAt, now time.Time) State {
	switch {
	case status == StatusAccepted:
		return StateAccepted
	case status == StatusExpired || !now.Before(expiresAt):
		return StateExpired
	case !searching && latestDelivery == DeliveryPending:
		return StateDelivered
	default:
		return StateSearching
	}
}

func (s *Service) ListOutbox(ctx context.Context, accountID stdid.UUID) ([]Plane, error) {
	if err := s.TouchLastActive(ctx, accountID); err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			pl.id, pl.message, pl.status, pl.filters, pl.created_at, pl.expires_at,
			pl.recipient_is_dummy, pl.next_attempt_at IS NOT NULL,
			ld.status, ld.responded_at, ld.recipient_account_id,
			r.name, r.username, r.avatar_url, r.city, r.country,
			COALESCE(cnt.hops, 0), COALESCE(cnt.rejections, 0),
			ch.id
		FROM planes pl
		LEFT JOIN LATERAL (
			SELECT recipient_account_id, status, responded_at
			FROM plane_deliveries
			WHERE plane_id = pl.id
			ORDER BY delivered_at DESC, id DESC
			LIMIT 1
		) ld ON TRUE
		LEFT JOIN profiles r ON r.account_id = ld.recipient_account_id
		LEFT JOIN LATERAL (
			SELECT COUNT(*)::int AS hops,
			       COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejections
			FROM plane_deliveries
			WHERE plane_id = pl.id
		) cnt ON TRUE
		LEFT JOIN chats ch
			ON pl.status = 'accepted'
		   AND NOT pl.recipient_is_dummy
		   AND ch.account_a = LEAST(pl.sender_account_id, ld.recipient_account_id)
		   AND ch.account_b = GREATEST(pl.sender_account_id, ld.recipient_account_id)
		WHERE pl.sender_account_id = $1
		ORDER BY pl.created_at DESC
		LIMIT $2
	`, accountID, MaxOutboxItems)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	now := time.Now().UTC()
	var out []Plane
	for rows.Next() {
		var p Plane
		var filtersJSON []byte
		var searching bool
		var deliveryStatus sql.NullString
		var respondedAt sql.NullTime
		var recipientID sql.Null[stdid.UUID]
		var chatID sql.Null[stdid.UUID]
		var rName, rUsername, rAvatar, rCity, rCountry sql.NullString

		if err := rows.Scan(
			&p.ID, &p.Message, &p.Status, &filtersJSON, &p.SentAt, &p.ExpiresAt,
			&p.RecipientIsDummy, &searching,
			&deliveryStatus, &respondedAt, &recipientID,
			&rName, &rUsername, &rAvatar, &rCity, &rCountry,
			&p.Hops, &p.Rejections,
			&chatID,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(filtersJSON, &p.Filters)
		p.State = deriveState(p.Status, searching, DeliveryStatus(deliveryStatus.String), p.ExpiresAt, now)
		if p.State == StateExpired {
			p.Status = StatusExpired
		}
		if respondedAt.Valid && (p.State == StateAccepted || p.State == StateDelivered) {
			t := respondedAt.Time
			p.RespondedAt = &t
		}
		if recipientID.Valid && (p.State == StateDelivered || p.State == StateAccepted) {
			p.Recipient = &RecipientPreview{
				ID:        recipientID.V,
				Name:      coalesceName(rName.String, rUsername.String),
				AvatarURL: rAvatar.String,
				Location:  formatLocation(rCity.String, rCountry.String),
			}
		}
		if chatID.Valid {
			id := chatID.V.String()
			p.ChatID = &id
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
	var filtersJSON []byte
	var expiresAt time.Time
	var sentAt time.Time
	var deliveryID stdid.UUID

	err = tx.QueryRowContext(ctx, `
		SELECT
			pl.sender_account_id, pl.message, pl.filters, pl.expires_at, pl.created_at,
			pd.id
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
		&senderID, &message, &filtersJSON, &expiresAt, &sentAt, &deliveryID,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Plane{}, ErrNotFound
		}
		return Plane{}, err
	}
	var filters Filters
	_ = json.Unmarshal(filtersJSON, &filters)

	now := time.Now().UTC()
	if !now.Before(expiresAt) {
		if _, err := tx.ExecContext(ctx, `
			UPDATE planes SET status = 'expired', next_attempt_at = NULL, updated_at = NOW() WHERE id = $1
		`, planeID); err != nil {
			return Plane{}, err
		}
		hops, rejections, err := planeCounts(ctx, tx, planeID)
		if err != nil {
			return Plane{}, err
		}
		if err := tx.Commit(); err != nil {
			return Plane{}, err
		}
		s.notifyOutbox(senderID, OutboxEvent{
			PlaneID: planeID.String(), State: StateExpired, Status: StatusExpired,
			Hops: hops, Rejections: rejections,
		})
		return Plane{}, ErrExpired
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE plane_deliveries
		SET status = $2, responded_at = $3
		WHERE id = $1 AND status = 'pending'
	`, deliveryID, action, now); err != nil {
		return Plane{}, err
	}

	if action == DeliveryAccepted {
		chatUUID, err := finalizeRealAcceptTx(ctx, tx, planeID, senderID, accountID, now)
		if err != nil {
			return Plane{}, err
		}
		hops, rejections, err := planeCounts(ctx, tx, planeID)
		if err != nil {
			return Plane{}, err
		}
		if err := tx.Commit(); err != nil {
			return Plane{}, err
		}
		chatID := chatUUID.String()
		accepter, _ := s.loadProfile(ctx, accountID)
		if s.events != nil {
			if err := s.events.PlaneAccepted(
				ctx, senderID, accountID,
				coalesceName(accepter.Name, accepter.Username), planeID.String(), chatID, message, sentAt,
			); err != nil {
				logx.Warn("plane accepted event failed", "plane_id", planeID.String(), "err", err)
			}
		}
		s.notifyOutbox(senderID, OutboxEvent{
			PlaneID: planeID.String(), State: StateAccepted, Status: StatusAccepted,
			Hops: hops, Rejections: rejections,
			Recipient: recipientPreview(Candidate{Profile: accepter}),
			ChatID:    &chatID,
		})
		return Plane{
			ID:          planeID,
			Message:     message,
			Status:      StatusAccepted,
			State:       StateAccepted,
			Filters:     filters,
			SentAt:      sentAt,
			ExpiresAt:   expiresAt,
			RespondedAt: &now,
			ChatID:      &chatID,
			Hops:        hops,
			Rejections:  rejections,
		}, nil
	}

	// Reject → back to searching; the dispatcher picks the next recipient
	// asynchronously (the rejecter never learns who gets it next).
	if _, err := tx.ExecContext(ctx, `
		UPDATE planes
		SET next_attempt_at = $2, dispatch_attempts = 0, recipient_is_dummy = FALSE, updated_at = $2
		WHERE id = $1 AND status = 'pending'
	`, planeID, now); err != nil {
		return Plane{}, err
	}
	hops, rejections, err := planeCounts(ctx, tx, planeID)
	if err != nil {
		return Plane{}, err
	}
	if err := tx.Commit(); err != nil {
		return Plane{}, err
	}
	s.enqueue(job{kind: jobDispatch, planeID: planeID})
	s.notifyOutbox(senderID, OutboxEvent{
		PlaneID: planeID.String(), State: StateSearching, Status: StatusPending,
		Hops: hops, Rejections: rejections,
	})
	return Plane{
		ID:          planeID,
		Message:     message,
		Status:      StatusPending,
		State:       StateSearching,
		Filters:     filters,
		SentAt:      sentAt,
		ExpiresAt:   expiresAt,
		RespondedAt: &now,
	}, nil
}

func (s *Service) loadProfile(ctx context.Context, accountID stdid.UUID) (Profile, error) {
	return s.loadProfileTx(ctx, s.db, accountID)
}

func (s *Service) loadProfileTx(ctx context.Context, q queryer, accountID stdid.UUID) (Profile, error) {
	var p Profile
	var name, username, avatar, city, country, gender, interests sql.NullString
	var dob sql.NullTime
	var lastActive sql.NullTime
	var lat, lng sql.NullFloat64
	err := q.QueryRowContext(ctx, `
		SELECT
			p.account_id, p.interests, p.created_at,
			p.name, p.username, p.avatar_url, p.city, p.country, p.gender, p.dob,
			p.lat, p.lng, ps.last_active_at, p.is_dummy
		FROM profiles p
		LEFT JOIN profile_stats ps ON ps.account_id = p.account_id
		WHERE p.account_id = $1
	`, accountID).Scan(
		&p.AccountID, &interests, &p.CreatedAt,
		&name, &username, &avatar, &city, &country, &gender, &dob,
		&lat, &lng, &lastActive, &p.IsDummy,
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
	if lat.Valid && lng.Valid {
		la, ln := lat.Float64, lng.Float64
		p.Lat, p.Lng = &la, &ln
	}
	if lastActive.Valid {
		p.LastActiveAt = lastActive.Time
	} else {
		p.LastActiveAt = p.CreatedAt
	}
	return p, nil
}

func scanInboundPlanes(rows *sql.Rows) ([]Plane, error) {
	var out []Plane
	for rows.Next() {
		var p Plane
		var filtersJSON []byte
		var deliveryID stdid.UUID
		var deliveryStatus DeliveryStatus
		var sender SenderPreview

		var senderName, senderUsername, senderAvatar, senderCity, senderCountry sql.NullString

		if err := rows.Scan(
			&p.ID, &p.Message, &p.Status, &filtersJSON, &p.SentAt, &p.ExpiresAt,
			&deliveryID, &deliveryStatus,
			&sender.ID, &senderName, &senderUsername, &senderAvatar, &senderCity, &senderCountry,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(filtersJSON, &p.Filters)
		p.State = StateDelivered
		sender.Name = coalesceName(senderName.String, senderUsername.String)
		sender.AvatarURL = senderAvatar.String
		sender.City = senderCity.String
		sender.Country = senderCountry.String
		p.Sender = &sender
		out = append(out, p)
	}
	return out, rows.Err()
}

func recipientPreview(c Candidate) *RecipientPreview {
	if c.AccountID.IsZero() {
		return nil
	}
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
