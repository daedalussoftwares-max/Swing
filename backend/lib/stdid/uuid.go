package stdid

import (
	"crypto/rand"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// UUID is RFC 4122 version 4 (stdlib only).
type UUID [16]byte

func New() (UUID, error) {
	var u UUID
	if _, err := rand.Read(u[:]); err != nil {
		return UUID{}, err
	}
	u[6] = (u[6] & 0x0f) | 0x40
	u[8] = (u[8] & 0x3f) | 0x80
	return u, nil
}

func Parse(s string) (UUID, error) {
	s = strings.ReplaceAll(s, "-", "")
	if len(s) != 32 {
		return UUID{}, fmt.Errorf("invalid uuid")
	}
	raw, err := hex.DecodeString(s)
	if err != nil || len(raw) != 16 {
		return UUID{}, fmt.Errorf("invalid uuid")
	}
	var u UUID
	copy(u[:], raw)
	return u, nil
}

func (u UUID) String() string {
	h := hex.EncodeToString(u[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}

func (u UUID) IsZero() bool {
	return u == UUID{}
}

// MarshalJSON encodes UUIDs as RFC 4122 strings for API responses.
func (u UUID) MarshalJSON() ([]byte, error) {
	return json.Marshal(u.String())
}

// UnmarshalJSON accepts a quoted UUID string in request bodies.
func (u *UUID) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	if s == "" {
		*u = UUID{}
		return nil
	}
	parsed, err := Parse(s)
	if err != nil {
		return err
	}
	*u = parsed
	return nil
}

// Scan implements sql.Scanner for Postgres UUID columns (lib/pq sends 16 raw bytes).
func (u *UUID) Scan(value any) error {
	if value == nil {
		return fmt.Errorf("null uuid")
	}
	switch v := value.(type) {
	case string:
		parsed, err := Parse(v)
		if err != nil {
			return err
		}
		*u = parsed
		return nil
	case []byte:
		if len(v) == 16 {
			copy(u[:], v)
			return nil
		}
		parsed, err := Parse(string(v))
		if err != nil {
			return err
		}
		*u = parsed
		return nil
	default:
		return fmt.Errorf("unsupported uuid type %T", value)
	}
}

// Value implements driver.Valuer for INSERT/UPDATE with UUID columns.
func (u UUID) Value() (driver.Value, error) {
	if u.IsZero() {
		return nil, fmt.Errorf("zero uuid")
	}
	return u.String(), nil
}
