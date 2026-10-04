package bearer

import (
	"context"
	"net/http"
	"strings"

	"lib/stdid"

	"serving/app/cmd/common"
	"serving/app/pkg/httpx"
)

type contextKey string

const userIDKey contextKey = "userID"

func UserIDFromContext(ctx context.Context) (stdid.UUID, bool) {
	id, ok := ctx.Value(userIDKey).(stdid.UUID)
	return id, ok && !id.IsZero()
}

func WithBearerAuth() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" || !strings.HasPrefix(header, "Bearer ") {
				httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Missing access token.")
				return
			}
			token := strings.TrimPrefix(header, "Bearer ")
			userID, err := common.Tokens.ParseAccess(token)
			if err != nil {
				httpx.Error(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "Invalid or expired access token.")
				return
			}
			ctx := context.WithValue(r.Context(), userIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
