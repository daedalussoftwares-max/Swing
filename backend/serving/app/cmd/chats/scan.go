package chats

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"lib/stdid"
)

func scanMessage(
	ctx context.Context,
	s *Service,
	accountID stdid.UUID,
	id, chatID stdid.UUID,
	seq int64,
	clientMsgID sql.NullString,
	senderID stdid.UUID,
	msgType string,
	body sql.NullString,
	mediaRaw []byte,
	replyTo sql.NullString,
	forwarded bool,
	viewOnce bool,
	viewedAt sql.NullTime,
	editedAt, deletedAt sql.NullTime,
	createdAt time.Time,
	reactionsRaw, statusRaw []byte,
) (Message, error) {
	var m Message
	m.ID = id
	m.ChatID = chatID
	m.Seq = seq
	if clientMsgID.Valid {
		m.ClientMsgID = clientMsgID.String
	}
	m.SenderID = senderID
	m.Type = msgType
	if body.Valid {
		m.Body = &body.String
	}
	if len(mediaRaw) > 0 && !deletedAt.Valid {
		meta, err := parseMediaJSON(mediaRaw)
		if err != nil {
			return Message{}, err
		}
		if viewOnce {
			m.Media = viewOnceMedia(meta)
		} else {
			m.Media = s.signMedia(ctx, meta)
		}
	}
	m.ViewOnce = viewOnce
	if viewedAt.Valid {
		t := viewedAt.Time
		m.ViewedAt = &t
	}
	if replyTo.Valid {
		rid, err := stdid.Parse(replyTo.String)
		if err == nil {
			m.ReplyToID = &rid
		}
	}
	m.Forwarded = forwarded
	if editedAt.Valid {
		t := editedAt.Time
		m.EditedAt = &t
	}
	if deletedAt.Valid {
		t := deletedAt.Time
		m.DeletedAt = &t
	}
	m.CreatedAt = createdAt

	if len(reactionsRaw) > 0 {
		_ = json.Unmarshal(reactionsRaw, &m.Reactions)
	}
	if len(statusRaw) > 0 {
		_ = json.Unmarshal(statusRaw, &m.Status)
	}
	return m, nil
}

// viewOnceMedia strips everything that would let a client fetch the file
// (URL and storage key). The recipient gets a one-time URL from
// OpenViewOnce; nobody else ever does.
func viewOnceMedia(meta *MediaMeta) *MediaMeta {
	if meta == nil {
		return nil
	}
	return &MediaMeta{
		Mime:     meta.Mime,
		Size:     meta.Size,
		Width:    meta.Width,
		Height:   meta.Height,
		Duration: meta.Duration,
	}
}
