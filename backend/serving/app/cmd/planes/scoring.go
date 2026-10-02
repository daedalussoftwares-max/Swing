package planes

import (
	"strings"
	"time"
)

// SwingScore computes a 0–90 match score using the agreed weights:
//   - interests:    max 20 (20%)
//   - last_active:  max 30 (30%)
//   - newcomer:     max 40 (40%)
func SwingScore(sender Profile, candidate Candidate, now time.Time) float64 {
	return interestScore(sender.Interests, candidate.Interests) +
		lastActiveScore(candidate.LastActiveAt, now) +
		newcomerScore(candidate.CreatedAt, now)
}

func interestScore(senderInterests, candidateInterests string) float64 {
	overlap := interestOverlap(senderInterests, candidateInterests)
	score := float64(overlap) * 5
	if score > 20 {
		return 20
	}
	return score
}

func lastActiveScore(lastActiveAt, now time.Time) float64 {
	if lastActiveAt.IsZero() {
		return 0
	}
	hours := now.Sub(lastActiveAt).Hours()
	switch {
	case hours <= 1:
		return 30
	case hours <= 6:
		return 24
	case hours <= 24:
		return 18
	case hours <= 72:
		return 10
	case hours <= 168:
		return 4
	default:
		return 0
	}
}

func newcomerScore(createdAt, now time.Time) float64 {
	if createdAt.IsZero() {
		return 0
	}
	days := now.Sub(createdAt).Hours() / 24
	switch {
	case days <= 3:
		return 40
	case days <= 7:
		return 32
	case days <= 14:
		return 24
	case days <= 30:
		return 16
	case days <= 60:
		return 8
	default:
		return 0
	}
}

func parseInterests(csv string) map[string]struct{} {
	out := make(map[string]struct{})
	for _, part := range strings.Split(csv, ",") {
		tag := strings.TrimSpace(strings.ToLower(part))
		if tag == "" {
			continue
		}
		out[tag] = struct{}{}
		if len(out) >= 8 {
			break
		}
	}
	return out
}

func interestOverlap(aCSV, bCSV string) int {
	a := parseInterests(aCSV)
	b := parseInterests(bCSV)
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	n := 0
	for tag := range a {
		if _, ok := b[tag]; ok {
			n++
		}
	}
	return n
}
