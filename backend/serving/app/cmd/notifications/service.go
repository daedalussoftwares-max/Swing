package notifications

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"lib/stdid"

	"serving/app/pkg/realtime"
)

var ErrNotFound = errors.New("notification not found")

type Service struct {
	db  *sql.DB
	hub *realtime.Hub
}

func NewService(db *sql.DB, hub *realtime.Hub) *Service {
	return &Service{db: db, hub: hub}
}

func (s *Service) List(ctx context.Context, accountID stdid.UUID, limit int) ([]Notification, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, kind, title, body, from_name, deep_link, read_at, created_at
		FROM notifications
		WHERE account_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, accountID, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanNotifications(rows)
}

func (s *Service) MarkRead(ctx context.Context, accountID, id stdid.UUID) error {
	res, err := s.db.ExecContext(ctx, `
		UPDATE notifications
		SET read_at = COALESCE(read_at, NOW())
		WHERE id = $1 AND account_id = $2
	`, id, accountID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) MarkAllRead(ctx context.Context, accountID stdid.UUID) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE notifications
		SET read_at = COALESCE(read_at, NOW())
		WHERE account_id = $1 AND read_at IS NULL
	`, accountID)
	return err
}

func (s *Service) Create(
	ctx context.Context,
	accountID stdid.UUID,
	kind Kind,
	title, body, fromName, deepLink string,
) (Notification, error) {
	id, err := stdid.New()
	if err != nil {
		return Notification{}, err
	}
	now := time.Now().UTC()
	title = strings.TrimSpace(title)
	if title == "" {
		return Notification{}, fmt.Errorf("notification title required")
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO notifications (
			id, account_id, kind, title, body, from_name, deep_link, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, id, accountID, string(kind), title, nullIfEmpty(body), nullIfEmpty(fromName), nullIfEmpty(deepLink), now)
	if err != nil {
		return Notification{}, err
	}
	n := Notification{
		ID:        id,
		Kind:      kind,
		Title:     title,
		Body:      body,
		FromName:  fromName,
		DeepLink:  deepLink,
		CreatedAt: now,
		Read:      false,
	}
	if s.hub != nil {
		s.hub.BroadcastToUser(accountID, "notification.new", n)
	}
	return n, nil
}

func nullIfEmpty(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func scanNotifications(rows *sql.Rows) ([]Notification, error) {
	var out []Notification
	for rows.Next() {
		var n Notification
		var body, fromName, deepLink sql.NullString
		var readAt sql.NullTime
		var kind string
		if err := rows.Scan(
			&n.ID, &kind, &n.Title, &body, &fromName, &deepLink, &readAt, &n.CreatedAt,
		); err != nil {
			return nil, err
		}
		n.Kind = Kind(kind)
		if body.Valid {
			n.Body = body.String
		}
		if fromName.Valid {
			n.FromName = fromName.String
		}
		if deepLink.Valid {
			n.DeepLink = deepLink.String
		}
		n.Read = readAt.Valid
		out = append(out, n)
	}
	return out, rows.Err()
}
