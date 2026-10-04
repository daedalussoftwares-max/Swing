package chats

import (
	"context"
	"time"

	"lib/stdid"
)

// Blocking follows WhatsApp semantics:
//   - The blocked person can still send; messages are stored but hidden
//     from the blocker forever (they only ever see a single tick).
//   - The blocker can't send until they unblock.
//   - Neither side receives the other's typing / presence.
//   - The blocked person is never told they were blocked.

type blockKey struct{ blocker, blocked stdid.UUID }

// HasBlocked reports whether blocker has blocked blocked. Cached in memory;
// every write goes through Block/Unblock which update the cache.
func (s *Service) HasBlocked(ctx context.Context, blocker, blocked stdid.UUID) bool {
	key := blockKey{blocker, blocked}
	if v, ok := s.blockCache.Load(key); ok {
		return v.(bool)
	}
	var exists bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2)
	`, blocker, blocked).Scan(&exists)
	if err != nil {
		return false
	}
	s.blockCache.Store(key, exists)
	return exists
}

func (s *Service) eitherBlocked(ctx context.Context, a, b stdid.UUID) bool {
	return s.HasBlocked(ctx, a, b) || s.HasBlocked(ctx, b, a)
}

func (s *Service) Block(ctx context.Context, blocker, blocked stdid.UUID) error {
	if blocker == blocked || blocked.IsZero() {
		return ErrInvalidInput
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO user_blocks (blocker_id, blocked_id, created_at)
		VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`, blocker, blocked, time.Now().UTC())
	if err != nil {
		return err
	}
	s.blockCache.Store(blockKey{blocker, blocked}, true)
	if s.hub != nil {
		// Sync the blocker's other devices; make the blocker look offline
		// (and not typing) to the blocked person.
		s.hub.BroadcastToUser(blocker, "block.updated", map[string]any{
			"userId":  blocked.String(),
			"blocked": true,
		})
		s.hub.BroadcastToUser(blocked, "presence.update", map[string]any{
			"userId": blocker.String(),
			"online": false,
		})
	}
	return nil
}

func (s *Service) Unblock(ctx context.Context, blocker, blocked stdid.UUID) error {
	if blocker == blocked || blocked.IsZero() {
		return ErrInvalidInput
	}
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2
	`, blocker, blocked)
	if err != nil {
		return err
	}
	s.blockCache.Store(blockKey{blocker, blocked}, false)
	if s.hub != nil {
		s.hub.BroadcastToUser(blocker, "block.updated", map[string]any{
			"userId":  blocked.String(),
			"blocked": false,
		})
		if !s.HasBlocked(ctx, blocked, blocker) {
			s.hub.BroadcastToUser(blocked, "presence.update", map[string]any{
				"userId": blocker.String(),
				"online": s.hub.IsOnline(blocker),
			})
		}
	}
	return nil
}

// broadcastToPartner relays an event about my message to the partner,
// unless they blocked me (then they must not learn anything about it).
func (s *Service) broadcastToPartner(ctx context.Context, from, partner stdid.UUID, eventType string, payload any) {
	if s.hub == nil || s.HasBlocked(ctx, partner, from) {
		return
	}
	s.hub.BroadcastToUser(partner, eventType, payload)
}
