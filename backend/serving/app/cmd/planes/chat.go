package planes

import (
	"context"
	"database/sql"
	"time"

	"lib/stdid"
)

func createFriendshipTx(ctx context.Context, tx *sql.Tx, a, b stdid.UUID, at time.Time) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO friendships (account_a, account_b, created_at)
		VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid), $3)
		ON CONFLICT DO NOTHING
	`, a, b, at)
	return err
}

func createChatTx(
	ctx context.Context,
	tx *sql.Tx,
	a, b stdid.UUID,
	planeID stdid.UUID,
) (stdid.UUID, error) {
	chatID, err := stdid.New()
	if err != nil {
		return stdid.UUID{}, err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO chats (id, account_a, account_b, plane_id, created_at)
		VALUES (
			$1,
			LEAST($2::uuid, $3::uuid),
			GREATEST($2::uuid, $3::uuid),
			$4,
			NOW()
		)
		ON CONFLICT (account_a, account_b) DO UPDATE
		SET plane_id = COALESCE(chats.plane_id, EXCLUDED.plane_id)
	`, chatID, a, b, planeID)
	if err != nil {
		return stdid.UUID{}, err
	}

	var existing stdid.UUID
	err = tx.QueryRowContext(ctx, `
		SELECT id FROM chats
		WHERE account_a = LEAST($1::uuid, $2::uuid)
		  AND account_b = GREATEST($1::uuid, $2::uuid)
	`, a, b).Scan(&existing)
	if err != nil {
		return stdid.UUID{}, err
	}
	return existing, nil
}

// markPlaneAcceptedTx updates plane status only — used for dummy auto-accept
// (no friendship, no chat).
func markPlaneAcceptedTx(
	ctx context.Context,
	tx *sql.Tx,
	planeID stdid.UUID,
	recipientIsDummy bool,
	at time.Time,
) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE planes
		SET status = 'accepted', recipient_is_dummy = $2, updated_at = $3
		WHERE id = $1
	`, planeID, recipientIsDummy, at)
	return err
}

// finalizeRealAcceptTx runs when a real user accepts — opens friendship + chat.
func finalizeRealAcceptTx(
	ctx context.Context,
	tx *sql.Tx,
	planeID, senderID, recipientID stdid.UUID,
	at time.Time,
) (stdid.UUID, error) {
	if err := markPlaneAcceptedTx(ctx, tx, planeID, false, at); err != nil {
		return stdid.UUID{}, err
	}
	if err := createFriendshipTx(ctx, tx, senderID, recipientID, at); err != nil {
		return stdid.UUID{}, err
	}
	return createChatTx(ctx, tx, senderID, recipientID, planeID)
}

func spendPlaneTx(ctx context.Context, tx *sql.Tx, accountID stdid.UUID) error {
	res, err := tx.ExecContext(ctx, `
		UPDATE profile_stats
		SET planes_remaining = planes_remaining - 1, updated_at = NOW()
		WHERE account_id = $1 AND planes_remaining > 0
	`, accountID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrInsufficientPlanes
	}
	return nil
}
