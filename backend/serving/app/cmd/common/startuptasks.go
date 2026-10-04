package common

import (
	"context"
	"fmt"
	"log"
	"strings"

	"lib/pg"

	"serving/app/cmd/auth"
	"serving/app/cmd/chats"
	"serving/app/cmd/notifications"
	"serving/app/cmd/planes"
	"serving/app/cmd/push"
	"serving/app/cmd/sideeffects"
	"serving/app/cmd/status"
	"serving/app/pkg/r2storage"
	"serving/app/pkg/realtime"
	"serving/config"
)

func RunStartupTasks() error {
	ctx := context.Background()
	db, err := pg.Open(ctx, config.GetDatabaseURL())
	if err != nil {
		return fmt.Errorf("database: %w", err)
	}
	tokens := auth.NewTokenService(
		config.GetJWTSecret(),
		config.GetAccessTokenTTL(),
		config.GetRefreshTokenTTL(),
	)
	authSvc := auth.NewService(db.SQL(), tokens, config.GetGoogleClientIDs())
	statusSvc := status.NewService(db.SQL())
	hub := realtime.NewHub()
	notificationsSvc := notifications.NewService(db.SQL(), hub)

	var r2Client *r2storage.Client
	r2Cfg := config.GetR2()
	if r2Cfg.Enabled() {
		client, err := r2storage.New(r2storage.Config{
			AccountID:       r2Cfg.AccountID,
			AccessKeyID:     r2Cfg.AccessKeyID,
			SecretAccessKey: r2Cfg.SecretAccessKey,
			Bucket:          r2Cfg.Bucket,
			PublicBaseURL:   r2Cfg.PublicBaseURL,
		})
		if err != nil {
			return fmt.Errorf("r2: %w", err)
		}
		r2Client = client
		log.Printf("r2 media storage enabled (bucket=%s)", r2Cfg.Bucket)
	} else {
		log.Printf("r2 media storage disabled (missing r2 config)")
	}

	pusher := newPusher(db)

	chatsSvc := chats.NewService(db.SQL(), hub, notificationsSvc, r2Client, pusher)
	planesSvc := planes.NewService(db.SQL())
	planesSvc.SetEventSink(sideeffects.NewPlaneSink(notificationsSvc, chatsSvc, hub, pusher))
	planesSvc.SetRealtime(hub)
	planesSvc.Start(ctx) // async plane dispatcher + sweeper

	SetRuntime(db, tokens, authSvc, statusSvc, planesSvc, chatsSvc, notificationsSvc, hub, r2Client)
	return nil
}

// newPusher returns an FCM pusher when push.fcm_service_account_file (or
// FCM_SERVICE_ACCOUNT_FILE) is set, else push.Noop. A broken push config
// is logged but never blocks server startup.
func newPusher(db *pg.DB) push.Pusher {
	cfg := config.GetPush()
	path := strings.TrimSpace(cfg.FCMServiceAccountFile)
	if path == "" {
		log.Printf("push notifications disabled (push.fcm_service_account_file not set)")
		return push.Noop{}
	}
	fcm, err := push.NewFCMFromFile(path, cfg.FCMProjectID, db.SQL())
	if err != nil {
		log.Printf("push notifications disabled: %v", err)
		return push.Noop{}
	}
	log.Printf("push notifications enabled (fcm project=%s)", fcm.ProjectID())
	return fcm
}
