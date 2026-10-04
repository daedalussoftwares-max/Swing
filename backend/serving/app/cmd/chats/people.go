package chats

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"lib/stdid"
)

// PublicProfile is what any signed-in user may see about another user.
// No email, exact DOB or location — only coarse, user-facing fields.
type PublicProfile struct {
	ID           stdid.UUID  `json:"id"`
	Name         string      `json:"name"`
	Username     string      `json:"username,omitempty"`
	AvatarURL    string      `json:"avatarUrl,omitempty"`
	Bio          string      `json:"bio,omitempty"`
	Interests    []string    `json:"interests"`
	Age          *int        `json:"age,omitempty"`
	Gender       string      `json:"gender,omitempty"`
	City         string      `json:"city,omitempty"`
	Country      string      `json:"country,omitempty"`
	JoinedAt     time.Time   `json:"joinedAt"`
	LastActiveAt *time.Time  `json:"lastActiveAt,omitempty"`
	Online       bool        `json:"online"`
	IsFriend     bool        `json:"isFriend"`
	ChatID       *stdid.UUID `json:"chatId,omitempty"`
	BlockedByMe  bool        `json:"blockedByMe"`
}

func (s *Service) PublicProfile(ctx context.Context, viewerID, userID stdid.UUID) (PublicProfile, error) {
	var (
		p                                             PublicProfile
		name, username, avatar, gender, city, country sql.NullString
		bio, interests                                string
		dob                                           sql.NullTime
		lastActive                                    sql.NullTime
		chatID                                        sql.NullString
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT
			p.account_id, p.name, p.username, p.avatar_url, p.bio, p.interests,
			p.dob, p.gender, p.city, p.country, p.created_at, ps.last_active_at,
			EXISTS (
				SELECT 1 FROM friendships f
				WHERE f.account_a = LEAST($1::uuid, $2::uuid) AND f.account_b = GREATEST($1::uuid, $2::uuid)
			),
			(SELECT c.id::text FROM chats c
			 WHERE c.account_a = LEAST($1::uuid, $2::uuid) AND c.account_b = GREATEST($1::uuid, $2::uuid)),
			EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = $1 AND b.blocked_id = $2)
		FROM profiles p
		LEFT JOIN profile_stats ps ON ps.account_id = p.account_id
		WHERE p.account_id = $2
	`, viewerID, userID).Scan(
		&p.ID, &name, &username, &avatar, &bio, &interests,
		&dob, &gender, &city, &country, &p.JoinedAt, &lastActive,
		&p.IsFriend, &chatID, &p.BlockedByMe,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return PublicProfile{}, ErrNotFound
	}
	if err != nil {
		return PublicProfile{}, err
	}
	p.Name = coalesceName(name.String, username.String)
	p.Username = username.String
	p.AvatarURL = avatar.String
	p.Bio = strings.TrimSpace(bio)
	p.Gender = gender.String
	p.City = city.String
	p.Country = country.String
	p.Interests = []string{}
	for _, t := range strings.Split(interests, ",") {
		if t = strings.TrimSpace(t); t != "" {
			p.Interests = append(p.Interests, t)
		}
	}
	if dob.Valid {
		age := ageOn(dob.Time, time.Now())
		p.Age = &age
	}
	if chatID.Valid {
		if id, err := stdid.Parse(chatID.String); err == nil {
			p.ChatID = &id
		}
	}
	// Someone who blocked me looks permanently offline with no last-seen.
	hiddenFromMe := s.HasBlocked(ctx, userID, viewerID)
	if lastActive.Valid && !hiddenFromMe {
		t := lastActive.Time
		p.LastActiveAt = &t
	}
	if s.hub != nil && !hiddenFromMe && !p.BlockedByMe {
		p.Online = s.hub.IsOnline(userID)
	}
	return p, nil
}

func ageOn(dob, now time.Time) int {
	age := now.Year() - dob.Year()
	if now.YearDay() < dob.YearDay() {
		age--
	}
	return age
}
