package planes

import (
	"context"
	"time"

	"lib/stdid"
)

// EventSink receives side effects after a plane is committed (notifications, etc.).
type EventSink interface {
	PlaneDelivered(ctx context.Context, recipientID stdid.UUID, senderName, planeID, preview string) error
	PlaneAccepted(
		ctx context.Context,
		senderID, recipientID stdid.UUID,
		accepterName, planeID, chatID, planeMessage string,
		sentAt time.Time,
	) error
}

// Notifier pushes realtime events to a user's connected clients
// (implemented by *realtime.Hub).
type Notifier interface {
	BroadcastToUser(userID stdid.UUID, eventType string, payload any)
}

const (
	// EventOutboxUpdated is sent to the SENDER whenever a plane changes state
	// (delivered, rejected → searching, accepted, expired).
	EventOutboxUpdated = "plane.outbox.updated"
	// EventInboxUpdated is sent to a RECIPIENT when a plane leaves their inbox
	// without them acting (expired). Deliveries emit it via EventSink.
	EventInboxUpdated = "plane.inbox.updated"
)

// OutboxEvent is the payload of EventOutboxUpdated.
type OutboxEvent struct {
	PlaneID          string            `json:"planeId"`
	State            State             `json:"state"`
	Status           Status            `json:"status"`
	Hops             int               `json:"hops"`
	Rejections       int               `json:"rejections"`
	RecipientIsDummy bool              `json:"recipientIsDummy,omitempty"`
	Recipient        *RecipientPreview `json:"recipient,omitempty"`
	ChatID           *string           `json:"chatId,omitempty"`
}

func (s *Service) notifyOutbox(senderID stdid.UUID, ev OutboxEvent) {
	if s.rt == nil {
		return
	}
	s.rt.BroadcastToUser(senderID, EventOutboxUpdated, ev)
}

func (s *Service) notifyInboxRemoved(recipientID stdid.UUID, planeID stdid.UUID, reason string) {
	if s.rt == nil || recipientID.IsZero() {
		return
	}
	s.rt.BroadcastToUser(recipientID, EventInboxUpdated, map[string]string{
		"planeId": planeID.String(),
		"reason":  reason,
	})
}
