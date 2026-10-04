package push

import (
	"context"

	"lib/stdid"
)

// Notification is a provider-agnostic push payload.
type Notification struct {
	Title string
	Body  string
	// Data is delivered to the app untouched (all values are strings).
	// Always set "type" (e.g. "chat_message", "plane_received",
	// "plane_accepted") plus the ids the app needs to deep-link.
	Data map[string]string
	// ThreadID groups notifications per conversation (iOS thread-id,
	// Android tag) so a chat shows as one stack and updates in place.
	ThreadID string
}

// Pusher sends mobile push notifications to every registered device of
// an account. Implementations must be safe for concurrent use and must
// not block for long; callers already invoke them off the request path.
type Pusher interface {
	Notify(ctx context.Context, recipientID stdid.UUID, n Notification) error
}

// Noop is used when no push provider is configured.
type Noop struct{}

func (Noop) Notify(context.Context, stdid.UUID, Notification) error { return nil }
