package common

import (
	"context"
	"time"

	"lib/pg"

	"serving/app/cmd/auth"
	"serving/app/cmd/chats"
	"serving/app/cmd/notifications"
	"serving/app/cmd/planes"
	"serving/app/cmd/status"
	"serving/app/pkg/background"
	"serving/app/pkg/logx"
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

// Shutdown releases runtime resources in dependency order, after the HTTP
// server has stopped accepting requests (web.ShutDown):
//
//  1. close every WebSocket (clients reconnect to another instance)
//  2. stop the plane dispatcher (it produces background push jobs)
//  3. drain the background pool (pushes / notifications in flight)
//  4. close the database
//
// Steps 1-3 share the timeout; the DB is closed regardless.
func Shutdown(timeout time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if Realtime != nil {
		n := Realtime.CloseAll()
		logx.Info("shutdown: websockets closed", "count", n)
	}
	if Planes != nil {
		Planes.Stop() // bounded internally (5s)
		logx.Info("shutdown: plane dispatcher stopped")
	}
	if err := background.Shutdown(ctx); err != nil {
		logx.Warn("shutdown: background jobs did not finish in time", "err", err.Error())
	} else {
		logx.Info("shutdown: background jobs drained")
	}
	if DB != nil {
		if err := DB.Close(); err != nil {
			logx.Error("shutdown: close database", err)
		}
	}
}

// Close shuts down with a default timeout. Kept for callers that predate
// Shutdown.
func Close() {
	Shutdown(DefaultShutdownTimeout)
}

// DefaultShutdownTimeout bounds how long Shutdown waits for in-flight
// background work.
const DefaultShutdownTimeout = 10 * time.Second
