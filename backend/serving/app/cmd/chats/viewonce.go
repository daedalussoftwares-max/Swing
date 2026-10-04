package chats

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"lib/stdid"
)

var ErrAlreadyViewed = errors.New("already viewed")

// OpenViewOnce burns a view-once message for its recipient and returns a
// short-lived URL to the media — the only time anyone gets one.
func (s *Service) OpenViewOnce(
	ctx context.Context,
	accountID, chatID, messageID stdid.UUID,
) (string, time.Time, error) {
	partnerID, err := s.partnerID(ctx, accountID, chatID)
	if err != nil {
		return "", time.Time{}, err
	}
	now := time.Now().UTC()
	var mediaRaw []byte
	err = s.db.QueryRowContext(ctx, `
		UPDATE chat_messages m
		SET viewed_at = $4
		WHERE m.id = $1 AND m.chat_id = $2
		  AND m.view_once AND m.viewed_at IS NULL AND m.deleted_at IS NULL
		  AND m.sender_account_id <> $3
		  AND NOT EXISTS (
			SELECT 1 FROM chat_message_hidden h
			WHERE h.message_id = m.id AND h.account_id = $3
		  )
		RETURNING m.media
	`, messageID, chatID, accountID, now).Scan(&mediaRaw)
	if errors.Is(err, sql.ErrNoRows) {
		var viewed bool
		qerr := s.db.QueryRowContext(ctx, `
			SELECT viewed_at IS NOT NULL FROM chat_messages
			WHERE id = $1 AND chat_id = $2 AND view_once AND sender_account_id <> $3
		`, messageID, chatID, accountID).Scan(&viewed)
		if qerr == nil && viewed {
			return "", time.Time{}, ErrAlreadyViewed
		}
		return "", time.Time{}, ErrMessageNotFound
	}
	if err != nil {
		return "", time.Time{}, err
	}
	meta, err := parseMediaJSON(mediaRaw)
	if err != nil || meta == nil {
		return "", time.Time{}, ErrMessageNotFound
	}
	signed := s.signMedia(ctx, meta)
	if signed == nil || signed.URL == "" {
		return "", time.Time{}, errors.New("media unavailable")
	}
	if s.hub != nil {
		payload := map[string]any{
			"chatId":    chatID.String(),
			"messageId": messageID.String(),
			"viewedAt":  now,
		}
		s.broadcastToPartner(ctx, accountID, partnerID, "message.viewed", payload)
		s.hub.BroadcastToUser(accountID, "message.viewed", payload)
	}
	return signed.URL, now, nil
}
