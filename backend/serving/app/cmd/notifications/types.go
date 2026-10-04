package notifications

import (
	"time"

	"lib/stdid"
)

type Kind string

const (
	KindPlaneReceived Kind = "plane-received"
	KindPlaneAccepted Kind = "plane-accepted"
	KindMessage       Kind = "message"
)

type Notification struct {
	ID        stdid.UUID `json:"id"`
	Kind      Kind       `json:"kind"`
	Title     string     `json:"title"`
	Body      string     `json:"body,omitempty"`
	FromName  string     `json:"fromName,omitempty"`
	DeepLink  string     `json:"deepLink,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	Read      bool       `json:"read"`
}
