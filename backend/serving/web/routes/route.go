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
	mux.Handle("PUT /v1/me/location", bearer.WithBearerAuth()(http.HandlerFunc(controllers.PutMyLocation)))
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

	mux.Handle("GET /v1/chats", bearer.WithBearerAuth()(http.HandlerFunc(controllers.ListChats)))
	mux.Handle(
		"GET /v1/chats/{id}/messages",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.ListChatMessages)),
	)
	mux.Handle(
		"POST /v1/chats/{id}/messages",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.SendChatMessage)),
	)
	mux.Handle(
		"POST /v1/chats/{id}/read",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.MarkChatRead)),
	)
	mux.Handle(
		"POST /v1/chats/{id}/delivered",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.MarkChatDelivered)),
	)
	mux.Handle(
		"POST /v1/chats/{id}/typing",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.ChatTyping)),
	)
	mux.Handle(
		"PUT /v1/chats/{id}/pin",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.PinChat)),
	)
	mux.Handle(
		"DELETE /v1/chats/{id}/pin",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.UnpinChat)),
	)
	mux.Handle(
		"DELETE /v1/chats/{id}",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.DeleteChat)),
	)
	mux.Handle(
		"GET /v1/users/{id}",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.GetUserProfile)),
	)
	mux.Handle(
		"POST /v1/users/{id}/block",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.BlockUser)),
	)
	mux.Handle(
		"DELETE /v1/users/{id}/block",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.UnblockUser)),
	)
	mux.Handle(
		"POST /v1/reports",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.CreateReport)),
	)
	mux.Handle(
		"POST /v1/chats/{id}/messages/{mid}/view",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.OpenViewOnceMessage)),
	)
	mux.Handle(
		"PUT /v1/chats/{id}/messages/{mid}/reaction",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.SetChatReaction)),
	)
	mux.Handle(
		"DELETE /v1/chats/{id}/messages/{mid}/reaction",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.RemoveChatReaction)),
	)
	mux.Handle(
		"PATCH /v1/chats/{id}/messages/{mid}",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.EditChatMessage)),
	)
	mux.Handle(
		"DELETE /v1/chats/{id}/messages/{mid}",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.DeleteChatMessage)),
	)
	mux.Handle(
		"POST /v1/devices",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.RegisterDevice)),
	)
	mux.Handle(
		"DELETE /v1/devices",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.UnregisterDevice)),
	)

	mux.Handle(
		"GET /v1/notifications",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.ListNotifications)),
	)
	mux.Handle(
		"POST /v1/notifications/read-all",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.MarkAllNotificationsRead)),
	)
	mux.Handle(
		"POST /v1/notifications/{id}/read",
		bearer.WithBearerAuth()(http.HandlerFunc(controllers.MarkNotificationRead)),
	)

	mux.HandleFunc("GET /v1/ws", controllers.RealtimeWS)

	return mux
}

func Init() {}
