package pg

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/lib/pq"
)

// migratePlanesV3 adds what the async plane dispatcher + matching engine v3 need:
//   - coarse profile location (lat/lng, ~1 km precision) for the radius filter
//   - planes.next_attempt_at / dispatch_attempts: a plane is "searching" while
//     status='pending' AND next_attempt_at IS NOT NULL (worker/sweeper queue)
//   - indexes used by the candidate query, the sweeper and the outbox
//   - an at-most-one-pending-delivery-per-plane guarantee
//   - dummy users covering every country × gender × age band the client offers
//
// Everything is idempotent; it runs on every startup.
func migratePlanesV3(ctx context.Context, db *sql.DB) error {
	stmts := []string{
		`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lat double precision`,
		`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lng double precision`,
		`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location_updated_at timestamptz`,

		`ALTER TABLE planes ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz`,
		`ALTER TABLE planes ADD COLUMN IF NOT EXISTS dispatch_attempts int NOT NULL DEFAULT 0`,

		// Safety backfill: a pending plane with no pending delivery must be searching.
		`UPDATE planes pl SET next_attempt_at = NOW()
		 WHERE pl.status = 'pending'
		   AND pl.next_attempt_at IS NULL
		   AND NOT EXISTS (
		     SELECT 1 FROM plane_deliveries pd
		     WHERE pd.plane_id = pl.id AND pd.status = 'pending'
		   )`,

		// Dedupe before the unique index: keep only the newest pending delivery.
		`UPDATE plane_deliveries pd SET status = 'rejected', responded_at = COALESCE(pd.responded_at, NOW())
		 WHERE pd.status = 'pending'
		   AND EXISTS (
		     SELECT 1 FROM plane_deliveries newer
		     WHERE newer.plane_id = pd.plane_id
		       AND newer.status = 'pending'
		       AND (newer.delivered_at, newer.id) > (pd.delivered_at, pd.id)
		   )`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_plane_deliveries_one_pending
		   ON plane_deliveries(plane_id) WHERE status = 'pending'`,

		// Sweeper: searching planes due for a (re)try.
		`CREATE INDEX IF NOT EXISTS idx_planes_searching
		   ON planes(next_attempt_at) WHERE status = 'pending' AND next_attempt_at IS NOT NULL`,
		// Sweeper: dummy auto-accept candidates.
		`CREATE INDEX IF NOT EXISTS idx_planes_pending_dummy
		   ON planes(updated_at) WHERE status = 'pending' AND recipient_is_dummy`,

		// Candidate query.
		`CREATE INDEX IF NOT EXISTS idx_profile_stats_last_active
		   ON profile_stats(last_active_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_profiles_matchable
		   ON profiles(is_dummy, gender) WHERE profile_complete`,
		`CREATE INDEX IF NOT EXISTS idx_profiles_country_norm
		   ON profiles(LOWER(TRIM(country))) WHERE profile_complete`,
		`CREATE INDEX IF NOT EXISTS idx_profiles_geo
		   ON profiles(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL AND profile_complete`,
	}
	for _, q := range stmts {
		if _, err := db.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("migratePlanesV3: %w\n%s", err, q)
		}
	}
	return seedDummyUsersV3(ctx, db)
}

type dummyCountry struct {
	name, city, region string
	lat, lng           float64
}

// Keep in sync with client/lib/countries.ts.
var dummyCountries = []dummyCountry{
	{"India", "Mumbai", "south_asia", 19.0760, 72.8777},
	{"United States", "New York", "anglo", 40.7128, -74.0060},
	{"United Kingdom", "London", "anglo", 51.5074, -0.1278},
	{"Canada", "Toronto", "anglo", 43.6532, -79.3832},
	{"Australia", "Sydney", "anglo", -33.8688, 151.2093},
	{"Germany", "Berlin", "europe", 52.5200, 13.4050},
	{"France", "Paris", "europe", 48.8566, 2.3522},
	{"Italy", "Rome", "europe", 41.9028, 12.4964},
	{"Spain", "Madrid", "europe", 40.4168, -3.7038},
	{"Netherlands", "Amsterdam", "europe", 52.3676, 4.9041},
	{"Singapore", "Singapore", "se_asia", 1.3521, 103.8198},
	{"Japan", "Tokyo", "east_asia", 35.6762, 139.6503},
	{"South Korea", "Seoul", "east_asia", 37.5665, 126.9780},
	{"Brazil", "São Paulo", "latam", -23.5505, -46.6333},
	{"Mexico", "Mexico City", "latam", 19.4326, -99.1332},
	{"Argentina", "Buenos Aires", "latam", -34.6037, -58.3816},
	{"United Arab Emirates", "Dubai", "mena", 25.2048, 55.2708},
	{"Saudi Arabia", "Riyadh", "mena", 24.7136, 46.6753},
	{"South Africa", "Cape Town", "africa", -33.9249, 18.4241},
	{"Nigeria", "Lagos", "africa", 6.5244, 3.3792},
	{"Kenya", "Nairobi", "africa", -1.2921, 36.8219},
	{"Indonesia", "Jakarta", "se_asia", -6.2088, 106.8456},
	{"Philippines", "Manila", "se_asia", 14.5995, 120.9842},
	{"Vietnam", "Ho Chi Minh City", "se_asia", 10.8231, 106.6297},
	{"Thailand", "Bangkok", "se_asia", 13.7563, 100.5018},
	{"Turkey", "Istanbul", "mena", 41.0082, 28.9784},
	{"Sweden", "Stockholm", "europe", 59.3293, 18.0686},
	{"Norway", "Oslo", "europe", 59.9139, 10.7522},
	{"Denmark", "Copenhagen", "europe", 55.6761, 12.5683},
	{"Finland", "Helsinki", "europe", 60.1699, 24.9384},
}

// One name per age band, per gender, per region.
var dummyNames = map[string]map[string][4]string{
	"south_asia": {"F": {"Aanvi", "Riya", "Meera", "Kavita"}, "M": {"Arjun", "Rohan", "Vikram", "Suresh"}, "NB": {"Kiran", "Ari", "Noor", "Sam"}},
	"anglo":      {"F": {"Emma", "Olivia", "Rachel", "Susan"}, "M": {"Liam", "Jack", "Daniel", "Mark"}, "NB": {"River", "Jordan", "Casey", "Morgan"}},
	"europe":     {"F": {"Lena", "Chloé", "Giulia", "Ingrid"}, "M": {"Lukas", "Hugo", "Marco", "Henrik"}, "NB": {"Alex", "Robin", "Sasha", "Charlie"}},
	"east_asia":  {"F": {"Yui", "Ji-woo", "Sakura", "Keiko"}, "M": {"Haruto", "Min-jun", "Kenji", "Hiroshi"}, "NB": {"Hikaru", "Yuki", "Min", "Ren"}},
	"se_asia":    {"F": {"Siti", "Mai", "Ploy", "Maria"}, "M": {"Budi", "Minh", "Arif", "Jose"}, "NB": {"Ari", "Kai", "Linh", "Jun"}},
	"latam":      {"F": {"Valentina", "Camila", "Lucía", "Fernanda"}, "M": {"Mateo", "Diego", "Rafael", "Carlos"}, "NB": {"Ale", "Cris", "Dani", "Gabi"}},
	"mena":       {"F": {"Layla", "Aylin", "Noura", "Fatima"}, "M": {"Omar", "Emre", "Khalid", "Yusuf"}, "NB": {"Noor", "Rami", "Sami", "Deniz"}},
	"africa":     {"F": {"Amara", "Zanele", "Wanjiru", "Ngozi"}, "M": {"Tunde", "Sipho", "Kamau", "Chidi"}, "NB": {"Ayo", "Imani", "Kemi", "Tumi"}},
}

// Representative age per band: 18-24, 25-34, 35-44, 45+. DOB is pinned to
// June 15th of (current year - age) so the dummy stays inside its band.
var dummyBandAges = [4]int{21, 29, 39, 52}

var dummyInterests = []string{
	"music,travel,coffee",
	"books,poetry,tea",
	"football,gaming,food",
	"art,photography,walks",
	"film,cooking,hiking",
	"tech,startups,running",
	"dance,fashion,brunch",
	"yoga,nature,writing",
}

func seedDummyUsersV3(ctx context.Context, db *sql.DB) error {
	var (
		ids, emails, subs, usernames, names, genders, bios, interests, cities, countries []string
		ages                                                                             []int64
		lats, lngs                                                                       []float64
	)
	genderKeys := []string{"F", "M", "NB"}
	for ci, c := range dummyCountries {
		pool := dummyNames[c.region]
		for gi, g := range genderKeys {
			for band := 0; band < 4; band++ {
				n := ci*100 + gi*10 + band
				j := gi*4 + band // 0..11 within the country
				gl := strings.ToLower(g)
				tags := dummyInterests[(ci+j)%len(dummyInterests)]
				parts := strings.Split(tags, ",")
				ids = append(ids, fmt.Sprintf("d2000000-0000-4000-8000-%012d", n))
				emails = append(emails, fmt.Sprintf("dummy+c%02d%s%d@swing.internal", ci, gl, band))
				subs = append(subs, fmt.Sprintf("swing-dummy-c%02d-%s-%d", ci, gl, band))
				usernames = append(usernames, fmt.Sprintf("dummy_c%02d_%s_%d", ci, gl, band))
				names = append(names, pool[g][band])
				genders = append(genders, g)
				ages = append(ages, int64(dummyBandAges[band]))
				bios = append(bios, fmt.Sprintf("Hi from %s! Into %s and %s.", c.city, parts[0], parts[1]))
				interests = append(interests, tags)
				cities = append(cities, c.city)
				countries = append(countries, c.name)
				// ~2 km grid jitter so dummies are not all on one point.
				lats = append(lats, c.lat+(float64(j%4)-1.5)*0.02)
				lngs = append(lngs, c.lng+(float64(j/4)-1)*0.02)
			}
		}
	}

	if _, err := db.ExecContext(ctx, `
		INSERT INTO accounts (id, email, google_sub)
		SELECT u.id, u.email, u.sub
		FROM unnest($1::uuid[], $2::text[], $3::text[]) AS u(id, email, sub)
		ON CONFLICT (id) DO NOTHING
	`, pq.Array(ids), pq.Array(emails), pq.Array(subs)); err != nil {
		return fmt.Errorf("seed dummy accounts v3: %w", err)
	}

	if _, err := db.ExecContext(ctx, `
		INSERT INTO profiles (
			account_id, username, name, dob, gender, bio, interests,
			city, country, lat, lng, location_updated_at, profile_complete, is_dummy
		)
		SELECT
			u.id, u.username, u.name,
			make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int - u.age::int, 6, 15),
			u.gender, u.bio, u.interests, u.city, u.country, u.lat, u.lng, NOW(), TRUE, TRUE
		FROM unnest(
			$1::uuid[], $2::text[], $3::text[], $4::bigint[], $5::text[],
			$6::text[], $7::text[], $8::text[], $9::text[], $10::float8[], $11::float8[]
		) AS u(id, username, name, age, gender, bio, interests, city, country, lat, lng)
		ON CONFLICT (account_id) DO UPDATE
		SET dob = EXCLUDED.dob, updated_at = NOW()
		WHERE profiles.is_dummy AND profiles.dob IS DISTINCT FROM EXCLUDED.dob
	`, pq.Array(ids), pq.Array(usernames), pq.Array(names), pq.Array(ages), pq.Array(genders),
		pq.Array(bios), pq.Array(interests), pq.Array(cities), pq.Array(countries),
		pq.Array(lats), pq.Array(lngs)); err != nil {
		return fmt.Errorf("seed dummy profiles v3: %w", err)
	}

	if _, err := db.ExecContext(ctx, `
		INSERT INTO profile_stats (account_id, last_active_at, planes_remaining)
		SELECT u.id, NOW(), 0 FROM unnest($1::uuid[]) AS u(id)
		ON CONFLICT (account_id) DO NOTHING
	`, pq.Array(ids)); err != nil {
		return fmt.Errorf("seed dummy stats v3: %w", err)
	}

	// Give the original five (India) dummies a location too.
	if _, err := db.ExecContext(ctx, `
		UPDATE profiles p
		SET lat = v.lat, lng = v.lng, location_updated_at = NOW()
		FROM (VALUES
			('d1000001-0000-4000-8000-000000000001'::uuid, 19.0760::float8, 72.8777::float8),
			('d1000001-0000-4000-8000-000000000002'::uuid, 12.9716, 77.5946),
			('d1000001-0000-4000-8000-000000000003'::uuid, 15.4909, 73.8278),
			('d1000001-0000-4000-8000-000000000004'::uuid, 28.6139, 77.2090),
			('d1000001-0000-4000-8000-000000000005'::uuid, 18.5204, 73.8567)
		) AS v(id, lat, lng)
		WHERE p.account_id = v.id AND p.is_dummy AND p.lat IS NULL
	`); err != nil {
		return fmt.Errorf("locate legacy dummies: %w", err)
	}
	return nil
}
