package planes

import (
	"context"
	"database/sql"
	"errors"

	"lib/stdid"
)

// settleDummyPlane auto-accepts a plane delivered to a dummy user once
// DummyAcceptDelay has passed. Status only — no friendship, no chat (dummies
// never reply). Triggered by a timer after delivery, with the sweeper as a
// safety net; the row lock + status guards make it idempotent.
func (s *Service) settleDummyPlane(ctx context.Context, planeID stdid.UUID) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var (
		senderID   stdid.UUID
		deliveryID stdid.UUID
		recipient  Candidate
		name       sql.NullString
		username   sql.NullString
		avatar     sql.NullString
		city       sql.NullString
		country    sql.NullString
	)
	err = tx.QueryRowContext(ctx, `
		SELECT pl.sender_account_id, pd.id, r.account_id, r.name, r.username, r.avatar_url, r.city, r.country
		FROM planes pl
		JOIN plane_deliveries pd ON pd.plane_id = pl.id AND pd.status = 'pending'
		JOIN profiles r ON r.account_id = pd.recipient_account_id AND r.is_dummy
		WHERE pl.id = $1
		  AND pl.status = 'pending'
		  AND pl.recipient_is_dummy
		  AND pl.expires_at > NOW()
		  AND pd.delivered_at <= NOW() - $2::interval
		FOR UPDATE OF pl SKIP LOCKED
	`, planeID, dummyDelayInterval()).Scan(
		&senderID, &deliveryID, &recipient.AccountID, &name, &username, &avatar, &city, &country,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE plane_deliveries SET status = 'accepted', responded_at = NOW()
		WHERE id = $1 AND status = 'pending'
	`, deliveryID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE planes SET status = 'accepted', next_attempt_at = NULL, updated_at = NOW()
		WHERE id = $1 AND status = 'pending'
	`, planeID); err != nil {
		return err
	}
	hops, rejections, err := planeCounts(ctx, tx, planeID)
	if err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	recipient.Name, recipient.Username, recipient.AvatarURL = name.String, username.String, avatar.String
	recipient.City, recipient.Country = city.String, country.String
	s.notifyOutbox(senderID, OutboxEvent{
		PlaneID: planeID.String(), State: StateAccepted, Status: StatusAccepted,
		Hops: hops, Rejections: rejections, RecipientIsDummy: true,
		Recipient: recipientPreview(recipient),
	})
	return nil
}
