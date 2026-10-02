package pg

import (
	"net/url"
	"strings"
	"testing"
)

func TestResolveDatabaseURL_localhostUnchanged(t *testing.T) {
	t.Parallel()
	in := "postgresql://user:pass@127.0.0.1:5432/db?sslmode=disable"
	got, err := resolveDatabaseURL(in)
	if err != nil {
		t.Fatal(err)
	}
	if got != in {
		t.Fatalf("expected unchanged, got %s", got)
	}
}

func TestResolveDatabaseURL_rewritesAuthorityHostToHostaddr(t *testing.T) {
	t.Parallel()
	// Simulate rewrite output shape (no live DNS): test helper via manual URL.
	in := "postgresql://user:pass@db.example.com:5432/mydb?sslmode=require"
	got, err := resolveDatabaseURL(in)
	if err != nil {
		t.Skipf("DNS lookup failed in CI/sandbox: %v", err)
	}
	if got == in {
		t.Skip("no rewrite (no IPv4 for db.example.com in this environment)")
	}
	if strings.Contains(got, "@db.example.com") {
		t.Fatalf("authority should not contain hostname; got %s", got)
	}
	u, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if q.Get("host") != "db.example.com" {
		t.Fatalf("host param: %q", q.Get("host"))
	}
	if q.Get("hostaddr") == "" {
		t.Fatalf("expected hostaddr in %s", got)
	}
	if !strings.Contains(q.Get("hostaddr"), ".") {
		t.Fatalf("hostaddr should be IPv4: %q", q.Get("hostaddr"))
	}
}
