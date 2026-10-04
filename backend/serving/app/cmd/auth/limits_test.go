package auth

import (
	"errors"
	"strings"
	"testing"
)

func strp(s string) *string { return &s }

func TestValidateProfileLengths(t *testing.T) {
	ok := []ProfilePatch{
		{Name: strp(strings.Repeat("é", 50))},
		{Bio: strp(strings.Repeat("a", 500))},
		{City: strp("  " + strings.Repeat("c", 80) + "  ")},
		{Country: strp(strings.Repeat("x", 60))},
		{Interests: strp(strings.Repeat("t,", 20))},
	}
	for i, p := range ok {
		if err := validateProfileLengths(p); err != nil {
			t.Fatalf("case %d: unexpected %v", i, err)
		}
	}
	bad := []ProfilePatch{
		{Name: strp(strings.Repeat("é", 51))},
		{Bio: strp(strings.Repeat("a", 501))},
		{City: strp(strings.Repeat("c", 81))},
		{Country: strp(strings.Repeat("x", 61))},
		{Interests: strp(strings.Repeat("t,", 21))},
		{Interests: strp(strings.Repeat("a", 501))},
	}
	for i, p := range bad {
		if err := validateProfileLengths(p); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("case %d: want ErrInvalidInput, got %v", i, err)
		}
	}
}
