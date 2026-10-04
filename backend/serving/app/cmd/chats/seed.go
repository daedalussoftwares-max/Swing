package chats

import (
	"context"
	"strings"
	"time"

	"lib/stdid"
)

// SeedPlaneMessage inserts the original plane note as the first chat message.
func (s *Service) SeedPlaneMessage(
	ctx context.Context,
	chatID, senderID stdid.UUID,
	body string,
	at time.Time,
) error {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var seq int64
	if err := tx.QueryRowContext(ctx, `
		UPDATE chats SET next_seq = next_seq + 1 WHERE id = $1 RETURNING next_seq
	`, chatID).Scan(&seq); err != nil {
		return err
	}

	msgID, err := stdid.New()
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO chat_messages (
			id, chat_id, seq, sender_account_id, type, body, created_at
		) VALUES ($1, $2, $3, $4, 'text', $5, $6)
	`, msgID, chatID, seq, senderID, body, at)
	if err != nil {
		return err
	}

	var partner stdid.UUID
	if err := tx.QueryRowContext(ctx, `
		SELECT CASE WHEN account_a = $2 THEN account_b ELSE account_a END
		FROM chats WHERE id = $1
	`, chatID, senderID).Scan(&partner); err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO chat_message_status (message_id, account_id) VALUES ($1, $2)
		ON CONFLICT DO NOTHING
	`, msgID, partner)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE chats SET last_message_id = $2, last_message_at = $3 WHERE id = $1
	`, chatID, msgID, at)
	if err != nil {
		return err
	}

	return tx.Commit()
}
