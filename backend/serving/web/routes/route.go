package routes

import (
	"net/http"

	"serving/web/controllers"
	"serving/web/middlewares/bearer"
)

func AddRoutes(mux *http.ServeMux) {
	api := wrapAPI(newAPIHandler())
	mux.Handle("/", api)
}

func newAPIHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", controllers.Health)

	mux.HandleFunc("POST /v1/auth/register", controllers.Register)
	mux.HandleFunc("POST /v1/auth/login", controllers.Login)
	mux.HandleFunc("POST /v1/auth/google", controllers.LoginGoogle)
	mux.HandleFunc("POST /v1/auth/refresh", controllers.Refresh)
	mux.HandleFunc("POST /v1/auth/logout", controllers.Logout)

	mux.HandleFunc("GET /v1/usernames/{username}/available", controllers.UsernameAvailable)

	mux.Handle("GET /v1/me", bearer.WithBearerAuth()(http.HandlerFunc(controllers.Me)))
	mux.Handle("PATCH /v1/me", bearer.WithBearerAuth()(http.HandlerFunc(controllers.PatchMe)))
	mux.Handle("DELETE /v1/me", bearer.WithBearerAuth()(http.HandlerFunc(controllers.DeleteMe)))
	mux.Handle(
		"POST /v1/me/avatar/upload-url",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.AvatarUploadURL)),
	)

	mux.Handle("GET /v1/me/status", bearer.WithBearerAuth()(http.HandlerFunc(controllers.ListMyStatus)))
	mux.Handle("POST /v1/me/status", bearer.WithBearerAuth()(http.HandlerFunc(controllers.CreateStatus)))
	mux.Handle(
		"DELETE /v1/me/status/{id}",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.DeleteStatus)),
	)
	mux.Handle(
		"POST /v1/me/status/upload-url",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.StatusUploadURL)),
	)
	mux.Handle(
		"GET /v1/status/{accountId}",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.ListAccountStatus)),
	)

	mux.Handle(
		"POST /v1/media/chat/upload-url",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.ChatUploadURL)),
	)
	mux.Handle(
		"POST /v1/media/read-url",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.MediaReadURL)),
	)

	mux.Handle("POST /v1/planes", bearer.WithBearerAuth()(http.HandlerFunc(controllers.SendPlane)))
	mux.Handle("GET /v1/planes/inbox", bearer.WithBearerAuth()(http.HandlerFunc(controllers.ListInboxPlanes)))
	mux.Handle("GET /v1/planes/outbox", bearer.WithBearerAuth()(http.HandlerFunc(controllers.ListOutboxPlanes)))
	mux.Handle(
		"POST /v1/planes/{id}/accept",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.AcceptPlane)),
	)
	mux.Handle(
		"POST /v1/planes/{id}/reject",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.RejectPlane)),
	)

	return mux
}

func Init() {}
