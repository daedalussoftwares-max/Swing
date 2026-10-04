package main

import (
	"os"
	"os/signal"
	"syscall"

	"serving/app/cmd/common"
	"serving/app/pkg/logx"
	"serving/config"
	"serving/web"
)

func startWeb() {
	webShutDown := make(chan bool, 1)

	go func() {
		sig := make(chan os.Signal, 2)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		s := <-sig
		logx.Info("shutdown: signal received; draining (send again to force exit)", "signal", s.String())
		go func() {
			<-sig
			logx.Warn("shutdown: second signal, exiting immediately")
			os.Exit(1)
		}()
		web.ShutDown() // stop accepting HTTP, finish in-flight requests
		common.Shutdown(common.DefaultShutdownTimeout)
		logx.Info("shutdown: complete")
		webShutDown <- true
	}()

	if err := common.RunStartupTasks(); err != nil {
		logx.Error("startup tasks failed", err)
		panic(err)
	}
	web.Start()
	<-webShutDown
}

func main() {
	config.Init()
	logx.Init(config.IsDev())
	startWeb()
}
