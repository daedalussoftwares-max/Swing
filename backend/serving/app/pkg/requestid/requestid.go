package requestid

import (
	"context"
	"net/http"
	"strings"

	"lib/stdid"
)

const Header = "X-Request-Id"

type ctxKey struct{}

// FromContext returns the request correlation id (empty if unset).
func FromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(ctxKey{}).(string)
	return id
}

func withContext(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

func newID() string {
	u, err := stdid.New()
	if err != nil {
		return ""
	}
	return u.String()
}

func normalizeClientID(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if len(raw) > 128 {
		return ""
	}
	u, err := stdid.Parse(raw)
	if err != nil {
		return ""
	}
	return u.String()
}

// Middleware assigns a request id (client header or new) and sets the response header.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := normalizeClientID(r.Header.Get(Header))
		if id == "" {
			id = newID()
		}
		w.Header().Set(Header, id)
		next.ServeHTTP(w, r.WithContext(withContext(r.Context(), id)))
	})
}
