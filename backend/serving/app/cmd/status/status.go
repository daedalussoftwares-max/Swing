package status

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"lib/stdid"
)

const statusLifetime = 24 * time.Hour

var (
	ErrNotFound     = errors.New("status not found")
	ErrInvalidInput = errors.New("invalid input")
)

type Item struct {
	ID          stdid.UUID `json:"id"`
	AccountID   stdid.UUID `json:"accountId"`
	Kind        string     `json:"kind"`
	MediaKey    string     `json:"mediaKey"`
	ContentType string     `json:"contentType"`
	ViewURL     string     `json:"viewUrl,omitempty"`
	PostedAt    time.Time  `json:"postedAt"`
	ExpiresAt   time.Time  `json:"expiresAt"`
}

type CreateInput struct {
	MediaKey    string
	ContentType string
	Kind        string
}

type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func kindFromContentType(ct string) string {
	if strings.HasPrefix(ct, "video/") {
		return "video"
	}
	return "image"
}

func (s *Service) ListMine(ctx context.Context, accountID stdid.UUID) ([]Item, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, account_id, kind, media_key, content_type, posted_at, expires_at
		FROM status_items
		WHERE account_id = $1 AND expires_at > NOW()
		ORDER BY posted_at ASC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Item
	for rows.Next() {
		var it Item
		if err := rows.Scan(
			&it.ID, &it.AccountID, &it.Kind, &it.MediaKey,
			&it.ContentType, &it.PostedAt, &it.ExpiresAt,
		); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// ListForAccount returns ownerID's live stories as seen by viewerID. Only the
// owner or a friend (with no block in either direction) may see them; anyone
// else gets ErrNotFound so the endpoint doesn't reveal whether the account
// exists. Permission check and fetch are one round trip: the CTE always
// yields one row carrying the verdict, LEFT JOINed to the items.
func (s *Service) ListForAccount(ctx context.Context, viewerID, ownerID stdid.UUID) ([]Item, error) {
	if viewerID == ownerID {
		return s.ListMine(ctx, ownerID)
	}
	rows, err := s.db.QueryContext(ctx, `
		WITH perm AS (
			SELECT EXISTS (
				SELECT 1 FROM friendships
				WHERE account_a = LEAST($1::uuid, $2::uuid)
				  AND account_b = GREATEST($1::uuid, $2::uuid)
			) AND NOT EXISTS (
				SELECT 1 FROM user_blocks
				WHERE (blocker_id = $1 AND blocked_id = $2)
				   OR (blocker_id = $2 AND blocked_id = $1)
			) AS allowed
		)
		SELECT perm.allowed, si.id, si.account_id, si.kind, si.media_key,
		       si.content_type, si.posted_at, si.expires_at
		FROM perm
		LEFT JOIN status_items si
		       ON perm.allowed AND si.account_id = $2 AND si.expires_at > NOW()
		ORDER BY si.posted_at ASC
	`, viewerID, ownerID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	allowed := false
	var out []Item
	for rows.Next() {
		var (
			id, account         sql.Null[stdid.UUID]
			kind, key, ct       sql.NullString
			postedAt, expiresAt sql.NullTime
		)
		if err := rows.Scan(&allowed, &id, &account, &kind, &key, &ct, &postedAt, &expiresAt); err != nil {
			return nil, err
		}
		if !id.Valid {
			continue
		}
		out = append(out, Item{
			ID: id.V, AccountID: account.V, Kind: kind.String, MediaKey: key.String,
			ContentType: ct.String, PostedAt: postedAt.Time, ExpiresAt: expiresAt.Time,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrNotFound
	}
	return out, nil
}

func (s *Service) Create(ctx context.Context, accountID stdid.UUID, in CreateInput) (Item, error) {
	mediaKey := strings.TrimSpace(in.MediaKey)
	if mediaKey == "" {
		return Item{}, ErrInvalidInput
	}
	ct := strings.TrimSpace(in.ContentType)
	if ct == "" {
		return Item{}, ErrInvalidInput
	}
	kind := strings.TrimSpace(in.Kind)
	if kind == "" {
		kind = kindFromContentType(ct)
	}
	if kind != "image" && kind != "video" {
		return Item{}, ErrInvalidInput
	}
	if !strings.HasPrefix(mediaKey, "status/"+accountID.String()+"/") {
		return Item{}, ErrInvalidInput
	}

	id, err := stdid.New()
	if err != nil {
		return Item{}, err
	}
	now := time.Now().UTC()
	expires := now.Add(statusLifetime)

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO status_items (id, account_id, kind, media_key, content_type, posted_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, id, accountID, kind, mediaKey, ct, now, expires)
	if err != nil {
		return Item{}, err
	}

	return Item{
		ID:          id,
		AccountID:   accountID,
		Kind:        kind,
		MediaKey:    mediaKey,
		ContentType: ct,
		PostedAt:    now,
		ExpiresAt:   expires,
	}, nil
}

func (s *Service) Delete(ctx context.Context, accountID, itemID stdid.UUID) error {
	res, err := s.db.ExecContext(ctx, `
		DELETE FROM status_items WHERE id = $1 AND account_id = $2
	`, itemID, accountID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
