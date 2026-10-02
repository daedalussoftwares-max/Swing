package common

import (
	"lib/pg"

	"serving/app/cmd/auth"
	"serving/app/cmd/planes"
	"serving/app/cmd/status"
	"serving/app/pkg/r2storage"
)

var (
	DB     *pg.DB
	Tokens *auth.TokenService
	Auth   *auth.Service
	Status *status.Service
	Planes *planes.Service
	R2     *r2storage.Client
)

func SetRuntime(
	db *pg.DB,
	tokens *auth.TokenService,
	authSvc *auth.Service,
	statusSvc *status.Service,
	planesSvc *planes.Service,
	r2 *r2storage.Client,
) {
	DB = db
	Tokens = tokens
	Auth = authSvc
	Status = statusSvc
	Planes = planesSvc
	R2 = r2
}

func Close() {
	if DB != nil {
		_ = DB.Close()
	}
}
