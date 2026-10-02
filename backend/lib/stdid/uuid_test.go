package stdid

import (
	"encoding/json"
	"testing"
)

func TestUUID_Scan_postgresBytes(t *testing.T) {
	raw, err := Parse("550e8400-e29b-41d4-a716-446655440000")
	if err != nil {
		t.Fatal(err)
	}
	var u UUID
	if err := u.Scan(raw[:]); err != nil {
		t.Fatalf("scan 16 bytes: %v", err)
	}
	if u.String() != "550e8400-e29b-41d4-a716-446655440000" {
		t.Fatalf("got %s", u.String())
	}
}

func TestUUID_Value(t *testing.T) {
	u, _ := Parse("550e8400-e29b-41d4-a716-446655440000")
	v, err := u.Value()
	if err != nil {
		t.Fatal(err)
	}
	if v != "550e8400-e29b-41d4-a716-446655440000" {
		t.Fatalf("got %v", v)
	}
}

func TestUUID_MarshalJSON(t *testing.T) {
	u, err := Parse("550e8400-e29b-41d4-a716-446655440000")
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(u)
	if err != nil {
		t.Fatal(err)
	}
	want := `"550e8400-e29b-41d4-a716-446655440000"`
	if string(b) != want {
		t.Fatalf("got %s want %s", b, want)
	}
}

func TestUUID_UnmarshalJSON(t *testing.T) {
	var u UUID
	if err := json.Unmarshal([]byte(`"d1000001-0000-4000-8000-000000000001"`), &u); err != nil {
		t.Fatal(err)
	}
	if u.String() != "d1000001-0000-4000-8000-000000000001" {
		t.Fatalf("got %s", u.String())
	}
}
