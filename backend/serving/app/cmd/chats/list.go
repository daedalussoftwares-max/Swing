package chats

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"lib/stdid"
)

type ListMessagesOpts struct {
	BeforeSeq *int64
	AfterSeq  *int64
	Limit     int
}

func (s *Service) List(ctx context.Context, accountID stdid.UUID) ([]ChatSummary, error) {
	// Last message and unread count are computed per viewer so messages
	// hidden from me (deleted-for-me, or sent while I had blocked the
	// sender) never surface in my list or badge.
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			c.id, c.created_at, c.plane_id, c.next_seq,
			p.account_id, p.name, p.username, p.avatar_url, p.city, p.country,
			ps.last_active_at,
			COALESCE(unread.n, 0)::int AS unread,
			cus.pinned_at,
			EXISTS (
				SELECT 1 FROM user_blocks b
				WHERE b.blocker_id = $1 AND b.blocked_id = p.account_id
			) AS blocked_by_me,
			lm.id, lm.seq, lm.client_msg_id, lm.sender_account_id, lm.type, lm.body, lm.media,
			lm.reply_to_id, lm.forwarded, lm.edited_at, lm.deleted_at, lm.created_at,
			lm.view_once, lm.viewed_at
		FROM chats c
		JOIN profiles p ON p.account_id = CASE
			WHEN c.account_a = $1 THEN c.account_b
			ELSE c.account_a
		END
		LEFT JOIN chat_read_state crs ON crs.chat_id = c.id AND crs.account_id = $1
		LEFT JOIN chat_user_state cus ON cus.chat_id = c.id AND cus.account_id = $1
		LEFT JOIN profile_stats ps ON ps.account_id = p.account_id
		LEFT JOIN LATERAL (
			SELECT m.* FROM chat_messages m
			WHERE m.chat_id = c.id
			  AND NOT EXISTS (
				SELECT 1 FROM chat_message_hidden h
				WHERE h.message_id = m.id AND h.account_id = $1
			  )
			ORDER BY m.seq DESC
			LIMIT 1
		) lm ON TRUE
		LEFT JOIN LATERAL (
			SELECT count(*) AS n FROM chat_messages m
			WHERE m.chat_id = c.id
			  AND m.seq > COALESCE(crs.last_read_seq, 0)
			  AND m.sender_account_id <> $1
			  AND m.deleted_at IS NULL
			  AND NOT EXISTS (
				SELECT 1 FROM chat_message_hidden h
				WHERE h.message_id = m.id AND h.account_id = $1
			  )
		) unread ON TRUE
		WHERE c.account_a = $1 OR c.account_b = $1
		ORDER BY COALESCE(lm.created_at, c.created_at) DESC
	`, accountID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var summaries []ChatSummary
	for rows.Next() {
		var sum ChatSummary
		var planeID sql.NullString
		var name, username, avatar, city, country sql.NullString
		var lastActive sql.NullTime
		var pinnedAt sql.NullTime
		var lmID sql.NullString
		var lmSeq sql.NullInt64
		var lmClient sql.NullString
		var lmSender sql.NullString
		var lmType sql.NullString
		var lmBody sql.NullString
		var lmMedia []byte
		var lmReply sql.NullString
		var lmFwd sql.NullBool
		var lmEdited, lmDeleted sql.NullTime
		var lmCreated sql.NullTime
		var lmViewOnce sql.NullBool
		var lmViewedAt sql.NullTime

		if err := rows.Scan(
			&sum.ID, &sum.CreatedAt, &planeID, &sum.NextSeq,
			&sum.Partner.ID, &name, &username, &avatar, &city, &country,
			&lastActive,
			&sum.UnreadCount,
			&pinnedAt, &sum.BlockedByMe,
			&lmID, &lmSeq, &lmClient, &lmSender, &lmType, &lmBody, &lmMedia,
			&lmReply, &lmFwd, &lmEdited, &lmDeleted, &lmCreated,
			&lmViewOnce, &lmViewedAt,
		); err != nil {
			return nil, err
		}
		sum.Partner.Name = coalesceName(name.String, username.String)
		if avatar.Valid {
			sum.Partner.AvatarURL = avatar.String
		}
		if city.Valid {
			sum.Partner.City = city.String
		}
		if country.Valid {
			sum.Partner.Country = country.String
		}
		if lastActive.Valid {
			t := lastActive.Time
			sum.Partner.LastActiveAt = &t
		}
		if s.hub != nil && !sum.BlockedByMe && !s.HasBlocked(ctx, sum.Partner.ID, accountID) {
			sum.Partner.Online = s.hub.IsOnline(sum.Partner.ID)
		}
		if pinnedAt.Valid {
			t := pinnedAt.Time
			sum.PinnedAt = &t
		}
		if planeID.Valid {
			pid, err := stdid.Parse(planeID.String)
			if err == nil {
				sum.PlaneID = &pid
			}
		}
		if lmID.Valid && lmSender.Valid && lmCreated.Valid {
			lmUUID, _ := stdid.Parse(lmID.String)
			senderUUID, _ := stdid.Parse(lmSender.String)
			msgType := TypeText
			if lmType.Valid {
				msgType = lmType.String
			}
			last := Message{
				ID:        lmUUID,
				ChatID:    sum.ID,
				Seq:       lmSeq.Int64,
				SenderID:  senderUUID,
				Type:      msgType,
				Forwarded: lmFwd.Valid && lmFwd.Bool,
				CreatedAt: lmCreated.Time,
			}
			if lmClient.Valid {
				last.ClientMsgID = lmClient.String
			}
			if lmBody.Valid {
				last.Body = &lmBody.String
			}
			last.ViewOnce = lmViewOnce.Valid && lmViewOnce.Bool
			if lmViewedAt.Valid {
				t := lmViewedAt.Time
				last.ViewedAt = &t
			}
			if len(lmMedia) > 0 {
				meta, _ := parseMediaJSON(lmMedia)
				if last.ViewOnce {
					last.Media = viewOnceMedia(meta)
				} else {
					last.Media = s.signMedia(ctx, meta)
				}
			}
			if lmReply.Valid {
				rid, err := stdid.Parse(lmReply.String)
				if err == nil {
					last.ReplyToID = &rid
				}
			}
			if lmEdited.Valid {
				t := lmEdited.Time
				last.EditedAt = &t
			}
			if lmDeleted.Valid {
				t := lmDeleted.Time
				last.DeletedAt = &t
			}
			sum.LastMessage = &last
		}
		summaries = append(summaries, sum)
	}
	return summaries, rows.Err()
}

func (s *Service) ListMessages(
	ctx context.Context,
	accountID, chatID stdid.UUID,
	opts ListMessagesOpts,
) ([]Message, error) {
	if !s.isMember(ctx, accountID, chatID) {
		return nil, ErrForbidden
	}
	limit := opts.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	orderAsc := opts.AfterSeq != nil
	query := `
		SELECT
			m.id, m.chat_id, m.seq, m.client_msg_id, m.sender_account_id, m.type, m.body, m.media,
			m.reply_to_id::text, m.forwarded, m.view_once, m.viewed_at, m.edited_at, m.deleted_at, m.created_at,
			COALESCE((
				SELECT json_agg(json_build_object(
					'accountId', r.account_id::text,
					'emoji', r.emoji,
					'createdAt', r.created_at
				) ORDER BY r.created_at)
				FROM chat_message_reactions r WHERE r.message_id = m.id
			), '[]'::json) AS reactions,
			COALESCE((
				SELECT json_agg(json_build_object(
					'accountId', st.account_id::text,
					'deliveredAt', st.delivered_at,
					'readAt', st.read_at
				))
				FROM chat_message_status st WHERE st.message_id = m.id
			), '[]'::json) AS status
		FROM chat_messages m
		WHERE m.chat_id = $1
		  AND NOT EXISTS (
		    SELECT 1 FROM chat_message_hidden h
		    WHERE h.message_id = m.id AND h.account_id = $2
		  )
	`
	args := []any{chatID, accountID}
	argN := 3
	if opts.BeforeSeq != nil {
		query += fmt.Sprintf(` AND m.seq < $%d`, argN)
		args = append(args, *opts.BeforeSeq)
		argN++
	}
	if opts.AfterSeq != nil {
		query += fmt.Sprintf(` AND m.seq > $%d`, argN)
		args = append(args, *opts.AfterSeq)
		argN++
	}
	if orderAsc {
		query += ` ORDER BY m.seq ASC`
	} else {
		query += ` ORDER BY m.seq DESC`
	}
	query += fmt.Sprintf(` LIMIT $%d`, argN)
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Message
	for rows.Next() {
		msg, err := scanMessageFromRows(ctx, s, rows)
		if err != nil {
			return nil, err
		}
		out = append(out, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !orderAsc {
		// return oldest-first for UI
		for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
			out[i], out[j] = out[j], out[i]
		}
	}
	return out, nil
}

// ListMessagesLegacy ignores cursors (controller compat during migration).
func (s *Service) ListMessagesLegacy(
	ctx context.Context,
	accountID, chatID stdid.UUID,
	limit int,
) ([]Message, error) {
	return s.ListMessages(ctx, accountID, chatID, ListMessagesOpts{Limit: limit})
}

func scanMessageFromRows(ctx context.Context, s *Service, rows *sql.Rows) (Message, error) {
	var id, chatID, senderID stdid.UUID
	var seq int64
	var clientMsgID sql.NullString
	var msgType string
	var body sql.NullString
	var mediaRaw []byte
	var replyTo sql.NullString
	var forwarded, viewOnce bool
	var viewedAt sql.NullTime
	var editedAt, deletedAt sql.NullTime
	var createdAt time.Time
	var reactionsRaw, statusRaw []byte

	err := rows.Scan(
		&id, &chatID, &seq, &clientMsgID, &senderID, &msgType, &body, &mediaRaw,
		&replyTo, &forwarded, &viewOnce, &viewedAt, &editedAt, &deletedAt, &createdAt,
		&reactionsRaw, &statusRaw,
	)
	if err != nil {
		return Message{}, err
	}
	return scanMessage(ctx, s, stdid.UUID{}, id, chatID, seq, clientMsgID, senderID, msgType, body, mediaRaw, replyTo, forwarded, viewOnce, viewedAt, editedAt, deletedAt, createdAt, reactionsRaw, statusRaw)
}

func scanMessageRow(ctx context.Context, s *Service, row *sql.Row) (Message, error) {
	var id, chatID, senderID stdid.UUID
	var seq int64
	var clientMsgID sql.NullString
	var msgType string
	var body sql.NullString
	var mediaRaw []byte
	var replyTo sql.NullString
	var forwarded, viewOnce bool
	var viewedAt sql.NullTime
	var editedAt, deletedAt sql.NullTime
	var createdAt time.Time

	err := row.Scan(
		&id, &chatID, &seq, &clientMsgID, &senderID, &msgType, &body, &mediaRaw,
		&replyTo, &forwarded, &viewOnce, &viewedAt, &editedAt, &deletedAt, &createdAt,
	)
	if err != nil {
		return Message{}, err
	}
	return scanMessage(ctx, s, stdid.UUID{}, id, chatID, seq, clientMsgID, senderID, msgType, body, mediaRaw, replyTo, forwarded, viewOnce, viewedAt, editedAt, deletedAt, createdAt, nil, nil)
}
