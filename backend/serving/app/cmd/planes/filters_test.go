package planes

import (
	"math"
	"strings"
	"testing"

	"lib/stdid"
)

func TestFiltersAreDefault(t *testing.T) {
	t.Parallel()
	if !filtersAreDefault(Filters{}) {
		t.Fatal("empty filters should be default")
	}
	if filtersAreDefault(Filters{Country: sp("IN")}) {
		t.Fatal("country filter should not be default")
	}
	if filtersAreDefault(Filters{Gender: sp("female")}) {
		t.Fatal("gender filter should not be default")
	}
	if !filtersAreDefault(Filters{Gender: sp("any")}) {
		t.Fatal("gender any should be default")
	}
	if !filtersAreDefault(Filters{AgeRange: &[2]int{18, 99}}) {
		t.Fatal("full age range should be default")
	}
	if filtersAreDefault(Filters{RadiusKm: fp(25)}) {
		t.Fatal("radius should not be default")
	}
}

func TestNormalizeFilters(t *testing.T) {
	t.Parallel()
	got, err := normalizeFilters(Filters{
		RadiusKm: fp(0), Country: sp(" Anywhere "), Gender: sp("Any"), AgeRange: &[2]int{18, 99},
	})
	if err != nil || !filtersAreDefault(got) || got.RadiusKm != nil || got.Country != nil || got.Gender != nil || got.AgeRange != nil {
		t.Fatalf("any-values should normalise away: %+v %v", got, err)
	}
	got, err = normalizeFilters(Filters{RadiusKm: fp(1e9), Gender: sp(" Female "), AgeRange: &[2]int{25, 0}})
	if err != nil {
		t.Fatal(err)
	}
	if *got.RadiusKm != MaxRadiusKm || *got.Gender != "female" || got.AgeRange[0] != 25 || got.AgeRange[1] != MaxAge {
		t.Fatalf("unexpected normalisation: %+v", got)
	}
	bad := []Filters{
		{RadiusKm: fp(-1)},
		{RadiusKm: fp(math.NaN())},
		{Gender: sp("robot")},
		{AgeRange: &[2]int{40, 30}},
		{AgeRange: &[2]int{12, 30}},
		{AgeRange: &[2]int{20, 150}},
		{Country: sp(strings.Repeat("x", 65))},
	}
	for i, f := range bad {
		if _, err := normalizeFilters(f); err != ErrInvalidInput {
			t.Fatalf("case %d: expected ErrInvalidInput, got %v", i, err)
		}
	}
}

func TestRelaxationLadderOrder(t *testing.T) {
	t.Parallel()
	f := Filters{RadiusKm: fp(5), AgeRange: &[2]int{25, 34}, Country: sp("India"), Gender: sp("female")}
	l := relaxationLadder(f)
	if len(l) != 5 {
		t.Fatalf("expected 5 steps, got %d", len(l))
	}
	if l[1].RadiusKm != nil || l[1].AgeRange == nil {
		t.Fatal("step 1 drops radius only")
	}
	if l[2].AgeRange != nil || l[2].Country == nil {
		t.Fatal("step 2 drops age")
	}
	if l[3].Country != nil || l[3].Gender == nil {
		t.Fatal("step 3 drops country, keeps gender")
	}
	if l[4].Gender != nil {
		t.Fatal("gender is relaxed last")
	}
	if got := relaxationLadder(Filters{Gender: sp("male")}); len(got) != 2 {
		t.Fatalf("only gender → 2 steps, got %d", len(got))
	}
}

func TestEffectiveFiltersDropsRadiusWithoutLocation(t *testing.T) {
	t.Parallel()
	f := Filters{RadiusKm: fp(5)}
	if effectiveFilters(Profile{}, f).RadiusKm != nil {
		t.Fatal("radius without sender location must be dropped")
	}
	if effectiveFilters(Profile{Lat: fp(1), Lng: fp(1)}, f).RadiusKm == nil {
		t.Fatal("radius with location must be kept")
	}
}

func TestHaversineAndBoundingBox(t *testing.T) {
	t.Parallel()
	// Mumbai → Pune ≈ 120 km.
	d := haversineKm(19.0760, 72.8777, 18.5204, 73.8567)
	if d < 115 || d > 125 {
		t.Fatalf("Mumbai-Pune distance off: %v", d)
	}
	b := boundingBox(19.0760, 72.8777, 150)
	if !b.hasLng || 18.5204 < b.minLat || 18.5204 > b.maxLat || 73.8567 < b.minLng || 73.8567 > b.maxLng {
		t.Fatalf("Pune should be inside a 150km box: %+v", b)
	}
	if boundingBox(89.9, 0, 50).hasLng {
		t.Fatal("near-pole box must skip longitude bounds")
	}
	if boundingBox(0, 179.9, 50).hasLng {
		t.Fatal("antimeridian box must skip longitude bounds")
	}
}

func TestCoarsenAndValidCoord(t *testing.T) {
	t.Parallel()
	if coarsenCoord(19.07612) != 19.08 || coarsenCoord(-33.86882) != -33.87 {
		t.Fatal("coarsen should round to 2 decimals")
	}
	if validCoord(0, 0) || validCoord(91, 0) || validCoord(0, 181) || validCoord(math.NaN(), 1) {
		t.Fatal("invalid coords accepted")
	}
	if !validCoord(19.07, 72.87) {
		t.Fatal("valid coord rejected")
	}
}

func TestBuildCandidateQueryClauses(t *testing.T) {
	t.Parallel()
	id, _ := stdid.New()
	pid, _ := stdid.New()
	q, args := buildCandidateQuery(candidateQuery{
		SenderID: id, PlaneID: pid, SenderLat: fp(19), SenderLng: fp(72),
		Filters: Filters{
			RadiusKm: fp(25), Country: sp("India"), Gender: sp("female"), AgeRange: &[2]int{25, 34},
		},
		WithBlocks: true,
	})
	for _, want := range []string{"user_blocks", "p.gender = $", "make_interval", "asin(", "p.lng BETWEEN", "LOWER(TRIM(p.country))"} {
		if !strings.Contains(q, want) {
			t.Fatalf("query missing %q", want)
		}
	}
	// 3 fixed + country + gender + 2 age + 4 box + 2 centre + radius
	if len(args) != 14 {
		t.Fatalf("expected 14 args, got %d", len(args))
	}
	q2, args2 := buildCandidateQuery(candidateQuery{SenderID: id, PlaneID: pid, Filters: Filters{RadiusKm: fp(25)}, OnlyDummy: true})
	if strings.Contains(q2, "asin(") || strings.Contains(q2, "user_blocks") || len(args2) != 3 {
		t.Fatal("radius without sender location / blocks disabled must not add clauses")
	}
	if !strings.Contains(q2, "AND p.is_dummy") {
		t.Fatal("dummy-only query must filter is_dummy")
	}
	// 45+ has no upper bound
	_, args3 := buildCandidateQuery(candidateQuery{SenderID: id, PlaneID: pid, Filters: Filters{AgeRange: &[2]int{45, 99}}})
	if len(args3) != 4 {
		t.Fatalf("open-ended age should add 1 arg, got %d", len(args3)-3)
	}
}

func TestGenderFilterAccepts(t *testing.T) {
	t.Parallel()
	if !genderFilterAccepts(nil, "F") || !genderFilterAccepts(sp("any"), "M") {
		t.Fatal("no filter accepts everyone")
	}
	if !genderFilterAccepts(sp("non-binary"), "NB") || genderFilterAccepts(sp("male"), "F") {
		t.Fatal("gender mapping wrong")
	}
}
