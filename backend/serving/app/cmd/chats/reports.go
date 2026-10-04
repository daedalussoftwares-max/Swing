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
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO reports (reporter_id, reported_id, chat_id, reason, details)
		VALUES ($1, $2, $3, $4, $5)
	`, reporterID, reportedID, chatID, reason, details); err != nil {
		return err
	}
	if alsoBlock {
		return s.Block(ctx, reporterID, reportedID)
	}
	return nil
}
