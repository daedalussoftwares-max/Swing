package planes

import (
	"time"

	"lib/stdid"
)

const (
	MaxMessageLen       = 200
	PlaneLifetime       = 24 * time.Hour
	MaxInboxPer24h      = 5
	ResendCooldown      = 30 * 24 * time.Hour
	MaxCandidatePool    = 300
	InitialPlaneBalance = 5
	// DummyAcceptDelay is how long a plane stays "pending" before the dummy
	// recipient auto-accepts (no chat — status-only).
	DummyAcceptDelay = 10 * time.Second

	// MaxRadiusKm bounds the radius filter (half the Earth's circumference).
	MaxRadiusKm = 20000
	// MinAge / MaxAge bound the age filter; MaxAge means "no upper bound".
	MinAge = 18
	MaxAge = 99
)

// State is the sender-facing lifecycle of a plane (outbox + realtime).
type State string

const (
	// StateSearching: accepted by the API, waiting for the dispatcher to pick
	// a recipient (also after a reject, before the next hop).
	StateSearching State = "searching"
	// StateDelivered: sitting in exactly one recipient's inbox.
	StateDelivered State = "delivered"
	StateAccepted  State = "accepted"
	StateExpired   State = "expired"
)

type Status string

const (
	StatusPending  Status = "pending"
	StatusAccepted Status = "accepted"
	StatusExpired  Status = "expired"
)

type DeliveryStatus string

const (
	DeliveryPending  DeliveryStatus = "pending"
	DeliveryAccepted DeliveryStatus = "accepted"
	DeliveryRejected DeliveryStatus = "rejected"
)

type Filters struct {
	RadiusKm *float64 `json:"radiusKm,omitempty"`
	Country  *string  `json:"country,omitempty"`
	Gender   *string  `json:"gender,omitempty"` // any | female | male | non-binary
	AgeRange *[2]int  `json:"ageRange,omitempty"`
}

type Profile struct {
	AccountID    stdid.UUID
	Interests    string
	CreatedAt    time.Time
	LastActiveAt time.Time
	Name         string
	Username     string
	AvatarURL    string
	City         string
	Country      string
	Gender       string
	DOB          *time.Time
	IsDummy      bool
	// Coarse location (~1 km); nil when unknown.
	Lat *float64
	Lng *float64
}

// Candidate is a matchable profile plus the behavioural signals the scorer uses.
type Candidate struct {
	Profile
	// PendingInbox: undecided planes currently in this person's inbox.
	PendingInbox int
	// Received24h: planes delivered to this person in the last 24h.
	Received24h int
	// Accepted90d / Responded90d: accept history over the last 90 days.
	Accepted90d  int
	Responded90d int
	// LastFilters: filters on the most recent plane this person SENT — a
	// proxy for who they want to meet (mutual-preference fit). Nil if none.
	LastFilters *Filters
}

type ScoredCandidate struct {
	Candidate
	Score     float64
	Breakdown ScoreBreakdown
}

type RecipientPreview struct {
	ID        stdid.UUID `json:"id"`
	Name      string     `json:"name"`
	AvatarURL string     `json:"avatarUrl,omitempty"`
	Location  string     `json:"location,omitempty"`
	Age       *int       `json:"age,omitempty"`
}

type SenderPreview struct {
	ID        stdid.UUID `json:"id"`
	Name      string     `json:"name"`
	AvatarURL string     `json:"avatarUrl,omitempty"`
	City      string     `json:"city,omitempty"`
	Country   string     `json:"country,omitempty"`
}

type Plane struct {
	ID               stdid.UUID        `json:"id"`
	Message          string            `json:"message"`
	Status           Status            `json:"status"`
	State            State             `json:"state"`
	Hops             int               `json:"hops"`
	Rejections       int               `json:"rejections"`
	Filters          Filters           `json:"filters,omitempty"`
	SentAt           time.Time         `json:"sentAt"`
	ExpiresAt        time.Time         `json:"expiresAt"`
	RespondedAt      *time.Time        `json:"respondedAt,omitempty"`
	RecipientIsDummy bool              `json:"recipientIsDummy,omitempty"`
	ChatID           *string           `json:"chatId,omitempty"`
	Recipient        *RecipientPreview `json:"recipient,omitempty"`
	Sender           *SenderPreview    `json:"sender,omitempty"`
}

type SendInput struct {
	Message string
	Filters Filters
}
