package chats

import (
	"context"
	"strings"

	"lib/stdid"
)

// ReportReasons are the reasons the app offers; anything else is rejected.
var ReportReasons = map[string]bool{
	"spam":          true,
	"harassment":    true,
	"inappropriate": true,
	"fake_profile":  true,
	"underage":      true,
	"other":         true,
}

// insertReportSQL stores a report together with an evidence snapshot, in a
// single round trip, so the evidence survives later account/chat deletion
// or message edits/deletes:
//   - reported_snapshot: the reported user's public profile right now
//   - messages_snapshot: the last 50 messages between the two in that chat
//     (oldest first), including deleted ones; NULL when no chat is given.
//
// $1 reporter, $2 reported, $3 chat (nullable), $4 reason, $5 details.
const insertReportSQL = `
	INSERT INTO reports (
		reporter_id, reported_id, chat_id, reason, details,
		reported_snapshot, messages_snapshot
	)
	SELECT
		$1::uuid, $2::uuid, $3::uuid, $4::text, $5::text,
		(
			SELECT jsonb_build_object(
				'name', p.name,
				'username', p.username,
				'bio', p.bio,
				'avatar_url', p.avatar_url
			)
			FROM profiles p
			WHERE p.account_id = $2::uuid
		),
		CASE WHEN $3::uuid IS NOT NULL THEN (
			SELECT COALESCE(jsonb_agg(jsonb_build_object(
				'id', m.id,
				'seq', m.seq,
				'sender_account_id', m.sender_account_id,
				'type', m.type,
				'body', m.body,
				'r2_key', m.media->>'r2_key',
				'created_at', m.created_at,
				'edited_at', m.edited_at,
				'deleted_at', m.deleted_at
			) ORDER BY m.seq), '[]'::jsonb)
			FROM (
				SELECT id, seq, sender_account_id, type, body, media,
					created_at, edited_at, deleted_at
				FROM chat_messages
				WHERE chat_id = $3::uuid
				  AND sender_account_id IN ($1::uuid, $2::uuid)
				ORDER BY seq DESC
				LIMIT 50
			) m
		) END
`

// Report stores a user report for moderation. When alsoBlock is set the
// reporter also blocks the reported person in the same call.
func (s *Service) Report(
	ctx context.Context,
	reporterID, reportedID stdid.UUID,
	chatID *stdid.UUID,
	reason, details string,
	alsoBlock bool,
) error {
	reason = strings.TrimSpace(strings.ToLower(reason))
	if reporterID == reportedID || reportedID.IsZero() || !ReportReasons[reason] {
		return ErrInvalidInput
	}
	details = strings.TrimSpace(details)
	if len(details) > 1000 {
		details = details[:1000]
	}
	if chatID != nil && !s.isMember(ctx, reporterID, *chatID) {
		chatID = nil
	}
	if _, err := s.db.ExecContext(ctx, insertReportSQL, reporterID, reportedID, chatID, reason, details); err != nil {
		return err
	}
	if alsoBlock {
		return s.Block(ctx, reporterID, reportedID)
	}
	return nil
}
