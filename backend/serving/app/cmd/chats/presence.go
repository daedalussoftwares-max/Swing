package chats

import (
	"context"
	"time"

	"lib/stdid"
)

// OnRealtimeConnect updates last_active_at and notifies friends.
func (s *Service) OnRealtimeConnect(ctx context.Context, accountID stdid.UUID) {
	now := time.Now().UTC()
	_, _ = s.db.ExecContext(ctx, `
		UPDATE profile_stats SET last_active_at = $2 WHERE account_id = $1
	`, accountID, now)
	s.broadcastPresence(ctx, accountID, &now, true)
}

// OnRealtimeDisconnect updates last_active_at and notifies friends.
func (s *Service) OnRealtimeDisconnect(ctx context.Context, accountID stdid.UUID) {
	now := time.Now().UTC()
	_, _ = s.db.ExecContext(ctx, `
		UPDATE profile_stats SET last_active_at = $2 WHERE account_id = $1
	`, accountID, now)
	s.broadcastPresence(ctx, accountID, &now, false)
}

func (s *Service) broadcastPresence(ctx context.Context, accountID stdid.UUID, at *time.Time, online bool) {
	if s.hub == nil {
		return
	}
	friends, err := s.friendIDs(ctx, accountID)
	if err != nil {
		return
	}
	payload := map[string]any{
		"userId":       accountID.String(),
		"online":       online,
		"lastActiveAt": at,
	}
	for _, fid := range friends {
		s.hub.BroadcastToUser(fid, "presence.update", payload)
	}
}

func (s *Service) friendIDs(ctx context.Context, accountID stdid.UUID) ([]stdid.UUID, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT f.friend_id FROM (
			SELECT CASE WHEN account_a = $1 THEN account_b ELSE account_a END AS friend_id
			FROM friendships
			WHERE account_a = $1 OR account_b = $1
		) f
		WHERE NOT EXISTS (
			SELECT 1 FROM user_blocks b
			WHERE (b.blocker_id = $1 AND b.blocked_id = f.friend_id)
			   OR (b.blocker_id = f.friend_id AND b.blocked_id = $1)
		)
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []stdid.UUID
	for rows.Next() {
		var id stdid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
