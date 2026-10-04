package sideeffects

import (
	"context"
	"fmt"
	"strings"
	"time"

	"lib/stdid"

	"serving/app/cmd/chats"
	"serving/app/cmd/notifications"
	"serving/app/cmd/planes"
	"serving/app/cmd/push"
	"serving/app/pkg/logx"
	"serving/app/pkg/realtime"
)

const pushTimeout = 15 * time.Second

// PlaneSink wires plane lifecycle events to notifications, chat seeding
// and mobile push.
type PlaneSink struct {
	Notifications *notifications.Service
	Chats         *chats.Service
	Hub           *realtime.Hub
	Push          push.Pusher
}

func (p *PlaneSink) PlaneDelivered(
	ctx context.Context,
	recipientID stdid.UUID,
	senderName, planeID, preview string,
) error {
	p.pushAsync(ctx, recipientID, push.Notification{
		Title: "✈️ A paper plane landed!",
		Body:  pushPreview(preview, "Open Swing to catch it."),
		Data: map[string]string{
			"type":    "plane_received",
			"planeId": planeID,
		},
	})
	if p.Notifications == nil {
		return nil
	}
	title := fmt.Sprintf("New plane from %s", senderName)
	_, err := p.Notifications.Create(
		ctx,
		recipientID,
		notifications.KindPlaneReceived,
		title,
		preview,
		senderName,
		fmt.Sprintf("/plane/%s", planeID),
	)
	if err != nil {
		return err
	}
	if p.Hub != nil {
		p.Hub.BroadcastToUser(recipientID, "plane.inbox.updated", map[string]string{
			"planeId": planeID,
		})
	}
	return nil
}

func (p *PlaneSink) PlaneAccepted(
	ctx context.Context,
	senderID, recipientID stdid.UUID,
	accepterName, planeID, chatID, planeMessage string,
	sentAt time.Time,
) error {
	chatUUID, err := stdid.Parse(chatID)
	if err != nil {
		return err
	}
	if p.Chats != nil {
		if err := p.Chats.SeedPlaneMessage(ctx, chatUUID, senderID, planeMessage, sentAt); err != nil {
			return err
		}
		_ = p.Chats.MarkRead(ctx, recipientID, chatUUID, 0)
	}
	name := strings.TrimSpace(accepterName)
	if name == "" {
		name = "Someone"
	}
	p.pushAsync(ctx, senderID, push.Notification{
		Title: fmt.Sprintf("%s caught your plane ✈️", name),
		Body:  "Say hi, your chat is ready.",
		Data: map[string]string{
			"type":    "plane_accepted",
			"planeId": planeID,
			"chatId":  chatID,
		},
		ThreadID: chatID,
	})
	if p.Notifications != nil {
		title := fmt.Sprintf("%s accepted your plane", accepterName)
		_, err := p.Notifications.Create(
			ctx,
			senderID,
			notifications.KindPlaneAccepted,
			title,
			"Tap to start chatting",
			accepterName,
			fmt.Sprintf("/chat/%s", chatID),
		)
		return err
	}
	return nil
}

// pushAsync sends a push off the request path, only when the user's app
// is not in the foreground (the WebSocket covers foreground delivery).
func (p *PlaneSink) pushAsync(ctx context.Context, userID stdid.UUID, n push.Notification) {
	if p.Push == nil || userID.IsZero() {
		return
	}
	if p.Hub != nil && p.Hub.IsForeground(userID) {
		return
	}
	ctx = context.WithoutCancel(ctx)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logx.Error("push: plane sink panic", fmt.Errorf("%v", r))
			}
		}()
		ctx, cancel := context.WithTimeout(ctx, pushTimeout)
		defer cancel()
		if err := p.Push.Notify(ctx, userID, n); err != nil {
			logx.Warn("push: plane notification failed", "type", n.Data["type"], "err", err.Error())
		}
	}()
}

func pushPreview(s, fallback string) string {
	s = strings.Join(strings.Fields(s), " ")
	if s == "" {
		return fallback
	}
	r := []rune(s)
	if len(r) > 120 {
		return string(r[:119]) + "…"
	}
	return s
}

func NewPlaneSink(
	n *notifications.Service,
	c *chats.Service,
	hub *realtime.Hub,
	pusher push.Pusher,
) planes.EventSink {
	if pusher == nil {
		pusher = push.Noop{}
	}
	return &PlaneSink{Notifications: n, Chats: c, Hub: hub, Push: pusher}
}
