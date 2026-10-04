// Package stdpasswd hashes and verifies account passwords.
//
// New hashes use bcrypt (cost 12). Hashes produced by the previous
// home-made iterated SHA-256 scheme ("sha256kdf$iter$salt$hash") still
// verify; callers should check NeedsRehash after a successful Compare and
// store a fresh Hash so legacy hashes disappear on next login.
package stdpasswd

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/crypto/bcrypt"
)

// Cost is the bcrypt work factor for new hashes.
const Cost = 12

// MaxPasswordBytes is bcrypt's input limit; longer passwords cannot be hashed.
const MaxPasswordBytes = 72

// ErrPasswordTooLong is returned by Hash for passwords over MaxPasswordBytes.
var ErrPasswordTooLong = errors.New("password too long")

const legacyPrefix = "sha256kdf"

// Hash returns a bcrypt hash ("$2a$12$...").
func Hash(password string) (string, error) {
	if len(password) > MaxPasswordBytes {
		return "", ErrPasswordTooLong
	}
	b, err := bcrypt.GenerateFromPassword([]byte(password), Cost)
	if err != nil {
		if errors.Is(err, bcrypt.ErrPasswordTooLong) {
			return "", ErrPasswordTooLong
		}
		return "", err
	}
	return string(b), nil
}

// Compare verifies a password against a bcrypt or legacy sha256kdf hash.
func Compare(encoded, password string) bool {
	switch {
	case isBcrypt(encoded):
		return bcrypt.CompareHashAndPassword([]byte(encoded), []byte(password)) == nil
	case strings.HasPrefix(encoded, legacyPrefix+"$"):
		return compareLegacy(encoded, password)
	default:
		return false
	}
}

// NeedsRehash reports whether encoded should be replaced by a fresh Hash
// (legacy format, or bcrypt below the current cost).
func NeedsRehash(encoded string) bool {
	if !isBcrypt(encoded) {
		return true
	}
	cost, err := bcrypt.Cost([]byte(encoded))
	return err != nil || cost < Cost
}

var (
	dummyOnce sync.Once
	dummyHash []byte
)

// CompareDummy burns roughly the same CPU as a real Compare. Call it when
// there is no hash to check (unknown email, Google-only account) so response
// timing does not reveal whether the account exists.
func CompareDummy(password string) {
	dummyOnce.Do(func() {
		dummyHash, _ = bcrypt.GenerateFromPassword([]byte("swing-dummy-password"), Cost)
	})
	_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
}

func isBcrypt(encoded string) bool {
	return strings.HasPrefix(encoded, "$2a$") ||
		strings.HasPrefix(encoded, "$2b$") ||
		strings.HasPrefix(encoded, "$2y$")
}

// compareLegacy verifies "sha256kdf$iter$salt$hash" hashes.
func compareLegacy(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != legacyPrefix {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter < 1 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got := deriveLegacy(password, salt, iter, len(want))
	return subtle.ConstantTimeCompare(got, want) == 1
}

func deriveLegacy(password string, salt []byte, iter, keyLen int) []byte {
	buf := make([]byte, 0, len(salt)+len(password))
	buf = append(buf, salt...)
	buf = append(buf, password...)
	h := sha256.Sum256(buf)
	out := h[:]
	for i := 1; i < iter; i++ {
		h = sha256.Sum256(out)
		out = h[:]
	}
	if len(out) >= keyLen {
		return out[:keyLen]
	}
	return out
}
