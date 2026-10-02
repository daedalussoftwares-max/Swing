package planes

import (
	"testing"
	"time"
)

func TestInterestScore(t *testing.T) {
	t.Parallel()
	got := interestScore("music,film,coffee", "music,vinyl")
	if got != 5 {
		t.Fatalf("expected 5, got %v", got)
	}
	got = interestScore("a,b,c,d", "a,b,c,d,e")
	if got != 20 {
		t.Fatalf("expected cap 20, got %v", got)
	}
}

func TestLastActiveScore(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)
	if got := lastActiveScore(now.Add(-30*time.Minute), now); got != 30 {
		t.Fatalf("expected 30, got %v", got)
	}
	if got := lastActiveScore(now.Add(-48*time.Hour), now); got != 10 {
		t.Fatalf("expected 10, got %v", got)
	}
}

func TestNewcomerScore(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)
	if got := newcomerScore(now.Add(-2*24*time.Hour), now); got != 40 {
		t.Fatalf("expected 40, got %v", got)
	}
	if got := newcomerScore(now.Add(-90*24*time.Hour), now); got != 0 {
		t.Fatalf("expected 0, got %v", got)
	}
}

func TestSwingScoreMax(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)
	sender := Profile{Interests: "a,b,c,d"}
	candidate := Candidate{
		Profile: Profile{
			Interests:    "a,b,c,d,e",
			CreatedAt:    now.Add(-24 * time.Hour),
			LastActiveAt: now.Add(-15 * time.Minute),
		},
	}
	if got := SwingScore(sender, candidate, now); got != 90 {
		t.Fatalf("expected 90, got %v", got)
	}
}
