package chats

import (
	"context"
	"database/sql"
	"errors"
	"sync"

	"lib/stdid"

	"serving/app/cmd/notifications"
	"serving/app/cmd/push"
	"serving/app/pkg/r2storage"
	"serving/app/pkg/realtime"
)

var (
	ErrNotFound         = errors.New("chat not found")
	ErrForbidden        = errors.New("forbidden")
	ErrInvalidInput     = errors.New("invalid input")
	ErrEmptyMessage     = errors.New("empty message")
	ErrMessageNotFound  = errors.New("message not found")
	ErrEditNotAllowed   = errors.New("edit not allowed")
	ErrDeleteNotAllowed = errors.New("delete not allowed")
	ErrBlocked          = errors.New("blocked")
)

const maxMessageLen = 4000

type Service struct {
	db     *sql.DB
	hub    *realtime.Hub
	notify *notifications.Service
	r2     *r2storage.Client
	push   push.Pusher

	memberCache sync.Map // stdid.UUID -> chatMembers
	blockCache  sync.Map // blockKey -> bool
}

func NewService(
	db *sql.DB,
	hub *realtime.Hub,
	notify *notifications.Service,
	r2 *r2storage.Client,
	pusher push.Pusher,
) *Service {
	if pusher == nil {
		pusher = push.Noop{}
	}
	return &Service{db: db, hub: hub, notify: notify, r2: r2, push: pusher}
}

// SendMessage sends plain text (legacy controller path).
func (s *Service) SendMessage(
	ctx context.Context,
	accountID, chatID stdid.UUID,
	body string,
) (Message, error) {
	return s.Send(ctx, accountID, chatID, SendInput{
		Type: TypeText,
		Body: body,
	})
}
