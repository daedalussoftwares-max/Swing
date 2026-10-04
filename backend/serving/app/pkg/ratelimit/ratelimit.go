// Package ratelimit is an in-memory token-bucket limiter keyed by an
// arbitrary string (user id, client IP, ...). It is per-process: with several
// API instances each enforces its own budget.
//
// Memory is bounded: idle buckets (which would be full again anyway) are
// swept lazily on Allow, and when MaxKeys is reached arbitrary buckets are
// evicted. No background goroutine is started.
package ratelimit

import (
	"math"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Config describes one limit: Rate tokens per Per, holding at most Burst.
type Config struct {
	Rate  int           // tokens refilled per Per
	Per   time.Duration // refill period for Rate tokens
	Burst int           // bucket capacity
	// MaxKeys caps the number of tracked keys (default 100k).
	MaxKeys int
}

type bucket struct {
	tokens float64
	last   time.Time
}

// Limiter is safe for concurrent use.
type Limiter struct {
	mu        sync.Mutex
	perSec    float64
	burst     float64
	idleTTL   time.Duration
	maxKeys   int
	buckets   map[string]*bucket
	lastSweep time.Time
	now       func() time.Time
}

// New builds a limiter. Rate, Per and Burst must be positive.
func New(cfg Config) *Limiter {
	if cfg.Rate <= 0 || cfg.Per <= 0 || cfg.Burst <= 0 {
		panic("ratelimit: Rate, Per and Burst must be positive")
	}
	perSec := float64(cfg.Rate) / cfg.Per.Seconds()
	maxKeys := cfg.MaxKeys
	if maxKeys <= 0 {
		maxKeys = 100_000
	}
	// After this long without requests a bucket has refilled completely, so
	// forgetting it changes nothing.
	idle := time.Duration(float64(cfg.Burst)/perSec*float64(time.Second)) + time.Second
	return &Limiter{
		perSec:  perSec,
		burst:   float64(cfg.Burst),
		idleTTL: idle,
		maxKeys: maxKeys,
		buckets: make(map[string]*bucket),
		now:     time.Now,
	}
}

// Allow takes one token for key. When none is available it returns false and
// how long until one will be.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()

	b, ok := l.buckets[key]
	if !ok {
		l.makeRoom(now)
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	} else if elapsed := now.Sub(b.last).Seconds(); elapsed > 0 {
		b.tokens = math.Min(l.burst, b.tokens+elapsed*l.perSec)
		b.last = now
	}

	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	wait := time.Duration((1 - b.tokens) / l.perSec * float64(time.Second))
	return false, wait
}

// Len reports the number of tracked keys.
func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

// makeRoom sweeps idle buckets at most once per idleTTL, then evicts one
// arbitrary bucket if the key cap is reached (O(1) per insert under a flood
// of new keys). Caller holds l.mu.
func (l *Limiter) makeRoom(now time.Time) {
	if now.Sub(l.lastSweep) >= l.idleTTL {
		for k, b := range l.buckets {
			if now.Sub(b.last) >= l.idleTTL {
				delete(l.buckets, k)
			}
		}
		l.lastSweep = now
	}
	if len(l.buckets) >= l.maxKeys {
		for k := range l.buckets {
			delete(l.buckets, k)
			break
		}
	}
}

// ClientIP returns the caller's IP. X-Forwarded-For is only honoured when
// trustProxy is set (we run behind exactly one trusted reverse proxy); then
// the right-most entry — the one our proxy appended — is used, since
// left-most entries are client-controlled.
func ClientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			for i := len(parts) - 1; i >= 0; i-- {
				if ip := strings.TrimSpace(parts[i]); ip != "" {
					return ip
				}
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
