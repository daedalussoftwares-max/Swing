package routes

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.ReadAll(r.Body); err != nil {
			http.Error(w, "body", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
}

func TestLimitBody(t *testing.T) {
	h := limitBody(okHandler())

	small := httptest.NewRequest("POST", "/v1/auth/login", strings.NewReader(`{"a":1}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, small)
	if rec.Code != http.StatusOK {
		t.Fatalf("small body: %d", rec.Code)
	}

	big := httptest.NewRequest("POST", "/v1/me", strings.NewReader(strings.Repeat("x", maxJSONBody+1)))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, big)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("declared big body: %d", rec.Code)
	}

	// Unknown length (chunked) is cut off by MaxBytesReader.
	chunked := httptest.NewRequest("POST", "/v1/me", io.NopCloser(strings.NewReader(strings.Repeat("x", maxJSONBody+1))))
	chunked.ContentLength = -1
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, chunked)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("chunked big body: %d", rec.Code)
	}

	ws := httptest.NewRequest("GET", "/v1/ws", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, ws)
	if rec.Code != http.StatusOK {
		t.Fatalf("ws get: %d", rec.Code)
	}
}

func TestRateLimitAuthPerIP(t *testing.T) {
	h := rateLimit(okHandler())
	do := func(ip string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/v1/auth/login", strings.NewReader("{}"))
		r.RemoteAddr = ip + ":1234"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		return rec
	}
	for i := 0; i < 5; i++ {
		if rec := do("198.51.100.1"); rec.Code != http.StatusOK {
			t.Fatalf("req %d: %d", i, rec.Code)
		}
	}
	rec := do("198.51.100.1")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429, got %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After")
	}
	if !strings.Contains(rec.Body.String(), `"RATE_LIMITED"`) {
		t.Fatalf("body %s", rec.Body.String())
	}
	if rec := do("198.51.100.2"); rec.Code != http.StatusOK {
		t.Fatalf("other IP limited: %d", rec.Code)
	}
}

func TestRateLimitRuleMatching(t *testing.T) {
	cases := map[string]string{
		"POST /v1/chats/abc/messages":        "chat_send",
		"GET /v1/chats/abc/messages":         "default",
		"POST /v1/chats/abc/messages/x/view": "default",
		"POST /v1/planes":                    "plane_send",
		"POST /v1/reports":                   "reports",
		"POST /v1/media/chat/upload-url":     "upload_url",
		"POST /v1/me/avatar/upload-url":      "upload_url",
		"POST /v1/auth/google":               "auth",
		"POST /v1/auth/logout":               "default",
		"GET /health":                        "",
		"OPTIONS /v1/planes":                 "",
	}
	for in, want := range cases {
		parts := strings.SplitN(in, " ", 2)
		r := httptest.NewRequest(parts[0], parts[1], nil)
		got := ""
		for _, rule := range rateLimitRules {
			if rule.match(r) {
				got = rule.name
				break
			}
		}
		if got != want {
			t.Errorf("%s: got %q want %q", in, got, want)
		}
	}
}
