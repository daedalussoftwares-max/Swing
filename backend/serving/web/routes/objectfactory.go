package routes

import (
	"net/http"

	"lib/stdcors"
	"lib/stdhttp"

	"serving/app/pkg/requestid"
	"serving/config"
	"serving/web/middlewares/accesslog"
)

func buildCORSMiddleware() func(http.Handler) http.Handler {
	return stdcors.Middleware(stdcors.Options{
		AllowedOrigins: config.GetAllowedOrigins(),
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "X-Request-Id"},
		MaxAge:         300,
	})
}

func wrapAPI(handler http.Handler) http.Handler {
	return stdhttp.Chain(handler,
		stdhttp.Recover,
		buildCORSMiddleware(),
		requestid.Middleware,
		accesslog.Middleware,
		limitBody, // see limits.go
		rateLimit,
	)
}
