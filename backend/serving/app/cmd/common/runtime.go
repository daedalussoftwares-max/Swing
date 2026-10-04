package common

import (
	"lib/pg"

	"serving/app/cmd/auth"
	"serving/app/cmd/chats"
	"serving/app/cmd/notifications"
	"serving/app/cmd/planes"
	"serving/app/cmd/status"
	"serving/app/pkg/r2storage"
	"serving/app/pkg/realtime"
)

var (
	DB            *pg.DB
	Tokens        *auth.TokenService
	Auth          *auth.Service
	Status        *status.Service
	Planes        *planes.Service
	Chats         *chats.Service
	Notifications *notifications.Service
	Realtime      *realtime.Hub
	R2            *r2storage.Client
)

func SetRuntime(
	db *pg.DB,
	tokens *auth.TokenService,
	authSvc *auth.Service,
	statusSvc *status.Service,
	planesSvc *planes.Service,
	chatsSvc *chats.Service,
	notificationsSvc *notifications.Service,
	hub *realtime.Hub,
	r2 *r2storage.Client,
) {
	DB = db
	Tokens = tokens
	Auth = authSvc
	Status = statusSvc
	Planes = planesSvc
	Chats = chatsSvc
	Notifications = notificationsSvc
	Realtime = hub
	R2 = r2
}

func Close() {
	if Planes != nil {
		Planes.Stop() // drain plane dispatcher before the DB goes away
	}
	if DB != nil {
		_ = DB.Close()
	}
}
