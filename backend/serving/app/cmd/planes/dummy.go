package planes

import (
	"context"
	"fmt"

	"lib/stdid"
)

// settleDummyAccepts marks pending dummy deliveries as accepted after
// DummyAcceptDelay — no friendship, no chat. Real users still accept manually.
func (s *Service) settleDummyAccepts(ctx context.Context, senderID stdid.UUID) error {
	delay := fmt.Sprintf("%d seconds", int(DummyAcceptDelay.Seconds()))
	_, err := s.db.ExecContext(ctx, `
		UPDATE plane_deliveries pd
		SET status = 'accepted', responded_at = NOW()
		FROM planes pl
		WHERE pl.id = pd.plane_id
		  AND pl.sender_account_id = $1
		  AND pl.status = 'pending'
		  AND pl.recipient_is_dummy = TRUE
		  AND pd.status = 'pending'
		  AND pd.delivered_at <= NOW() - $2::interval
	`, senderID, delay)
	if err != nil {
		return err
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE planes
		SET status = 'accepted', updated_at = NOW()
		WHERE sender_account_id = $1
		  AND status = 'pending'
		  AND recipient_is_dummy = TRUE
		  AND id IN (
		    SELECT DISTINCT pl.id
		    FROM planes pl
		    JOIN plane_deliveries pd ON pd.plane_id = pl.id
		    WHERE pl.sender_account_id = $1
		      AND pl.recipient_is_dummy = TRUE
		      AND pd.status = 'accepted'
		  )
	`, senderID)
	return err
}
