package chats

import (
	"context"
	"time"

	"lib/stdid"
)

// SetPinned pins/unpins a chat for one user only. Returns the new pinned_at.
func (s *Service) SetPinned(ctx context.Context, accountID, chatID stdid.UUID, pinned bool) (*time.Time, error) {
	if !s.isMember(ctx, accountID, chatID) {
		return nil, ErrForbidden
	}
	var at *time.Time
	if pinned {
		now := time.Now().UTC()
		at = &now
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO chat_user_state (chat_id, account_id, pinned_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (chat_id, account_id) DO UPDATE SET pinned_at = EXCLUDED.pinned_at
	`, chatID, accountID, at)
	if err != nil {
		return nil, err
	}
	if s.hub != nil {
		s.hub.BroadcastToUser(accountID, "chat.updated", map[string]any{
			"chatId":   chatID.String(),
			"pinnedAt": at,
		})
	}
	return at, nil
}

// DeleteChat removes the conversation for BOTH people: every message
// (receipts, reactions and hidden rows cascade), read state, pins, and the
// friendship, so the two can meet again through a new plane.
func (s *Service) DeleteChat(ctx context.Context, accountID, chatID stdid.UUID) error {
	m, err := s.members(ctx, chatID)
	if err != nil {
		return err
	}
	if m.a != accountID && m.b != accountID {
		return ErrForbidden
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// Messages first: reply_to_id is a self-reference without ON DELETE.
	if _, err := tx.ExecContext(ctx, `DELETE FROM chat_messages WHERE chat_id = $1`, chatID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM chats WHERE id = $1`, chatID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM friendships
		WHERE account_a = LEAST($1::uuid, $2::uuid) AND account_b = GREATEST($1::uuid, $2::uuid)
	`, m.a, m.b); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.memberCache.Delete(chatID)
	if s.hub != nil {
		payload := map[string]any{"chatId": chatID.String()}
		s.hub.BroadcastToUser(m.a, "chat.deleted", payload)
		s.hub.BroadcastToUser(m.b, "chat.deleted", payload)
	}
	return nil
}
