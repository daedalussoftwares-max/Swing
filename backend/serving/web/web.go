package web

import (
	"context"
	"log"
	"net/http"

	"serving/config"
	"serving/web/routes"
)

var srv *http.Server

func Start() {
	handler := http.NewServeMux()
	routes.Init()
	routes.AddRoutes(handler)

	srv = &http.Server{
		Addr:         config.GetPort(),
		Handler:      handler,
		ReadTimeout:  config.GetServerReadTimeout(),
		WriteTimeout: config.GetServerWriteTimeout(),
	}

	go func() {
		log.Printf("serving listening on http://localhost%s", config.GetPort())
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()
}

// ShutDown stops accepting new connections and waits (up to the server
// write timeout) for in-flight HTTP requests. Hijacked WebSocket
// connections are not tracked by http.Server; common.Shutdown closes them.
func ShutDown() {
	if srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.GetServerWriteTimeout())
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("http shutdown: %v", err)
	}
}
