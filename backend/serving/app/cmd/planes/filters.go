package planes

import (
	"math"
	"strings"
)

const earthRadiusKm = 6371.0088

// filtersAreDefault reports whether the client sent no real filter constraints.
func filtersAreDefault(filters Filters) bool {
	if filters.RadiusKm != nil && *filters.RadiusKm > 0 {
		return false
	}
	if filters.Country != nil && strings.TrimSpace(*filters.Country) != "" {
		return false
	}
	if mapGenderFilter(filters.Gender) != "" {
		return false
	}
	_, _, hasAge := ageBounds(filters)
	return !hasAge
}

// normalizeFilters validates client input and returns a canonical copy:
// "any"/empty values are dropped so stored filters only hold real constraints.
func normalizeFilters(in Filters) (Filters, error) {
	var out Filters
	if in.RadiusKm != nil {
		r := *in.RadiusKm
		if math.IsNaN(r) || math.IsInf(r, 0) || r < 0 {
			return Filters{}, ErrInvalidInput
		}
		if r > 0 {
			r = math.Min(r, MaxRadiusKm)
			out.RadiusKm = &r
		}
	}
	if in.Country != nil {
		c := strings.TrimSpace(*in.Country)
		if len(c) > 64 {
			return Filters{}, ErrInvalidInput
		}
		if c != "" && !strings.EqualFold(c, "anywhere") && !strings.EqualFold(c, "any") {
			out.Country = &c
		}
	}
	if in.Gender != nil {
		g := strings.ToLower(strings.TrimSpace(*in.Gender))
		switch g {
		case "", "any":
		case "female", "male", "non-binary":
			out.Gender = &g
		default:
			return Filters{}, ErrInvalidInput
		}
	}
	if in.AgeRange != nil {
		lo, hi := in.AgeRange[0], in.AgeRange[1]
		if lo <= 0 {
			lo = MinAge
		}
		if hi <= 0 {
			hi = MaxAge
		}
		if lo < MinAge || hi > MaxAge || lo > hi {
			return Filters{}, ErrInvalidInput
		}
		if lo != MinAge || hi != MaxAge {
			out.AgeRange = &[2]int{lo, hi}
		}
	}
	return out, nil
}

// ageBounds returns the effective [lo, hi] and whether an age constraint exists.
// hi == MaxAge means "no upper bound".
func ageBounds(f Filters) (lo, hi int, ok bool) {
	lo, hi = MinAge, MaxAge
	if f.AgeRange == nil {
		return lo, hi, false
	}
	if f.AgeRange[0] > 0 {
		lo = f.AgeRange[0]
	}
	if f.AgeRange[1] > 0 {
		hi = f.AgeRange[1]
	}
	return lo, hi, lo > MinAge || hi < MaxAge
}

// relaxationLadder returns progressively looser filter sets used ONLY for the
// dummy fallback when nothing matches the full filters. Deterministic order:
// radius → age → country → gender (gender is kept as long as possible).
// The first element is the original filter set.
func relaxationLadder(f Filters) []Filters {
	out := []Filters{f}
	cur := f
	if cur.RadiusKm != nil {
		cur.RadiusKm = nil
		out = append(out, cur)
	}
	if cur.AgeRange != nil {
		cur.AgeRange = nil
		out = append(out, cur)
	}
	if cur.Country != nil {
		cur.Country = nil
		out = append(out, cur)
	}
	if cur.Gender != nil {
		cur.Gender = nil
		out = append(out, cur)
	}
	return out
}

type geoBox struct {
	minLat, maxLat float64
	minLng, maxLng float64
	// hasLng is false when the box would wrap the antimeridian or a pole;
	// the exact haversine predicate still applies.
	hasLng bool
}

// boundingBox is a cheap index-friendly prefilter for a radius search.
func boundingBox(lat, lng, radiusKm float64) geoBox {
	dLat := radiusKm / 111.045
	b := geoBox{
		minLat: math.Max(-90, lat-dLat),
		maxLat: math.Min(90, lat+dLat),
	}
	cos := math.Cos(lat * math.Pi / 180)
	if cos < 0.01 {
		return b
	}
	dLng := radiusKm / (111.045 * cos)
	if dLng >= 180 || lng-dLng < -180 || lng+dLng > 180 {
		return b
	}
	b.minLng, b.maxLng, b.hasLng = lng-dLng, lng+dLng, true
	return b
}

// haversineKm returns the great-circle distance between two points.
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLng := (lng2 - lng1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusKm * math.Asin(math.Min(1, math.Sqrt(a)))
}

// coarsenCoord rounds to 2 decimals (~1.1 km) for privacy.
func coarsenCoord(v float64) float64 {
	return math.Round(v*100) / 100
}

func mapGenderFilter(raw *string) string {
	if raw == nil {
		return ""
	}
	switch strings.ToLower(strings.TrimSpace(*raw)) {
	case "female":
		return "F"
	case "male":
		return "M"
	case "non-binary":
		return "NB"
	default:
		return ""
	}
}

// genderFilterAccepts reports whether a stored profile gender ("F"/"M"/"NB")
// passes a client gender filter.
func genderFilterAccepts(filter *string, profileGender string) bool {
	want := mapGenderFilter(filter)
	return want == "" || strings.EqualFold(want, strings.TrimSpace(profileGender))
}
