package chats

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"lib/stdid"

	"serving/app/pkg/r2storage"
)

func coalesceName(name, username string) string {
	if strings.TrimSpace(name) != "" {
		return strings.TrimSpace(name)
	}
	return strings.TrimSpace(username)
}

// chatMembers is immutable once a chat exists (one chat per account pair),
// so it is cached in memory for the life of the process. This removes one
// or two remote Postgres round trips from every chat request.
type chatMembers struct{ a, b stdid.UUID }

func (s *Service) members(ctx context.Context, chatID stdid.UUID) (chatMembers, error) {
	if v, ok := s.memberCache.Load(chatID); ok {
		return v.(chatMembers), nil
	}
	var m chatMembers
	err := s.db.QueryRowContext(ctx, `
		SELECT account_a, account_b FROM chats WHERE id = $1
	`, chatID).Scan(&m.a, &m.b)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return chatMembers{}, ErrNotFound
		}
		return chatMembers{}, err
	}
	s.memberCache.Store(chatID, m)
	return m, nil
}

func (s *Service) isMember(ctx context.Context, accountID, chatID stdid.UUID) bool {
	m, err := s.members(ctx, chatID)
	return err == nil && (m.a == accountID || m.b == accountID)
}

func (s *Service) partnerID(ctx context.Context, accountID, chatID stdid.UUID) (stdid.UUID, error) {
	m, err := s.members(ctx, chatID)
	if err != nil {
		return stdid.UUID{}, err
	}
	if m.a == accountID {
		return m.b, nil
	}
	if m.b == accountID {
		return m.a, nil
	}
	return stdid.UUID{}, ErrForbidden
}

func (s *Service) profileName(ctx context.Context, accountID stdid.UUID) (string, error) {
	var name, username sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT name, username FROM profiles WHERE account_id = $1
	`, accountID).Scan(&name, &username)
	if err != nil {
		return "", err
	}
	return coalesceName(name.String, username.String), nil
}

func (s *Service) signMedia(ctx context.Context, meta *MediaMeta) *MediaMeta {
	if meta == nil || s.r2 == nil || meta.R2Key == "" {
		return meta
	}
	out := *meta
	url, err := s.r2.PresignGet(ctx, meta.R2Key)
	if err == nil {
		out.URL = url
	}
	if meta.ThumbKey != "" {
		thumb, err := s.r2.PresignGet(ctx, meta.ThumbKey)
		if err == nil && thumb != "" {
			// expose thumb via URL on main for clients that only read url
			if out.URL == "" {
				out.URL = thumb
			}
		}
	}
	return &out
}

func parseMediaJSON(raw []byte) (*MediaMeta, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var m MediaMeta
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func mediaToJSON(m *MediaMeta) ([]byte, error) {
	if m == nil || strings.TrimSpace(m.R2Key) == "" {
		return nil, nil
	}
	// store keys only — strip URL
	copy := *m
	copy.URL = ""
	return json.Marshal(copy)
}

// jsonbParam encodes values for Postgres jsonb (lib/pq expects string or NULL).
func jsonbParam(raw []byte) interface{} {
	if len(raw) == 0 {
		return nil
	}
	return string(raw)
}

func messagePreview(msg Message) string {
	if msg.DeletedAt != nil {
		return "Message deleted"
	}
	if msg.ViewOnce {
		if msg.Type == TypeAudio {
			return "🎤 Voice message · Listen once"
		}
		return "📷 Photo · View once"
	}
	switch msg.Type {
	case TypeImage:
		return "Photo"
	case TypeVideo:
		return "Video"
	case TypeAudio:
		return "Voice message"
	case TypeDocument:
		return "Document"
	case TypeSticker:
		return "Sticker"
	default:
		if msg.Body != nil {
			b := strings.TrimSpace(*msg.Body)
			if len(b) > 80 {
				return b[:80] + "…"
			}
			return b
		}
		return "Message"
	}
}

func validateMediaType(t string, media *MediaMeta) error {
	switch t {
	case TypeText:
		return nil
	case TypeImage, TypeVideo, TypeAudio, TypeDocument, TypeSticker:
		if media == nil || strings.TrimSpace(media.R2Key) == "" {
			return ErrInvalidInput
		}
		return nil
	default:
		return ErrInvalidInput
	}
}

func maxBytesForType(t string) int64 {
	switch t {
	case TypeImage, TypeAudio:
		return 10 << 20
	case TypeVideo:
		return 50 << 20
	case TypeDocument:
		return 20 << 20
	default:
		return 0
	}
}

func validateMediaSize(t string, media *MediaMeta) error {
	if media == nil {
		return nil
	}
	max := maxBytesForType(t)
	if max > 0 && media.Size > max {
		return ErrInvalidInput
	}
	return nil
}

// ensureMediaKeyOwned: a message may only reference files the sender
// uploaded into THIS chat (chat/<sender>/<chatID>/...), so nobody can
// attach someone else's media by guessing or reusing a key.
func (s *Service) ensureMediaKeyOwned(_ context.Context, accountID, chatID stdid.UUID, key string) error {
	if s.r2 == nil || key == "" {
		return nil
	}
	if strings.Contains(key, "..") ||
		!strings.HasPrefix(key, r2storage.ChatKeyPrefix(accountID, chatID.String())) {
		return ErrInvalidInput
	}
	return nil
}
