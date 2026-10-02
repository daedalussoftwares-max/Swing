package auth

import (
	"database/sql"
	"time"

	"lib/stdid"
)

// MeUser is the /v1/me JSON shape (client-facing "user" object).
type MeUser struct {
	ID              string  `json:"id"`
	Email           string  `json:"email"`
	Username        *string `json:"username,omitempty"`
	Name            *string `json:"name,omitempty"`
	Dob             *string `json:"dob,omitempty"`
	Gender          *string `json:"gender,omitempty"`
	Bio             *string `json:"bio,omitempty"`
	Interests       string  `json:"interests,omitempty"`
	City            *string `json:"city,omitempty"`
	Country         *string `json:"country,omitempty"`
	AvatarURL       *string `json:"avatarUrl,omitempty"`
	Provider        string  `json:"provider"`
	ProfileComplete bool    `json:"profileComplete"`
	PlanesRemaining int     `json:"planesRemaining"`
	CreatedAt       string  `json:"createdAt"`
}

type AuthResponse struct {
	User         MeUser `json:"user"`
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
}

type ProfilePatch struct {
	Username        *string
	Name            *string
	Dob             *string
	Gender          *string
	Bio             *string
	Interests       *string
	City            *string
	Country         *string
	AvatarURL       *string
	ProfileComplete *bool
}

type accountCredentials struct {
	ID           stdid.UUID
	Email        sql.NullString
	PasswordHash sql.NullString
	GoogleSub    sql.NullString
	CreatedAt    time.Time
}

type profileRecord struct {
	AccountID       stdid.UUID
	Username        sql.NullString
	Name            sql.NullString
	Dob             sql.NullTime
	Gender          sql.NullString
	Bio             string
	Interests       string
	City            sql.NullString
	Country         sql.NullString
	AvatarURL       sql.NullString
	ProfileComplete bool
	PlanesRemaining int
}

func providerFor(a accountCredentials) string {
	if a.GoogleSub.Valid && a.GoogleSub.String != "" {
		if a.PasswordHash.Valid && a.PasswordHash.String != "" {
			return "password"
		}
		return "google"
	}
	return "password"
}

func ToMeUser(a accountCredentials, p profileRecord) MeUser {
	u := MeUser{
		ID:              a.ID.String(),
		Email:           a.Email.String,
		Provider:        providerFor(a),
		ProfileComplete: p.ProfileComplete,
		PlanesRemaining: p.PlanesRemaining,
		CreatedAt:       a.CreatedAt.UTC().Format(time.RFC3339),
	}
	if p.Username.Valid {
		u.Username = &p.Username.String
	}
	if p.Name.Valid {
		u.Name = &p.Name.String
	}
	if p.Dob.Valid {
		s := p.Dob.Time.Format("2006-01-02")
		u.Dob = &s
	}
	if p.Gender.Valid {
		u.Gender = &p.Gender.String
	}
	if p.Bio != "" {
		u.Bio = &p.Bio
	}
	if p.Interests != "" {
		u.Interests = p.Interests
	}
	if p.City.Valid {
		u.City = &p.City.String
	}
	if p.Country.Valid {
		u.Country = &p.Country.String
	}
	if p.AvatarURL.Valid {
		u.AvatarURL = &p.AvatarURL.String
	}
	return u
}
