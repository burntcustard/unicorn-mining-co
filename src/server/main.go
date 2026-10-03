package main

import (
	"context"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/network"
	"log"
	"os"
	"os/signal"
	"runtime/debug"
	"strconv"
	"syscall"
	"time"
)

func main() {
	if _, configured := os.LookupEnv("GOGC"); !configured {
		debug.SetGCPercent(800)
	}

	catalog, err := definitions.Load()

	if err != nil {
		log.Fatal(err)
	}

	port := 3001

	if value := os.Getenv("PORT"); value != "" {
		port, err = strconv.Atoi(value)

		if err != nil {
			log.Fatal(err)
		}
	}

	assets := os.Getenv("ASSET_DIR")

	if assets == "" {
		assets = "dist"
	}

	seed := 25.0

	if value := os.Getenv("WORLD_SEED"); value != "" {
		seed, err = strconv.ParseFloat(value, 64)

		if err != nil {
			log.Fatal(err)
		}
	}

	game := network.NewGameServer(seed, catalog)
	listener, err := game.Start(port, assets, os.Getenv("APP_ENV") == "production" || os.Getenv("NODE_ENV") == "production")

	if err != nil {
		log.Fatal(err)
	}

	log.Printf("Go server listening on %s", listener.Addr())
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, os.Interrupt, syscall.SIGTERM)
	<-stopped
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := game.Stop(ctx); err != nil {
		log.Print(err)
	}
}
