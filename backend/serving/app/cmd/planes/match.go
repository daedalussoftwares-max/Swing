package planes

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"lib/stdid"
)

func (s *Service) pickRecipient(
	ctx context.Context,
	sender Profile,
	filters Filters,
	planeID *stdid.UUID,
) (Candidate, error) {
	real, err := s.listCandidates(ctx, sender.AccountID, filters, planeID, false)
	if err != nil {
		return Candidate{}, err
	}
	if len(real) > 0 {
		return scoreAndPickTop(sender, real), nil
	}

	// Dummy fallback only when there are no other real users on the app
	// (solo / empty network). If B exists but filters exclude them, do not
	// substitute a dummy — that feels random to the sender.
	others, err := s.countOtherRealUsers(ctx, sender.AccountID)
	if err != nil {
		return Candidate{}, err
	}
	if others > 0 {
		return Candidate{}, ErrNoCandidates
	}

	dummies, err := s.listCandidates(ctx, sender.AccountID, filters, planeID, true)
	if err != nil {
		return Candidate{}, err
	}
	if len(dummies) == 0 {
		return Candidate{}, ErrNoCandidates
	}
	picked := scoreAndPickTop(sender, dummies)
	picked.IsDummy = true
	return picked, nil
}

func scoreAndPickTop(sender Profile, candidates []Candidate) Candidate {
	now := time.Now().UTC()
	scored := make([]ScoredCandidate, len(candidates))
	for i, c := range candidates {
		scored[i] = ScoredCandidate{
			Candidate: c,
			Score:     SwingScore(sender, c, now),
		}
	}
	sortScoredDesc(scored)
	return scored[0].Candidate
}

func sortScoredDesc(items []ScoredCandidate) {
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			if items[j].Score > items[i].Score {
				items[i], items[j] = items[j], items[i]
			} else if items[j].Score == items[i].Score &&
				items[j].AccountID.String() < items[i].AccountID.String() {
				// Stable tie-break so the highest scorer is deterministic.
				items[i], items[j] = items[j], items[i]
			}
		}
	}
}

func (s *Service) listCandidates(
	ctx context.Context,
	senderID stdid.UUID,
	filters Filters,
	planeID *stdid.UUID,
	onlyDummy bool,
) ([]Candidate, error) {
	query, args := buildCandidateQuery(senderID, filters, planeID, onlyDummy)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Candidate
	for rows.Next() {
		var c Candidate
		var name, username, avatar, city, country, gender sql.NullString
		var dob sql.NullTime
		var lastActive sql.NullTime
		var isDummy bool
		if err := rows.Scan(
			&c.AccountID,
			&c.Interests,
			&c.CreatedAt,
			&name,
			&username,
			&avatar,
			&city,
			&country,
			&gender,
			&dob,
			&lastActive,
			&isDummy,
		); err != nil {
			return nil, err
		}
		c.Name = name.String
		c.Username = username.String
		c.AvatarURL = avatar.String
		c.City = city.String
		c.Country = country.String
		c.Gender = gender.String
		c.IsDummy = isDummy
		if dob.Valid {
			t := dob.Time
			c.DOB = &t
		}
		if lastActive.Valid {
			c.LastActiveAt = lastActive.Time
		} else {
			c.LastActiveAt = c.CreatedAt
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func buildCandidateQuery(
	senderID stdid.UUID,
	filters Filters,
	planeID *stdid.UUID,
	onlyDummy bool,
) (string, []any) {
	args := []any{senderID, fmt.Sprintf("%d hours", int(ResendCooldown.Hours()))}
	clauses := []string{
		`p.account_id != $1`,
		`NOT EXISTS (
			SELECT 1 FROM friendships f
			WHERE f.account_a = LEAST($1::uuid, p.account_id)
			  AND f.account_b = GREATEST($1::uuid, p.account_id)
		)`,
		`NOT EXISTS (
			SELECT 1 FROM plane_deliveries pd
			JOIN planes pl ON pl.id = pd.plane_id
			WHERE pl.sender_account_id = $1
			  AND pd.recipient_account_id = p.account_id
			  AND pd.delivered_at > NOW() - $2::interval
		)`,
	}

	if onlyDummy {
		clauses = append(clauses, `p.is_dummy = TRUE`, `p.profile_complete = TRUE`)
	} else {
		clauses = append(clauses,
			`COALESCE(p.is_dummy, FALSE) = FALSE`,
			`p.profile_complete = TRUE`,
			fmt.Sprintf(`(
				SELECT COUNT(*) FROM plane_deliveries pd
				WHERE pd.recipient_account_id = p.account_id
				  AND pd.delivered_at > NOW() - INTERVAL '24 hours'
			) < %d`, MaxInboxPer24h),
		)
	}

	argN := 3
	if planeID != nil {
		clauses = append(clauses, fmt.Sprintf(`
			NOT EXISTS (
				SELECT 1 FROM plane_deliveries pd
				WHERE pd.plane_id = $%d AND pd.recipient_account_id = p.account_id
			)`, argN))
		args = append(args, *planeID)
		argN++
	}

	if filters.Country != nil && strings.TrimSpace(*filters.Country) != "" {
		clauses = append(clauses, fmt.Sprintf(
			`LOWER(TRIM(p.country)) = LOWER(TRIM($%d))`, argN))
		args = append(args, strings.TrimSpace(*filters.Country))
		argN++
	}

	if gender := mapGenderFilter(filters.Gender); gender != "" {
		clauses = append(clauses, fmt.Sprintf(`p.gender = $%d`, argN))
		args = append(args, gender)
		argN++
	}

	ageMin, ageMax := 18, 99
	if filters.AgeRange != nil {
		if filters.AgeRange[0] > 0 {
			ageMin = filters.AgeRange[0]
		}
		if filters.AgeRange[1] > 0 {
			ageMax = filters.AgeRange[1]
		}
	}
	clauses = append(clauses, fmt.Sprintf(`
		p.dob IS NOT NULL
		AND EXTRACT(YEAR FROM AGE(p.dob))::int BETWEEN $%d AND $%d`, argN, argN+1))
	args = append(args, ageMin, ageMax)

	_ = filters.RadiusKm

	query := fmt.Sprintf(`
		SELECT
			p.account_id,
			p.interests,
			p.created_at,
			p.name,
			p.username,
			p.avatar_url,
			p.city,
			p.country,
			p.gender,
			p.dob,
			ps.last_active_at,
			p.is_dummy
		FROM profiles p
		LEFT JOIN profile_stats ps ON ps.account_id = p.account_id
		WHERE %s
		ORDER BY p.created_at DESC
		LIMIT %d
	`, strings.Join(clauses, "\n\t\tAND "), MaxCandidatePool)

	return query, args
}

func (s *Service) countOtherRealUsers(ctx context.Context, senderID stdid.UUID) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM profiles p
		WHERE p.account_id != $1
		  AND COALESCE(p.is_dummy, FALSE) = FALSE
		  AND p.profile_complete = TRUE
	`, senderID).Scan(&n)
	return n, err
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
