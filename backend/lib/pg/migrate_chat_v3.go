package pg

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// migrateChatV3 adds server-side blocking, per-user chat state (pin),
// view-once media and user reports.
func migrateChatV3(ctx context.Context, db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS user_blocks (
			blocker_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			blocked_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			created_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (blocker_id, blocked_id),
			CHECK (blocker_id <> blocked_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id)`,
		`CREATE TABLE IF NOT EXISTS chat_user_state (
			chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
			account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			pinned_at timestamptz,
			PRIMARY KEY (chat_id, account_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_chat_message_hidden_account ON chat_message_hidden(account_id)`,
		`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS view_once boolean NOT NULL DEFAULT false`,
		`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS viewed_at timestamptz`,
		`CREATE TABLE IF NOT EXISTS reports (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			reporter_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			reported_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			chat_id uuid,
			reason text NOT NULL,
			details text NOT NULL DEFAULT '',
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id, created_at DESC)`,
	}
	for _, q := range stmts {
		if _, err := db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("%s: %w", strings.SplitN(strings.TrimSpace(q), "\n", 2)[0], err)
		}
	}
	return nil
}
