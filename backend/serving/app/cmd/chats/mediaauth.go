package chats

import (
	"context"
	"time"

	"lib/stdid"

	"serving/app/pkg/background"
	"serving/app/pkg/r2storage"
)

// IsMember reports whether accountID is one of the two people in chatID.
func (s *Service) IsMember(ctx context.Context, accountID, chatID stdid.UUID) bool {
	return s.isMember(ctx, accountID, chatID)
}

// CanReadMedia decides whether viewer may get a (re-)signed URL for key.
//
//   - avatars/…  public profile photos — anyone signed in.
//   - chat/…     the uploader, or the other chat member while a visible,
//     non-deleted, non-view-once message in that chat references the key
//     (view-once media is only ever served by OpenViewOnce).
//   - status/…   the owner, or a friend with no block in either direction.
func (s *Service) CanReadMedia(ctx context.Context, viewer stdid.UUID, key string) (bool, error) {
	scope, owner, rest, ok := r2storage.ParseOwnedKey(key)
	if !ok {
		return false, nil
	}
	switch scope {
	case r2storage.ScopeAvatar:
		return true, nil
	case r2storage.ScopeChat:
		if owner == viewer {
			return true, nil
		}
		var allowed bool
		err := s.db.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM chat_messages m
				JOIN chats c ON c.id = m.chat_id
				WHERE (c.account_a = $1 OR c.account_b = $1)
				  AND m.sender_account_id = $2
				  AND (m.media->>'r2_key' = $3 OR m.media->>'thumb_key' = $3)
				  AND m.deleted_at IS NULL
				  AND NOT m.view_once
				  AND NOT EXISTS (
					SELECT 1 FROM chat_message_hidden h
					WHERE h.message_id = m.id AND h.account_id = $1
				  )
			)
		`, viewer, owner, key).Scan(&allowed)
		_ = rest
		return allowed, err
	case r2storage.ScopeStatus:
		if owner == viewer {
			return true, nil
		}
		var allowed bool
		err := s.db.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM friendships f
				WHERE f.account_a = LEAST($1::uuid, $2::uuid)
				  AND f.account_b = GREATEST($1::uuid, $2::uuid)
			) AND NOT EXISTS (
				SELECT 1 FROM user_blocks b
				WHERE (b.blocker_id = $1 AND b.blocked_id = $2)
				   OR (b.blocker_id = $2 AND b.blocked_id = $1)
			)
		`, viewer, owner).Scan(&allowed)
		return allowed, err
	default:
		return false, nil
	}
}

const (
	// viewOnceURLTTL: the one-time link to a view-once file.
	viewOnceURLTTL = 60 * time.Second
	// viewOnceDeleteAfter: the file itself is deleted once that link is dead.
	viewOnceDeleteAfter = 2 * time.Minute
)

// deleteMediaLater removes stored files after delay (0 = right away, still
// off the request path). Best effort: a restart before the timer fires
// leaves the object — a periodic R2 cleanup is still advisable.
func (s *Service) deleteMediaLater(meta *MediaMeta, delay time.Duration) {
	if s.r2 == nil || meta == nil {
		return
	}
	keys := []string{meta.R2Key, meta.ThumbKey}
	run := func() {
		background.Submit("chat.media_delete", func(ctx context.Context) {
			for _, k := range keys {
				if k != "" {
					_ = s.r2.DeleteObject(ctx, k)
				}
			}
		})
	}
	if delay <= 0 {
		run()
		return
	}
	time.AfterFunc(delay, run)
}
