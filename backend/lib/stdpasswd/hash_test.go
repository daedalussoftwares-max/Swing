package stdpasswd

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// legacyHash reproduces the old Hash output format.
func legacyHash(password string, iter int) string {
	salt := []byte("0123456789abcdef")
	dk := deriveLegacy(password, salt, iter, 32)
	return fmt.Sprintf("sha256kdf$%d$%s$%s", iter,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(dk))
}

func TestHashIsBcrypt(t *testing.T) {
	h, err := Hash("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$2a$12$") {
		t.Fatalf("unexpected hash format %q", h)
	}
	if !Compare(h, "correct horse") {
		t.Fatal("bcrypt hash did not verify")
	}
	if Compare(h, "wrong horse") {
		t.Fatal("wrong password verified")
	}
	if NeedsRehash(h) {
		t.Fatal("fresh bcrypt hash should not need rehash")
	}
}

func TestLegacyVerifiesAndNeedsRehash(t *testing.T) {
	h := legacyHash("hunter22", 1000)
	if !Compare(h, "hunter22") {
		t.Fatal("legacy hash did not verify")
	}
	if Compare(h, "hunter23") {
		t.Fatal("legacy hash verified wrong password")
	}
	if !NeedsRehash(h) {
		t.Fatal("legacy hash must need rehash")
	}

	// Simulate the login-time upgrade.
	upgraded, err := Hash("hunter22")
	if err != nil {
		t.Fatal(err)
	}
	if !Compare(upgraded, "hunter22") || NeedsRehash(upgraded) {
		t.Fatal("upgraded hash invalid")
	}
}

func TestLowCostBcryptNeedsRehash(t *testing.T) {
	b, err := bcrypt.GenerateFromPassword([]byte("pw123456"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if !Compare(string(b), "pw123456") {
		t.Fatal("low-cost hash did not verify")
	}
	if !NeedsRehash(string(b)) {
		t.Fatal("low-cost hash should need rehash")
	}
}

func TestRejectsGarbageAndTooLong(t *testing.T) {
	for _, enc := range []string{"", "plain", "sha256kdf$x$y$z", "sha256kdf$0$AA$AA", "$2a$broken"} {
		if Compare(enc, "anything") {
			t.Fatalf("garbage hash %q verified", enc)
		}
	}
	if _, err := Hash(strings.Repeat("a", MaxPasswordBytes+1)); err != ErrPasswordTooLong {
		t.Fatalf("want ErrPasswordTooLong, got %v", err)
	}
	CompareDummy("whatever") // must not panic
}
