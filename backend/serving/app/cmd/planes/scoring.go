package planes

import (
	"cmp"
	"math"
	"math/rand/v2"
	"slices"
	"strings"
	"time"
)

// Matching score (see docs/matching.md).
//
// Every eligible candidate (hard filters + exclusions already applied in SQL)
// gets a score in [0, 100] made of three weighted entities:
//
//	entity              weight   formula
//	recently active      50 %    50 · (1 − hoursSinceLastActive / 72), 0 after 72 h
//	shared interests     30 %    30 · |A∩B| / min(|A|, |B|)   (overlap coefficient)
//	pending planes       20 %    20 · (1 − min(pendingInbox, 4) / 4)
//
// A recipient is then drawn by weighted random sampling among the top-K
// (TopK) with weight exp((score − best) / Temperature), so strong matches
// win most of the time without the same people receiving every plane.
const (
	WeightActivity  = 50.0
	WeightInterests = 30.0
	WeightPending   = 20.0

	// ActivityWindowH: activity older than this scores 0.
	ActivityWindowH = 72.0
	// PendingCap: this many (or more) unanswered planes → 0 for the entity.
	PendingCap = 4

	TopK        = 8
	Temperature = 6.0
)

type ScoreBreakdown struct {
	Activity  float64 `json:"activity"`
	Interests float64 `json:"interests"`
	Pending   float64 `json:"pending"`
	Total     float64 `json:"total"`
}

// ScoreCandidate computes the match score of candidate c for a plane from
// sender. Filters are hard constraints applied before scoring, so they don't
// affect the score.
func ScoreCandidate(sender Profile, c Candidate, _ Filters, now time.Time) ScoreBreakdown {
	b := ScoreBreakdown{
		Activity:  activityScore(c.LastActiveAt, now),
		Interests: WeightInterests * interestOverlap(sender.Interests, c.Interests),
		Pending:   pendingScore(c.PendingInbox),
	}
	b.Total = b.Activity + b.Interests + b.Pending
	return b
}

func activityScore(lastActiveAt, now time.Time) float64 {
	if lastActiveAt.IsZero() {
		return 0
	}
	hours := math.Max(0, now.Sub(lastActiveAt).Hours())
	if hours >= ActivityWindowH {
		return 0
	}
	return WeightActivity * (1 - hours/ActivityWindowH)
}

func pendingScore(pending int) float64 {
	p := float64(min(max(pending, 0), PendingCap))
	return WeightPending * (1 - p/float64(PendingCap))
}

func ageOn(dob, now time.Time) int {
	years := now.Year() - dob.Year()
	if now.Month() < dob.Month() || (now.Month() == dob.Month() && now.Day() < dob.Day()) {
		years--
	}
	return years
}

func parseInterests(csv string) map[string]struct{} {
	out := make(map[string]struct{})
	for _, part := range strings.Split(csv, ",") {
		tag := strings.TrimSpace(strings.ToLower(part))
		if tag == "" {
			continue
		}
		out[tag] = struct{}{}
		if len(out) >= 16 {
			break
		}
	}
	return out
}

// interestOverlap returns |A∩B| / min(|A|, |B|) over normalized interest
// tags (0 when either side has none). Unlike Jaccard it doesn't punish
// people who simply list many interests.
func interestOverlap(aCSV, bCSV string) float64 {
	a := parseInterests(aCSV)
	b := parseInterests(bCSV)
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	shared := 0
	for tag := range a {
		if _, ok := b[tag]; ok {
			shared++
		}
	}
	return float64(shared) / float64(min(len(a), len(b)))
}

// rankCandidates scores and sorts candidates (best first, ties by id for
// determinism). O(n log n).
func rankCandidates(sender Profile, cands []Candidate, f Filters, now time.Time) []ScoredCandidate {
	scored := make([]ScoredCandidate, len(cands))
	for i, c := range cands {
		b := ScoreCandidate(sender, c, f, now)
		scored[i] = ScoredCandidate{Candidate: c, Score: b.Total, Breakdown: b}
	}
	slices.SortFunc(scored, func(a, b ScoredCandidate) int {
		if c := cmp.Compare(b.Score, a.Score); c != 0 {
			return c
		}
		return cmp.Compare(a.AccountID.String(), b.AccountID.String())
	})
	return scored
}

// sampleTopK draws one candidate from the best k of a ranked list with
// softmax weights exp((score − best)/temperature). ranked must be non-empty
// and sorted best-first.
func sampleTopK(ranked []ScoredCandidate, k int, temperature float64, rng *rand.Rand) ScoredCandidate {
	if k <= 0 || k > len(ranked) {
		k = len(ranked)
	}
	top := ranked[:k]
	if len(top) == 1 || temperature <= 0 {
		return top[0]
	}
	best := top[0].Score
	weights := make([]float64, len(top))
	sum := 0.0
	for i, c := range top {
		w := math.Exp((c.Score - best) / temperature)
		weights[i] = w
		sum += w
	}
	x := rng.Float64() * sum
	for i, w := range weights {
		x -= w
		if x < 0 {
			return top[i]
		}
	}
	return top[len(top)-1]
}
