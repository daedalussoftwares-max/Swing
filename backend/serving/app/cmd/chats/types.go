package chats

import (
	"encoding/json"
	"time"

	"lib/stdid"
)

const (
	TypeText     = "text"
	TypeImage    = "image"
	TypeVideo    = "video"
	TypeAudio    = "audio"
	TypeDocument = "document"
	TypeSticker  = "sticker"
)

const EditWindow = 15 * time.Minute

type PartnerPreview struct {
	ID           stdid.UUID `json:"id"`
	Name         string     `json:"name"`
	AvatarURL    string     `json:"avatarUrl,omitempty"`
	City         string     `json:"city,omitempty"`
	Country      string     `json:"country,omitempty"`
	LastActiveAt *time.Time `json:"lastActiveAt,omitempty"`
	Online       bool       `json:"online"`
}

type MediaMeta struct {
	R2Key    string `json:"r2_key"`
	Mime     string `json:"mime"`
	Size     int64  `json:"size"`
	Width    int    `json:"width,omitempty"`
	Height   int    `json:"height,omitempty"`
	Duration int    `json:"duration,omitempty"`
	ThumbKey string `json:"thumb_key,omitempty"`
	FileName string `json:"file_name,omitempty"`
	URL      string `json:"url,omitempty"`
}

type Reaction struct {
	AccountID stdid.UUID `json:"accountId"`
	Emoji     string     `json:"emoji"`
	CreatedAt time.Time  `json:"createdAt"`
}

type MessageStatus struct {
	AccountID   stdid.UUID `json:"accountId"`
	DeliveredAt *time.Time `json:"deliveredAt,omitempty"`
	ReadAt      *time.Time `json:"readAt,omitempty"`
}

type Message struct {
	ID          stdid.UUID      `json:"id"`
	ChatID      stdid.UUID      `json:"chatId"`
	Seq         int64           `json:"seq"`
	ClientMsgID string          `json:"clientMsgId,omitempty"`
	SenderID    stdid.UUID      `json:"senderId"`
	Type        string          `json:"type"`
	Body        *string         `json:"body,omitempty"`
	Media       *MediaMeta      `json:"media,omitempty"`
	ReplyToID   *stdid.UUID     `json:"replyToId,omitempty"`
	Forwarded   bool            `json:"forwarded"`
	ViewOnce    bool            `json:"viewOnce,omitempty"`
	ViewedAt    *time.Time      `json:"viewedAt,omitempty"`
	EditedAt    *time.Time      `json:"editedAt,omitempty"`
	DeletedAt   *time.Time      `json:"deletedAt,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
	Reactions   []Reaction      `json:"reactions,omitempty"`
	Status      []MessageStatus `json:"status,omitempty"`
}

type ChatSummary struct {
	ID          stdid.UUID     `json:"id"`
	Partner     PartnerPreview `json:"partner"`
	CreatedAt   time.Time      `json:"createdAt"`
	LastMessage *Message       `json:"lastMessage,omitempty"`
	UnreadCount int            `json:"unreadCount"`
	NextSeq     int64          `json:"nextSeq"`
	PlaneID     *stdid.UUID    `json:"planeId,omitempty"`
	PinnedAt    *time.Time     `json:"pinnedAt,omitempty"`
	BlockedByMe bool           `json:"blockedByMe"`
}

type SendInput struct {
	ClientMsgID string
	Type        string
	Body        string
	Media       *MediaMeta
	ReplyToID   *stdid.UUID
	Forwarded   bool
	ViewOnce    bool
}

// WS payloads (server → client)
type WSAck struct {
	ClientMsgID string    `json:"client_msg_id"`
	ID          string    `json:"id"`
	Seq         int64     `json:"seq"`
	CreatedAt   time.Time `json:"created_at"`
}

type WSMessageStatus struct {
	ChatID      string     `json:"chat_id,omitempty"`
	MessageID   string     `json:"message_id,omitempty"`
	UpToSeq     int64      `json:"up_to_seq,omitempty"`
	ReadAt      *time.Time `json:"read_at,omitempty"`
	DeliveredAt *time.Time `json:"delivered_at,omitempty"`
}

type MediaJSON MediaMeta

func (m MediaMeta) MarshalDB() ([]byte, error) {
	return json.Marshal(m)
}
