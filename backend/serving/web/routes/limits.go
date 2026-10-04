package routes

import (
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"serving/app/cmd/common"
	"serving/app/pkg/httpx"
	"serving/app/pkg/ratelimit"
	"serving/config"
)

// maxJSONBody caps every request body. The API only receives small JSON
// documents: media bytes go straight to R2 through presigned URLs and the
// WebSocket route is a body-less GET upgrade.
const maxJSONBody = 64 << 10

// limitBody rejects declared-oversized bodies with 413 and wraps the rest in
// http.MaxBytesReader so chunked bodies also stop at maxJSONBody (the JSON
// decoder then fails and handlers answer 400 INVALID_BODY).
func limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength > maxJSONBody {
			httpx.Error(w, r, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Request is too large.")
			return
		}
		if r.Body != nil && r.Body != http.NoBody {
			r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
		}
		next.ServeHTTP(w, r)
	})
}

type limitRule struct {
	name  string
	match func(r *http.Request) bool
	lim   *ratelimit.Limiter
	byIP  bool // key by client IP even when authenticated
}

func isPost(r *http.Request) bool { return r.Method == http.MethodPost }

// rateLimitRules: first match wins. Limits are per process.
var rateLimitRules = []limitRule{
	{
		name: "auth",
		match: func(r *http.Request) bool {
			if !isPost(r) {
				return false
			}
			switch r.URL.Path {
			case "/v1/auth/login", "/v1/auth/register", "/v1/auth/google", "/v1/auth/refresh":
				return true
			}
			return false
		},
		lim:  ratelimit.New(ratelimit.Config{Rate: 10, Per: time.Minute, Burst: 5}),
		byIP: true,
	},
	{
		name: "chat_send",
		match: func(r *http.Request) bool {
			// POST /v1/chats/{id}/messages
			if !isPost(r) || !strings.HasPrefix(r.URL.Path, "/v1/chats/") {
				return false
			}
			seg := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
			return len(seg) == 4 && seg[3] == "messages"
		},
		lim: ratelimit.New(ratelimit.Config{Rate: 60, Per: time.Minute, Burst: 20}),
	},
	{
		name:  "plane_send",
		match: func(r *http.Request) bool { return isPost(r) && r.URL.Path == "/v1/planes" },
		lim:   ratelimit.New(ratelimit.Config{Rate: 10, Per: time.Minute, Burst: 5}),
	},
	{
		name:  "reports",
		match: func(r *http.Request) bool { return isPost(r) && r.URL.Path == "/v1/reports" },
		lim:   ratelimit.New(ratelimit.Config{Rate: 10, Per: time.Hour, Burst: 5}),
	},
	{
		name:  "upload_url",
		match: func(r *http.Request) bool { return isPost(r) && strings.HasSuffix(r.URL.Path, "/upload-url") },
		lim:   ratelimit.New(ratelimit.Config{Rate: 30, Per: time.Minute, Burst: 10}),
	},
	{
		name: "default",
		match: func(r *http.Request) bool {
			return r.Method != http.MethodOptions && r.URL.Path != "/health"
		},
		lim: ratelimit.New(ratelimit.Config{Rate: 300, Per: time.Minute, Burst: 100}),
	},
}

// rateLimit applies the first matching rule, keyed by the authenticated user
// id (from a valid bearer token) or the client IP.
func rateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trustProxy := config.TrustProxy()
		for i := range rateLimitRules {
			rule := &rateLimitRules[i]
			if !rule.match(r) {
				continue
			}
			key := rateLimitKey(r, rule.byIP, trustProxy)
			if ok, wait := rule.lim.Allow(rule.name + "|" + key); !ok {
				secs := int(math.Ceil(wait.Seconds()))
				if secs < 1 {
					secs = 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(secs))
				httpx.Error(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.")
				return
			}
			break
		}
		next.ServeHTTP(w, r)
	})
}

func rateLimitKey(r *http.Request, byIP, trustProxy bool) string {
	if !byIP && common.Tokens != nil {
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			if id, err := common.Tokens.ParseAccess(strings.TrimPrefix(h, "Bearer ")); err == nil {
				return "u:" + id.String()
			}
		}
	}
	return "ip:" + ratelimit.ClientIP(r, trustProxy)
}
