package planes

import (
	"math"
	"math/rand/v2"
	"testing"
	"time"

	"lib/stdid"
)

var testNow = time.Date(2026, 8, 23, 12, 0, 0, 0, time.UTC)

func fp(v float64) *float64 { return &v }
func sp(v string) *string   { return &v }

func approx(t *testing.T, name string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-6 {
		t.Fatalf("%s: got %v want %v", name, got, want)
	}
}

func TestInterestOverlap(t *testing.T) {
	t.Parallel()
	approx(t, "one of two shared", interestOverlap("music,film,coffee", "music,vinyl"), 1.0/2)
	approx(t, "identical", interestOverlap("A, b ,c", "c,b,a"), 1)
	approx(t, "subset counts fully", interestOverlap("a,b", "a,b,c,d,e"), 1)
	approx(t, "empty", interestOverlap("", "music"), 0)
}

func TestActivityScoreLinear72h(t *testing.T) {
	t.Parallel()
	approx(t, "now", activityScore(testNow, testNow), WeightActivity)
	approx(t, "36h", activityScore(testNow.Add(-36*time.Hour), testNow), WeightActivity/2)
	approx(t, "72h", activityScore(testNow.Add(-72*time.Hour), testNow), 0)
	approx(t, "older", activityScore(testNow.Add(-200*time.Hour), testNow), 0)
	approx(t, "never", activityScore(time.Time{}, testNow), 0)
}

func TestPendingScore(t *testing.T) {
	t.Parallel()
	approx(t, "none pending", pendingScore(0), WeightPending)
	approx(t, "two pending", pendingScore(2), WeightPending/2)
	approx(t, "capped", pendingScore(PendingCap+3), 0)
}

func TestScoreWeightsSumTo100(t *testing.T) {
	t.Parallel()
	sender := Profile{Interests: "a,b,c,d"}
	best := Candidate{Profile: Profile{Interests: "a,b,c,d", LastActiveAt: testNow}}
	approx(t, "best", ScoreCandidate(sender, best, Filters{}, testNow).Total, 100)
	worst := Candidate{PendingInbox: 10}
	approx(t, "worst", ScoreCandidate(Profile{}, worst, Filters{}, testNow).Total, 0)
	// 50/30/20 split: each entity alone reaches exactly its weight.
	onlyActive := Candidate{Profile: Profile{LastActiveAt: testNow}, PendingInbox: 10}
	approx(t, "activity share", ScoreCandidate(Profile{}, onlyActive, Filters{}, testNow).Total, 50)
}

func mkScored(n int) []ScoredCandidate {
	out := make([]ScoredCandidate, n)
	for i := range out {
		id, _ := stdid.New()
		out[i] = ScoredCandidate{Candidate: Candidate{Profile: Profile{AccountID: id}}, Score: float64(100 - i*5)}
	}
	return out
}

func TestRankCandidatesSortsDesc(t *testing.T) {
	t.Parallel()
	sender := Profile{}
	cands := []Candidate{
		{Profile: Profile{LastActiveAt: testNow.Add(-72 * time.Hour)}},
		{Profile: Profile{LastActiveAt: testNow}},
		{Profile: Profile{LastActiveAt: testNow.Add(-6 * time.Hour)}},
	}
	for i := range cands {
		cands[i].AccountID, _ = stdid.New()
	}
	r := rankCandidates(sender, cands, Filters{}, testNow)
	for i := 1; i < len(r); i++ {
		if r[i-1].Score < r[i].Score {
			t.Fatalf("not sorted: %v", r)
		}
	}
	if r[0].LastActiveAt != testNow {
		t.Fatal("most active should rank first")
	}
}

func TestSampleTopKSpreadsButFavoursBest(t *testing.T) {
	t.Parallel()
	ranked := mkScored(12)
	rng := rand.New(rand.NewPCG(1, 2))
	counts := map[stdid.UUID]int{}
	for i := 0; i < 20000; i++ {
		counts[sampleTopK(ranked, TopK, Temperature, rng).AccountID]++
	}
	for i, c := range ranked {
		if i >= TopK && counts[c.AccountID] > 0 {
			t.Fatalf("candidate outside top-K was picked")
		}
	}
	if len(counts) != TopK {
		t.Fatalf("expected all top-%d to be picked sometimes, got %d", TopK, len(counts))
	}
	for i := 1; i < TopK; i++ {
		if counts[ranked[i-1].AccountID] < counts[ranked[i].AccountID] {
			t.Fatalf("higher score should be picked at least as often (rank %d)", i)
		}
	}
	if got := sampleTopK(ranked[:1], TopK, Temperature, rng); got.AccountID != ranked[0].AccountID {
		t.Fatal("single candidate must be returned")
	}
}

func TestRetryBackoff(t *testing.T) {
	t.Parallel()
	if retryBackoff(1) != retryBaseDelay || retryBackoff(2) != 2*retryBaseDelay {
		t.Fatal("unexpected early backoff")
	}
	if retryBackoff(50) != retryMaxDelay {
		t.Fatal("backoff must cap")
	}
}

func TestDeriveState(t *testing.T) {
	t.Parallel()
	future := testNow.Add(time.Hour)
	cases := []struct {
		status    Status
		searching bool
		delivery  DeliveryStatus
		expires   time.Time
		want      State
	}{
		{StatusPending, true, "", future, StateSearching},
		{StatusPending, false, DeliveryPending, future, StateDelivered},
		{StatusPending, true, DeliveryRejected, future, StateSearching},
		{StatusAccepted, false, DeliveryAccepted, future, StateAccepted},
		{StatusExpired, false, DeliveryPending, future, StateExpired},
		{StatusPending, false, DeliveryPending, testNow, StateExpired},
	}
	for i, c := range cases {
		if got := deriveState(c.status, c.searching, c.delivery, c.expires, testNow); got != c.want {
			t.Fatalf("case %d: got %s want %s", i, got, c.want)
		}
	}
}
