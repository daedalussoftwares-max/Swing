package planes

import (
	"time"

	"lib/stdid"
)

const (
	MaxMessageLen      = 200
	PlaneLifetime      = 24 * time.Hour
	MaxInboxPer24h     = 5
	ResendCooldown     = 30 * 24 * time.Hour
	MaxCandidatePool   = 200
	InitialPlaneBalance = 5
	// DummyAcceptDelay is how long a plane stays "pending" before the dummy
	// recipient auto-accepts (no chat — status-only).
	DummyAcceptDelay = 10 * time.Second
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
}

type Candidate struct {
	Profile
}

type ScoredCandidate struct {
	Candidate
	Score float64
}

type RecipientPreview struct {
	ID        stdid.UUID `json:"id"`
	Name      string     `json:"name"`
	AvatarURL string     `json:"avatarUrl,omitempty"`
	Location  string     `json:"location,omitempty"`
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
