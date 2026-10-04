package chats

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"lib/stdid"
)

func (s *Service) SetReaction(
	ctx context.Context,
	accountID, chatID, messageID stdid.UUID,
	emoji string,
) error {
	emoji = strings.TrimSpace(emoji)
	if emoji == "" {
		return ErrInvalidInput
	}
	if !s.isMember(ctx, accountID, chatID) {
		return ErrForbidden
	}
	var senderID stdid.UUID
	err := s.db.QueryRowContext(ctx, `
		SELECT sender_account_id FROM chat_messages WHERE id = $1 AND chat_id = $2
	`, messageID, chatID).Scan(&senderID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrMessageNotFound
	}
	if err != nil {
		return err
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO chat_message_reactions (message_id, account_id, emoji)
		VALUES ($1, $2, $3)
		ON CONFLICT (message_id, account_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()
	`, messageID, accountID, emoji)
	if err != nil {
		return err
	}

	if s.hub != nil {
		payload := map[string]any{
			"chatId":    chatID.String(),
			"messageId": messageID.String(),
			"accountId": accountID.String(),
			"emoji":     emoji,
		}
		partner, _ := s.partnerID(ctx, accountID, chatID)
		s.broadcastToPartner(ctx, accountID, partner, "message.reaction", payload)
		s.hub.BroadcastToUser(accountID, "message.reaction", payload)
	}
	return nil
}

func (s *Service) RemoveReaction(
	ctx context.Context,
	accountID, chatID, messageID stdid.UUID,
) error {
	if !s.isMember(ctx, accountID, chatID) {
		return ErrForbidden
	}
	res, err := s.db.ExecContext(ctx, `
		DELETE FROM chat_message_reactions
		WHERE message_id = $1 AND account_id = $2
		  AND EXISTS (SELECT 1 FROM chat_messages WHERE id = $1 AND chat_id = $3)
	`, messageID, accountID, chatID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrMessageNotFound
	}
	if s.hub != nil {
		payload := map[string]any{
			"chatId":    chatID.String(),
			"messageId": messageID.String(),
			"accountId": accountID.String(),
			"emoji":     "",
		}
		partner, _ := s.partnerID(ctx, accountID, chatID)
		s.broadcastToPartner(ctx, accountID, partner, "message.reaction", payload)
		s.hub.BroadcastToUser(accountID, "message.reaction", payload)
	}
	return nil
}

func (s *Service) Edit(
	ctx context.Context,
	accountID, chatID, messageID stdid.UUID,
	body string,
) (Message, error) {
	body = strings.TrimSpace(body)
	if body == "" || len(body) > maxMessageLen {
		return Message{}, ErrInvalidInput
	}
	if !s.isMember(ctx, accountID, chatID) {
		return Message{}, ErrForbidden
	}

	var msgType string
	var senderID stdid.UUID
	var createdAt time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT type, sender_account_id, created_at
		FROM chat_messages WHERE id = $1 AND chat_id = $2 AND deleted_at IS NULL
	`, messageID, chatID).Scan(&msgType, &senderID, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, ErrMessageNotFound
	}
	if err != nil {
		return Message{}, err
	}
	if senderID != accountID {
		return Message{}, ErrForbidden
	}
	if msgType != TypeText {
		return Message{}, ErrEditNotAllowed
	}
	if time.Since(createdAt) > EditWindow {
		return Message{}, ErrEditNotAllowed
	}

	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		UPDATE chat_messages SET body = $3, edited_at = $4 WHERE id = $1 AND chat_id = $2
	`, messageID, chatID, body, now)
	if err != nil {
		return Message{}, err
	}

	msg := Message{
		ID:        messageID,
		ChatID:    chatID,
		SenderID:  senderID,
		Type:      TypeText,
		Body:      &body,
		EditedAt:  &now,
		CreatedAt: createdAt,
	}
	if s.hub != nil {
		payload := map[string]any{"chatId": chatID.String(), "message": msg}
		partner, _ := s.partnerID(ctx, accountID, chatID)
		s.broadcastToPartner(ctx, accountID, partner, "message.edited", payload)
		s.hub.BroadcastToUser(accountID, "message.edited", payload)
	}
	return msg, nil
}

func (s *Service) Delete(
	ctx context.Context,
	accountID, chatID, messageID stdid.UUID,
	scope string,
) error {
	if !s.isMember(ctx, accountID, chatID) {
		return ErrForbidden
	}
	scope = strings.TrimSpace(scope)
	if scope == "" {
		scope = "me"
	}

	switch scope {
	case "me":
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO chat_message_hidden (message_id, account_id)
			SELECT $1, $2
			WHERE EXISTS (SELECT 1 FROM chat_messages WHERE id = $1 AND chat_id = $3)
			ON CONFLICT DO NOTHING
		`, messageID, accountID, chatID)
		return err
	case "everyone":
		var senderID stdid.UUID
		err := s.db.QueryRowContext(ctx, `
			SELECT sender_account_id FROM chat_messages WHERE id = $1 AND chat_id = $2
		`, messageID, chatID).Scan(&senderID)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrMessageNotFound
		}
		if err != nil {
			return err
		}
		if senderID != accountID {
			return ErrDeleteNotAllowed
		}
		now := time.Now().UTC()
		_, err = s.db.ExecContext(ctx, `
			UPDATE chat_messages
			SET deleted_at = $3, body = NULL
			WHERE id = $1 AND chat_id = $2
		`, messageID, chatID, now)
		if err != nil {
			return err
		}
		if s.hub != nil {
			payload := map[string]any{
				"chatId":    chatID.String(),
				"messageId": messageID.String(),
				"deletedAt": now,
			}
			partner, _ := s.partnerID(ctx, accountID, chatID)
			s.broadcastToPartner(ctx, accountID, partner, "message.deleted", payload)
			s.hub.BroadcastToUser(accountID, "message.deleted", payload)
		}
		return nil
	default:
		return ErrInvalidInput
	}
}

func (s *Service) Typing(ctx context.Context, accountID, chatID stdid.UUID, isTyping bool) error {
	partner, err := s.partnerID(ctx, accountID, chatID)
	if err != nil {
		return err
	}
	if s.eitherBlocked(ctx, accountID, partner) {
		return nil
	}
	if s.hub != nil {
		s.hub.BroadcastToUser(partner, "typing", map[string]any{
			"chatId":   chatID.String(),
			"userId":   accountID.String(),
			"isTyping": isTyping,
		})
	}
	return nil
}
