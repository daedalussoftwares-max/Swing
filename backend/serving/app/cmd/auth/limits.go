package auth

import (
	"strings"
	"unicode/utf8"
)

// Profile field caps (characters, after trimming).
const (
	maxNameLen          = 50
	maxBioLen           = 500
	maxCityLen          = 80
	maxCountryLen       = 60
	maxInterestsLen     = 500
	maxInterestsRawTags = 20
)

// validateProfileLengths rejects oversized profile fields with ErrInvalidInput.
func validateProfileLengths(p ProfilePatch) error {
	tooLong := func(v *string, max int) bool {
		return v != nil && utf8.RuneCountInString(strings.TrimSpace(*v)) > max
	}
	if tooLong(p.Name, maxNameLen) ||
		tooLong(p.Bio, maxBioLen) ||
		tooLong(p.City, maxCityLen) ||
		tooLong(p.Country, maxCountryLen) ||
		tooLong(p.Interests, maxInterestsLen) {
		return ErrInvalidInput
	}
	if p.Interests != nil {
		n := 0
		for _, part := range strings.Split(*p.Interests, ",") {
			if strings.TrimSpace(part) != "" {
				n++
			}
		}
		if n > maxInterestsRawTags {
			return ErrInvalidInput
		}
	}
	return nil
}
