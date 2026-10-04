package chats

import (
	"context"
	"strings"
	"time"

	"lib/stdid"
)

func (s *Service) RegisterDevice(
	ctx context.Context,
	accountID stdid.UUID,
	token, platform string,
) error {
	token = strings.TrimSpace(token)
	platform = strings.TrimSpace(platform)
	if token == "" || platform == "" {
		return ErrInvalidInput
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO device_tokens (account_id, token, platform, updated_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (token) DO UPDATE
		SET account_id = EXCLUDED.account_id,
		    platform = EXCLUDED.platform,
		    updated_at = EXCLUDED.updated_at
	`, accountID, token, platform, time.Now().UTC())
	return err
}

// UnregisterDevice deletes a push token on sign-out. Only the owning
// account can remove its token; unknown tokens are a no-op.
func (s *Service) UnregisterDevice(
	ctx context.Context,
	accountID stdid.UUID,
	token string,
) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return ErrInvalidInput
	}
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM device_tokens
		WHERE token = $1 AND account_id = $2
	`, token, accountID)
	return err
}
