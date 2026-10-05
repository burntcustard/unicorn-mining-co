package main

import (
	"context"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/network"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"log"
	"os"
	"os/signal"
	"path/filepath"
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
	production := os.Getenv("APP_ENV") == "production" || os.Getenv("NODE_ENV") == "production"
	databasePath := os.Getenv("DATABASE_PATH")

	if databasePath == "" {
		if production {
			log.Fatal("DATABASE_PATH must point to persistent storage in production")
		}

		databasePath = ".data/world.sqlite"
	}

	backupDirectory := os.Getenv("BACKUP_DIRECTORY")

	if backupDirectory == "" {
		backupDirectory = filepath.Join(filepath.Dir(databasePath), "backups")
	}

	// Fly volumes initially belong to root. Initialize the standard mount, then
	// run the scratch container's server as the previous unprivileged user.
	if production && os.Getuid() == 0 && filepath.Dir(databasePath) == "/data" {
		if err := os.Chown("/data", 65532, 65532); err != nil {
			log.Fatal(err)
		}

		if err := os.Chmod("/data", 0700); err != nil {
			log.Fatal(err)
		}

		if err := syscall.Setgroups(nil); err != nil {
			log.Fatal(err)
		}

		if err := syscall.Setgid(65532); err != nil {
			log.Fatal(err)
		}

		if err := syscall.Setuid(65532); err != nil {
			log.Fatal(err)
		}
	}

	store, err := persistence.Open(databasePath, backupDirectory)

	if err != nil {
		log.Fatal(err)
	}

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

	if err := game.EnablePersistence(store); err != nil {
		log.Fatal(err)
	}

	listener, err := game.Start(port, assets, production)

	if err != nil {
		log.Fatal(err)
	}

	log.Printf("Go server listening on %s", listener.Addr())
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, os.Interrupt, syscall.SIGTERM)
	<-stopped
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	if err := game.Stop(ctx); err != nil {
		log.Print(err)
	}
}
