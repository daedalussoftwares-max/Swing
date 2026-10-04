package planes

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"time"

	"lib/stdid"
)

// Location is the coarse (≈1 km) position stored for radius matching.
type Location struct {
	Lat       float64   `json:"lat"`
	Lng       float64   `json:"lng"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// UpdateLocation stores the caller's device location, rounded to 2 decimals
// (~1.1 km) so exact positions are never persisted.
func (s *Service) UpdateLocation(ctx context.Context, accountID stdid.UUID, lat, lng float64) (Location, error) {
	if !validCoord(lat, lng) {
		return Location{}, ErrInvalidInput
	}
	loc := Location{Lat: coarsenCoord(lat), Lng: coarsenCoord(lng)}
	err := s.db.QueryRowContext(ctx, `
		UPDATE profiles
		SET lat = $2, lng = $3, location_updated_at = NOW()
		WHERE account_id = $1
		RETURNING location_updated_at
	`, accountID, loc.Lat, loc.Lng).Scan(&loc.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Location{}, ErrNotFound
	}
	if err != nil {
		return Location{}, err
	}
	return loc, nil
}

func validCoord(lat, lng float64) bool {
	for _, v := range []float64{lat, lng} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		return false
	}
	// (0,0) is almost always an uninitialised GPS fix.
	return !(lat == 0 && lng == 0)
}
