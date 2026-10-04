package planes

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"strings"
	"time"

	"lib/stdid"

	"serving/app/pkg/logx"
)

// RejectCooldown: a sender's planes skip someone who rejected one of their
// planes within this window (real users only).
const RejectCooldown = 7 * 24 * time.Hour

type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// pickResult is the chosen recipient plus how it was found (for logs/metrics).
type pickResult struct {
	ScoredCandidate
	Tier      string
	PoolSize  int
	Effective Filters
}

// candidateQuery describes one candidate-pool lookup.
type candidateQuery struct {
	SenderID   stdid.UUID
	SenderLat  *float64
	SenderLng  *float64
	PlaneID    stdid.UUID
	Filters    Filters // effective filters (radius only when sender location known)
	OnlyDummy  bool
	WithBlocks bool
	Limit      int
}

// effectiveFilters drops constraints that cannot be evaluated for this sender
// (radius without a known sender location).
func effectiveFilters(sender Profile, f Filters) Filters {
	if f.RadiusKm != nil && (sender.Lat == nil || sender.Lng == nil) {
		f.RadiusKm = nil
	}
	return f
}

// pickRecipient chooses ONE recipient for a plane. Tiers, in order:
//  1. real users matching all filters, under the 24h inbox cap
//  2. real users matching all filters (cap exceeded — soft-penalised by score)
//  3. dummy users matching all filters
//  4. dummy users with filters relaxed radius → age → country → gender
//
// Within a tier: score (scoring.go) + weighted random among the top-K.
func (s *Service) pickRecipient(
	ctx context.Context,
	q queryer,
	sender Profile,
	filters Filters,
	planeID stdid.UUID,
) (pickResult, error) {
	now := time.Now().UTC()
	rng := rand.New(rand.NewPCG(rand.Uint64(), rand.Uint64()))
	eff := effectiveFilters(sender, filters)
	withBlocks := s.blocksEnabled.Load()

	base := candidateQuery{
		SenderID:   sender.AccountID,
		SenderLat:  sender.Lat,
		SenderLng:  sender.Lng,
		PlaneID:    planeID,
		Filters:    eff,
		WithBlocks: withBlocks,
		Limit:      MaxCandidatePool,
	}
	pool, err := s.listCandidates(ctx, q, base)
	if err != nil {
		return pickResult{}, err
	}

	var underCap, overCap, dummies []Candidate
	for _, c := range pool {
		switch {
		case c.IsDummy:
			dummies = append(dummies, c)
		case c.Received24h < MaxInboxPer24h:
			underCap = append(underCap, c)
		default:
			overCap = append(overCap, c)
		}
	}
	for _, tier := range []struct {
		name  string
		cands []Candidate
	}{
		{"real", underCap},
		{"real_over_cap", overCap},
		{"dummy", dummies},
	} {
		if len(tier.cands) == 0 {
			continue
		}
		ranked := rankCandidates(sender, tier.cands, eff, now)
		return pickResult{
			ScoredCandidate: sampleTopK(ranked, TopK, Temperature, rng),
			Tier:            tier.name,
			PoolSize:        len(tier.cands),
			Effective:       eff,
		}, nil
	}

	ladder := relaxationLadder(eff)
	for i := 1; i < len(ladder); i++ {
		dq := base
		dq.Filters = ladder[i]
		dq.OnlyDummy = true
		cands, err := s.listCandidates(ctx, q, dq)
		if err != nil {
			return pickResult{}, err
		}
		if len(cands) == 0 {
			continue
		}
		// Score against the ORIGINAL filters so e.g. distance still prefers
		// the closest dummy after the radius was relaxed.
		ranked := rankCandidates(sender, cands, eff, now)
		return pickResult{
			ScoredCandidate: sampleTopK(ranked, TopK, Temperature, rng),
			Tier:            fmt.Sprintf("dummy_relaxed_%d", i),
			PoolSize:        len(cands),
			Effective:       ladder[i],
		}, nil
	}
	return pickResult{}, ErrNoCandidates
}

func (s *Service) listCandidates(ctx context.Context, q queryer, cq candidateQuery) ([]Candidate, error) {
	query, args := buildCandidateQuery(cq)
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Candidate
	for rows.Next() {
		var c Candidate
		var interests, name, username, avatar, city, country, gender sql.NullString
		var dob, lastActive sql.NullTime
		var lat, lng sql.NullFloat64
		var lastFilters []byte
		if err := rows.Scan(
			&c.AccountID, &interests, &c.CreatedAt,
			&name, &username, &avatar, &city, &country, &gender, &dob,
			&lat, &lng, &lastActive, &c.IsDummy,
			&c.PendingInbox, &c.Received24h, &c.Accepted90d, &c.Responded90d,
			&lastFilters,
		); err != nil {
			return nil, err
		}
		c.Interests = interests.String
		c.Name = name.String
		c.Username = username.String
		c.AvatarURL = avatar.String
		c.City = city.String
		c.Country = country.String
		c.Gender = gender.String
		if dob.Valid {
			t := dob.Time
			c.DOB = &t
		}
		if lat.Valid && lng.Valid {
			la, ln := lat.Float64, lng.Float64
			c.Lat, c.Lng = &la, &ln
		}
		if lastActive.Valid {
			c.LastActiveAt = lastActive.Time
		} else {
			c.LastActiveAt = c.CreatedAt
		}
		if len(lastFilters) > 0 {
			var lf Filters
			if json.Unmarshal(lastFilters, &lf) == nil && !filtersAreDefault(lf) {
				c.LastFilters = &lf
			}
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// buildCandidateQuery returns the candidate SQL. The inner query applies the
// hard filters + exclusions and caps the pool (real users first, most
// recently active first); the outer laterals compute scoring signals for
// at most Limit rows.
func buildCandidateQuery(cq candidateQuery) (string, []any) {
	args := []any{cq.SenderID, cq.PlaneID, fmt.Sprintf("%d hours", int(RejectCooldown.Hours()))}
	next := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}

	clauses := []string{
		`p.account_id <> $1`,
		`p.profile_complete`,
		// already reached by this plane
		`NOT EXISTS (
			SELECT 1 FROM plane_deliveries x
			WHERE x.plane_id = $2 AND x.recipient_account_id = p.account_id
		)`,
		// existing friends / chat partners
		`NOT EXISTS (
			SELECT 1 FROM friendships f
			WHERE f.account_a = LEAST($1::uuid, p.account_id)
			  AND f.account_b = GREATEST($1::uuid, p.account_id)
		)`,
		`NOT EXISTS (
			SELECT 1 FROM chats ch
			WHERE ch.account_a = LEAST($1::uuid, p.account_id)
			  AND ch.account_b = GREATEST($1::uuid, p.account_id)
		)`,
		// real users: none of this sender's planes is waiting in their inbox,
		// and they did not reject one of this sender's planes recently
		`(p.is_dummy OR NOT EXISTS (
			SELECT 1 FROM plane_deliveries hd
			JOIN planes hp ON hp.id = hd.plane_id
			WHERE hp.sender_account_id = $1
			  AND hd.recipient_account_id = p.account_id
			  AND (
			    (hd.status = 'pending' AND hp.status = 'pending')
			    OR (hd.status = 'rejected' AND hd.responded_at > NOW() - $3::interval)
			  )
		))`,
	}
	if cq.OnlyDummy {
		clauses = append(clauses, `p.is_dummy`)
	}
	if cq.WithBlocks {
		clauses = append(clauses, `NOT EXISTS (
			SELECT 1 FROM user_blocks b
			WHERE (b.blocker_id = $1 AND b.blocked_id = p.account_id)
			   OR (b.blocker_id = p.account_id AND b.blocked_id = $1)
		)`)
	}

	f := cq.Filters
	if f.Country != nil && strings.TrimSpace(*f.Country) != "" {
		clauses = append(clauses, fmt.Sprintf(`LOWER(TRIM(p.country)) = LOWER(TRIM(%s))`,
			next(strings.TrimSpace(*f.Country))))
	}
	if g := mapGenderFilter(f.Gender); g != "" {
		clauses = append(clauses, fmt.Sprintf(`p.gender = %s`, next(g)))
	}
	if lo, hi, ok := ageBounds(f); ok {
		// age >= lo  ⇔ dob <= today − lo years ; age <= hi ⇔ dob > today − (hi+1) years
		c := fmt.Sprintf(`p.dob IS NOT NULL AND p.dob <= (CURRENT_DATE - make_interval(years => %s::int))`, next(lo))
		if hi < MaxAge {
			c += fmt.Sprintf(` AND p.dob > (CURRENT_DATE - make_interval(years => %s::int))`, next(hi+1))
		}
		clauses = append(clauses, c)
	}
	if f.RadiusKm != nil && *f.RadiusKm > 0 && cq.SenderLat != nil && cq.SenderLng != nil {
		lat, lng, r := *cq.SenderLat, *cq.SenderLng, *f.RadiusKm
		box := boundingBox(lat, lng, r)
		c := fmt.Sprintf(`p.lat IS NOT NULL AND p.lng IS NOT NULL AND p.lat BETWEEN %s::float8 AND %s::float8`,
			next(box.minLat), next(box.maxLat))
		if box.hasLng {
			c += fmt.Sprintf(` AND p.lng BETWEEN %s::float8 AND %s::float8`, next(box.minLng), next(box.maxLng))
		}
		la, ln := next(lat), next(lng)
		c += fmt.Sprintf(` AND 2 * %v * asin(least(1, sqrt(
			power(sin(radians(p.lat - %s::float8) / 2), 2)
			+ cos(radians(%s::float8)) * cos(radians(p.lat)) * power(sin(radians(p.lng - %s::float8) / 2), 2)
		))) <= %s::float8`, earthRadiusKm, la, la, ln, next(r))
		clauses = append(clauses, c)
	}

	limit := cq.Limit
	if limit <= 0 {
		limit = MaxCandidatePool
	}

	query := fmt.Sprintf(`
		WITH pool AS (
			SELECT
				p.account_id, p.interests, p.created_at, p.name, p.username, p.avatar_url,
				p.city, p.country, p.gender, p.dob, p.lat, p.lng,
				ps.last_active_at, p.is_dummy
			FROM profiles p
			LEFT JOIN profile_stats ps ON ps.account_id = p.account_id
			WHERE %s
			ORDER BY p.is_dummy, ps.last_active_at DESC NULLS LAST, p.account_id
			LIMIT %d
		)
		SELECT
			pool.account_id, pool.interests, pool.created_at, pool.name, pool.username,
			pool.avatar_url, pool.city, pool.country, pool.gender, pool.dob,
			pool.lat, pool.lng, pool.last_active_at, pool.is_dummy,
			COALESCE(st.pending_inbox, 0), COALESCE(st.received_24h, 0),
			COALESCE(st.accepted_90d, 0), COALESCE(st.responded_90d, 0),
			lf.filters
		FROM pool
		LEFT JOIN LATERAL (
			SELECT
				COUNT(*) FILTER (WHERE d.status = 'pending' AND d.delivered_at > NOW() - INTERVAL '24 hours')::int AS pending_inbox,
				COUNT(*) FILTER (WHERE d.delivered_at > NOW() - INTERVAL '24 hours')::int AS received_24h,
				COUNT(*) FILTER (WHERE d.status = 'accepted')::int AS accepted_90d,
				COUNT(*) FILTER (WHERE d.status IN ('accepted', 'rejected'))::int AS responded_90d
			FROM plane_deliveries d
			WHERE d.recipient_account_id = pool.account_id
			  AND d.delivered_at > NOW() - INTERVAL '90 days'
		) st ON TRUE
		LEFT JOIN LATERAL (
			SELECT lp.filters FROM planes lp
			WHERE lp.sender_account_id = pool.account_id
			ORDER BY lp.created_at DESC
			LIMIT 1
		) lf ON TRUE
	`, strings.Join(clauses, "\n\t\t\t  AND "), limit)
	return query, args
}

func logPick(planeID, senderID stdid.UUID, res pickResult) {
	logx.Info("plane recipient picked",
		"plane_id", planeID.String(),
		"sender_id", senderID.String(),
		"recipient_id", res.AccountID.String(),
		"recipient_dummy", res.IsDummy,
		"tier", res.Tier,
		"pool", res.PoolSize,
		"score", fmt.Sprintf("%.1f", res.Score),
	)
}
