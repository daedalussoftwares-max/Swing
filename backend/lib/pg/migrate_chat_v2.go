package pg

import (
	"context"
	"database/sql"
	"fmt"
)

// migrateChatV2 adds seq-based messaging, status, reactions, device tokens.
func migrateChatV2(ctx context.Context, db *sql.DB) error {
	stmts := []string{
		`ALTER TABLE chats ADD COLUMN IF NOT EXISTS next_seq bigint NOT NULL DEFAULT 0`,
		`ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_message_id uuid`,
		`ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_message_at timestamptz`,

		`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS seq bigint`,
		`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS client_msg_id text`,
		`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'text'`,
		`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS media jsonb`,
		`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES chat_messages(id)`,
		`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS forwarded boolean NOT NULL DEFAULT false`,
		`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz`,
		`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,

		`ALTER TABLE chat_messages ALTER COLUMN body DROP NOT NULL`,
		`ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_body_check`,

		`UPDATE chat_messages m SET seq = r.rn
		 FROM (
		   SELECT id, row_number() OVER (PARTITION BY chat_id ORDER BY created_at, id) rn
		   FROM chat_messages
		 ) r
		 WHERE m.id = r.id AND m.seq IS NULL`,
		`UPDATE chats c SET next_seq = COALESCE((SELECT max(seq) FROM chat_messages WHERE chat_id = c.id), 0)`,
		`UPDATE chat_read_state crs SET last_read_seq = COALESCE(
		   (SELECT max(m.seq) FROM chat_messages m
		    WHERE m.chat_id = crs.chat_id AND m.created_at <= crs.last_read_at),
		   0
		 ) WHERE last_read_seq = 0`,

		`ALTER TABLE chat_messages ALTER COLUMN seq SET NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_chat_seq ON chat_messages(chat_id, seq)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_client_id ON chat_messages(chat_id, client_msg_id) WHERE client_msg_id IS NOT NULL`,

		`CREATE TABLE IF NOT EXISTS chat_message_status (
		  message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
		  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
		  delivered_at timestamptz,
		  read_at timestamptz,
		  PRIMARY KEY (message_id, account_id)
		)`,
		`CREATE INDEX IF NOT EXISTS cms_unread ON chat_message_status(account_id) WHERE read_at IS NULL`,

		`CREATE TABLE IF NOT EXISTS chat_message_reactions (
		  message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
		  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
		  emoji text NOT NULL,
		  created_at timestamptz NOT NULL DEFAULT now(),
		  PRIMARY KEY (message_id, account_id)
		)`,

		`CREATE TABLE IF NOT EXISTS chat_message_hidden (
		  message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
		  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
		  PRIMARY KEY (message_id, account_id)
		)`,

		`ALTER TABLE chat_read_state ADD COLUMN IF NOT EXISTS last_read_seq bigint NOT NULL DEFAULT 0`,

		`CREATE TABLE IF NOT EXISTS device_tokens (
		  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
		  token text PRIMARY KEY,
		  platform text NOT NULL,
		  updated_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_device_tokens_account ON device_tokens(account_id)`,
	}
	for _, q := range stmts {
		if _, err := db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("migrateChatV2: %w\n%s", err, q)
		}
	}
	return nil
}
