package common

import (
	"context"
	"fmt"
	"log"

	"lib/pg"

	"serving/app/cmd/auth"
	"serving/app/cmd/planes"
	"serving/app/cmd/status"
	"serving/app/pkg/r2storage"
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
	planesSvc := planes.NewService(db.SQL())

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

	SetRuntime(db, tokens, authSvc, statusSvc, planesSvc, r2Client)
	return nil
}
