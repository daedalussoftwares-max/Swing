package ratelimit

import (
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time      { return c.t }
func (c *fakeClock) add(d time.Duration) { c.t = c.t.Add(d) }
func newTestLimiter(cfg Config) (*Limiter, *fakeClock) {
	c := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	l := New(cfg)
	l.now = c.now
	return l, c
}

func TestBurstThenDeny(t *testing.T) {
	l, _ := newTestLimiter(Config{Rate: 10, Per: time.Minute, Burst: 5})
	for i := 0; i < 5; i++ {
		if ok, _ := l.Allow("ip:1"); !ok {
			t.Fatalf("request %d denied within burst", i)
		}
	}
	ok, wait := l.Allow("ip:1")
	if ok {
		t.Fatal("6th request allowed past burst")
	}
	if wait <= 0 || wait > 6*time.Second+time.Millisecond {
		t.Fatalf("unexpected retry-after %v (want ~6s)", wait)
	}
	// Other keys are independent.
	if ok, _ := l.Allow("ip:2"); !ok {
		t.Fatal("independent key denied")
	}
}

func TestRefill(t *testing.T) {
	l, c := newTestLimiter(Config{Rate: 60, Per: time.Minute, Burst: 1})
	if ok, _ := l.Allow("u"); !ok {
		t.Fatal("first denied")
	}
	if ok, _ := l.Allow("u"); ok {
		t.Fatal("second allowed without refill")
	}
	c.add(500 * time.Millisecond)
	if ok, _ := l.Allow("u"); ok {
		t.Fatal("allowed after half a token")
	}
	c.add(600 * time.Millisecond)
	if ok, _ := l.Allow("u"); !ok {
		t.Fatal("denied after refill")
	}
	// Refill never exceeds burst.
	c.add(time.Hour)
	l.Allow("u")
	if ok, _ := l.Allow("u"); ok {
		t.Fatal("bucket exceeded burst after long idle")
	}
}

func TestIdleEvictionAndKeyCap(t *testing.T) {
	l, c := newTestLimiter(Config{Rate: 60, Per: time.Minute, Burst: 2, MaxKeys: 50})
	for i := 0; i < 40; i++ {
		l.Allow(string(rune('A' + i)))
	}
	if l.Len() != 40 {
		t.Fatalf("len=%d want 40", l.Len())
	}
	c.add(time.Minute) // all idle (full again)
	l.Allow("fresh")
	if l.Len() != 1 {
		t.Fatalf("idle buckets not swept, len=%d", l.Len())
	}
	for i := 0; i < 500; i++ {
		l.Allow(string(rune(0x1000 + i)))
	}
	if l.Len() > 50 {
		t.Fatalf("key cap exceeded: %d", l.Len())
	}
}

func TestConcurrent(t *testing.T) {
	l := New(Config{Rate: 1, Per: time.Hour, Burst: 100})
	var wg sync.WaitGroup
	var mu sync.Mutex
	allowed := 0
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 50; i++ {
				if ok, _ := l.Allow("k"); ok {
					mu.Lock()
					allowed++
					mu.Unlock()
				}
			}
		}()
	}
	wg.Wait()
	if allowed != 100 {
		t.Fatalf("allowed=%d want 100", allowed)
	}
}

func TestClientIP(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "10.0.0.9:5555"
	r.Header.Set("X-Forwarded-For", "6.6.6.6, 203.0.113.7")
	if got := ClientIP(r, false); got != "10.0.0.9" {
		t.Fatalf("untrusted: got %q", got)
	}
	if got := ClientIP(r, true); got != "203.0.113.7" {
		t.Fatalf("trusted: got %q", got)
	}
	r.Header.Del("X-Forwarded-For")
	if got := ClientIP(r, true); got != "10.0.0.9" {
		t.Fatalf("trusted without header: got %q", got)
	}
}
