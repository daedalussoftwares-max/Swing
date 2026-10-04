package chats

import (
	"context"
	"strings"
	"time"

	"lib/stdid"
)

func (s *Service) MarkDelivered(
	ctx context.Context,
	accountID, chatID stdid.UUID,
	messageIDs []stdid.UUID,
) error {
	partnerID, err := s.partnerID(ctx, accountID, chatID)
	if err != nil {
		return err
	}
	if len(messageIDs) == 0 {
		return nil
	}
	ids := make([]string, 0, len(messageIDs))
	for _, id := range messageIDs {
		ids = append(ids, id.String())
	}
	now := time.Now().UTC()
	// Single batched update; only rows that actually flip from NULL are
	// returned, so the sender is not spammed with duplicate receipts.
	rows, err := s.db.QueryContext(ctx, `
		UPDATE chat_message_status st
		SET delivered_at = $3
		FROM chat_messages m
		WHERE st.message_id = m.id
		  AND m.id = ANY($1::uuid[])
		  AND m.chat_id = $2
		  AND st.account_id = $4
		  AND st.delivered_at IS NULL
		  AND m.sender_account_id <> $4
		RETURNING m.id
	`, "{"+strings.Join(ids, ",")+"}", chatID, now, accountID)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	var delivered []stdid.UUID
	for rows.Next() {
		var id stdid.UUID
		if err := rows.Scan(&id); err != nil {
			return err
		}
		delivered = append(delivered, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if s.hub != nil {
		for _, mid := range delivered {
			s.hub.BroadcastToUser(partnerID, "message.status", WSMessageStatus{
				ChatID:      chatID.String(),
				MessageID:   mid.String(),
				DeliveredAt: &now,
			})
		}
	}
	return nil
}

func (s *Service) MarkRead(
	ctx context.Context,
	accountID, chatID stdid.UUID,
	upToSeq int64,
) error {
	partnerID, err := s.partnerID(ctx, accountID, chatID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()

	// Read cursor + receipt rows in one round trip. upToSeq <= 0 means
	// "everything so far".
	err = s.db.QueryRowContext(ctx, `
		WITH target AS (
			SELECT CASE WHEN $2::bigint > 0 THEN LEAST($2::bigint, next_seq) ELSE next_seq END AS seq
			FROM chats WHERE id = $1
		), cursor AS (
			INSERT INTO chat_read_state (chat_id, account_id, last_read_at, last_read_seq)
			SELECT $1, $3, $4, target.seq FROM target
			ON CONFLICT (chat_id, account_id) DO UPDATE
			SET last_read_at = EXCLUDED.last_read_at,
			    last_read_seq = GREATEST(chat_read_state.last_read_seq, EXCLUDED.last_read_seq)
		), receipts AS (
			UPDATE chat_message_status st
			SET read_at = COALESCE(st.read_at, $4),
			    delivered_at = COALESCE(st.delivered_at, $4)
			FROM chat_messages m, target
			WHERE st.message_id = m.id
			  AND m.chat_id = $1
			  AND m.seq <= target.seq
			  AND m.sender_account_id <> $3
			  AND st.account_id = $3
			  AND st.read_at IS NULL
		)
		SELECT seq FROM target
	`, chatID, upToSeq, accountID, now).Scan(&upToSeq)
	if err != nil {
		return err
	}

	if s.hub != nil {
		s.hub.BroadcastToUser(partnerID, "message.status", WSMessageStatus{
			ChatID:  chatID.String(),
			UpToSeq: upToSeq,
			ReadAt:  &now,
		})
	}
	return nil
}
