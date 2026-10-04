package chats

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"lib/stdid"

	"serving/app/cmd/notifications"
	"serving/app/cmd/push"
)

func (s *Service) Send(
	ctx context.Context,
	accountID, chatID stdid.UUID,
	in SendInput,
) (Message, error) {
	msgType := strings.TrimSpace(in.Type)
	if msgType == "" {
		msgType = TypeText
	}
	body := strings.TrimSpace(in.Body)
	if msgType == TypeText {
		if body == "" {
			return Message{}, ErrEmptyMessage
		}
		if len(body) > maxMessageLen {
			return Message{}, ErrInvalidInput
		}
	}
	if err := validateMediaType(msgType, in.Media); err != nil {
		return Message{}, err
	}
	if err := validateMediaSize(msgType, in.Media); err != nil {
		return Message{}, err
	}
	if in.Media != nil {
		if err := s.ensureMediaKeyOwned(ctx, accountID, chatID, in.Media.R2Key); err != nil {
			return Message{}, err
		}
	}
	partnerID, err := s.partnerID(ctx, accountID, chatID)
	if err != nil {
		return Message{}, err
	}
	if s.HasBlocked(ctx, accountID, partnerID) {
		return Message{}, ErrBlocked
	}
	// View-once only makes sense for media.
	viewOnce := in.ViewOnce && in.Media != nil && msgType != TypeText

	// Partner blocked me: store the message but never deliver it to them.
	deliver := !s.HasBlocked(ctx, partnerID, accountID)

	clientMsgID := strings.TrimSpace(in.ClientMsgID)

	msgID, err := stdid.New()
	if err != nil {
		return Message{}, err
	}
	now := time.Now().UTC()

	if in.Media != nil && strings.TrimSpace(in.Media.R2Key) == "" {
		in.Media = nil
	}
	mediaJSON, err := mediaToJSON(in.Media)
	if err != nil {
		return Message{}, err
	}
	mediaArg := jsonbParam(mediaJSON)

	var bodyVal interface{}
	if msgType == TypeText {
		bodyVal = body
	} else if body != "" {
		bodyVal = body
	}

	var reply interface{}
	if in.ReplyToID != nil && !in.ReplyToID.IsZero() {
		reply = *in.ReplyToID
	}

	// One statement == one round trip to the (remote) database. It bumps
	// the chat seq, inserts the message + partner receipt row, and advances
	// the sender's own read cursor so their message never counts as unread
	// for themselves. A duplicate client_msg_id aborts the whole statement
	// (unique index), in which case we return the already-stored message.
	var seq int64
	err = s.db.QueryRowContext(ctx, `
		WITH bump AS (
			UPDATE chats
			SET next_seq = next_seq + 1, last_message_id = $1, last_message_at = $9
			WHERE id = $2
			RETURNING next_seq
		), ins AS (
			INSERT INTO chat_messages (
				id, chat_id, seq, client_msg_id, sender_account_id, type, body, media,
				reply_to_id, forwarded, created_at, view_once
			)
			SELECT $1, $2, bump.next_seq, $3, $4, $5, $6, $7, $8, $10, $9, $13 FROM bump
			RETURNING seq
		), receipt AS (
			INSERT INTO chat_message_status (message_id, account_id)
			SELECT $1, $11 FROM ins WHERE $12
			ON CONFLICT DO NOTHING
		), hidden AS (
			INSERT INTO chat_message_hidden (message_id, account_id)
			SELECT $1, $11 FROM ins WHERE NOT $12
			ON CONFLICT DO NOTHING
		), self_read AS (
			INSERT INTO chat_read_state (chat_id, account_id, last_read_at, last_read_seq)
			SELECT $2, $4, $9, ins.seq FROM ins
			ON CONFLICT (chat_id, account_id) DO UPDATE
			SET last_read_at = EXCLUDED.last_read_at,
			    last_read_seq = GREATEST(chat_read_state.last_read_seq, EXCLUDED.last_read_seq)
		)
		SELECT seq FROM ins
	`, msgID, chatID, nullString(clientMsgID), accountID, msgType, bodyVal, mediaArg, reply, now, in.Forwarded, partnerID, deliver, viewOnce).Scan(&seq)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Message{}, ErrNotFound
		}
		if clientMsgID != "" {
			existing, found, lerr := s.loadMessageByClientID(ctx, chatID, clientMsgID)
			if lerr == nil && found {
				return existing, nil
			}
		}
		return Message{}, err
	}

	msg := Message{
		ID:          msgID,
		ChatID:      chatID,
		Seq:         seq,
		ClientMsgID: clientMsgID,
		SenderID:    accountID,
		Type:        msgType,
		Forwarded:   in.Forwarded,
		CreatedAt:   now,
	}
	if msgType == TypeText {
		msg.Body = &body
	} else if body != "" {
		msg.Body = &body
	}
	msg.ViewOnce = viewOnce
	if in.Media != nil {
		if viewOnce {
			msg.Media = viewOnceMedia(in.Media)
		} else {
			msg.Media = s.signMedia(ctx, in.Media)
		}
	}
	if in.ReplyToID != nil {
		msg.ReplyToID = in.ReplyToID
	}

	if s.hub != nil {
		payload := map[string]any{"message": msg, "chatId": chatID.String()}
		if deliver {
			s.hub.BroadcastToUser(partnerID, "message.new", payload)
		}
		s.hub.BroadcastToUser(accountID, "message.new", payload)
		if clientMsgID != "" {
			s.hub.BroadcastToUser(accountID, "message.ack", WSAck{
				ClientMsgID: clientMsgID,
				ID:          msgID.String(),
				Seq:         seq,
				CreatedAt:   now,
			})
		}
	}

	// Push whenever the partner's app isn't in the foreground (a socket
	// can stay alive briefly after backgrounding, so "online" is not
	// enough). Push + in-app notification need extra DB round trips;
	// never make the sender wait for them.
	if deliver && (s.hub == nil || !s.hub.IsForeground(partnerID)) {
		go s.notifyOffline(context.WithoutCancel(ctx), accountID, partnerID, chatID, msg)
	}

	return msg, nil
}

func (s *Service) notifyOffline(ctx context.Context, accountID, partnerID, chatID stdid.UUID, msg Message) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	preview := messagePreview(msg)
	senderName, _ := s.profileName(ctx, accountID)
	if senderName == "" {
		senderName = "New message"
	}
	_ = s.push.Notify(ctx, partnerID, push.Notification{
		Title: senderName,
		Body:  preview,
		Data: map[string]string{
			"type":      "chat_message",
			"chatId":    chatID.String(),
			"messageId": msg.ID.String(),
			"senderId":  accountID.String(),
		},
		ThreadID: chatID.String(),
	})
	if s.notify == nil || (s.hub != nil && s.hub.IsOnline(partnerID)) {
		return
	}
	_, _ = s.notify.Create(
		ctx,
		partnerID,
		notifications.KindMessage,
		"New message from "+senderName,
		preview,
		senderName,
		"/chat/"+chatID.String(),
	)
}

func (s *Service) loadMessageByClientID(
	ctx context.Context,
	chatID stdid.UUID,
	clientMsgID string,
) (Message, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, chat_id, seq, client_msg_id, sender_account_id, type, body, media,
			reply_to_id::text, forwarded, view_once, viewed_at, edited_at, deleted_at, created_at
		FROM chat_messages
		WHERE chat_id = $1 AND client_msg_id = $2
	`, chatID, clientMsgID)
	msg, err := scanMessageRow(ctx, s, row)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, false, nil
	}
	if err != nil {
		return Message{}, false, err
	}
	return msg, true, nil
}

func nullString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
