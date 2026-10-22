package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/network"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"syscall"
	"time"
)

func main() {
	resetWorld := flag.Bool("reset-world", false, "archive the saved world and player progress, then exit; requires a stopped server")
	resetWorldLive := flag.Bool("reset-world-live", false, "reset the running game through its private maintenance socket; keep the Machine running")
	resumeWorldLive := flag.Bool("resume-world-live", false, "resume the game after failed live maintenance without resetting again")
	backups := flag.Bool("backups", false, "list completed backups, reset archives and volume space, then exit")
	deleteBackup := flag.String("delete-backup", "", "delete one listed backup path, report volume space, then exit")
	deleteAllBackups := flag.Bool("delete-all-backups", false, "delete all completed backups and reset archives, report volume space, then exit")
	flag.Parse()

	flag.Visit(func(option *flag.Flag) {
		if option.Name == "delete-backup" && *deleteBackup == "" {
			log.Fatal("delete-backup requires a nonempty path from the backup listing")
		}
	})

	maintenance := 0

	for _, enabled := range []bool{*resetWorld, *resetWorldLive, *resumeWorldLive, *backups, *deleteBackup != "", *deleteAllBackups} {
		if enabled {
			maintenance++
		}
	}

	if flag.NArg() != 0 || maintenance > 1 {
		log.Fatal("choose one maintenance command without extra arguments")
	}

	if _, configured := os.LookupEnv("GOGC"); !configured {
		debug.SetGCPercent(800)
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

	if *resetWorld {
		archive, err := persistence.Reset(databasePath)

		if err != nil {
			log.Fatal(err)
		}

		log.Printf("World reset; previous database archived in %s", archive)
		return
	}

	if *resetWorldLive || *resumeWorldLive {
		action := "reset-world"

		if *resumeWorldLive {
			action = "resume-world"
		}

		if err := requestMaintenance(databasePath, action); err != nil {
			log.Fatal(err)
		}

		return
	}

	if *backups || *deleteBackup != "" || *deleteAllBackups {
		if err := persistence.ManageBackups(persistence.BackupOptions{
			DatabasePath: databasePath,
			Directory:    backupDirectory,
			DeletePath:   *deleteBackup,
			DeleteAll:    *deleteAllBackups,
			Output:       os.Stdout,
		}); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}

		return
	}

	catalog, err := specs.Load()

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

	var game *network.GameServer
	maintenanceServer := &maintenanceServer{databasePath: databasePath, canReset: true}

	maintenanceServer.startGame = func() error {
		store, err := persistence.Open(databasePath, backupDirectory)

		if err != nil {
			return err
		}

		next := network.NewGameServer(seed, catalog)
		next.LogStats(log.Printf)

		if err := next.EnablePersistence(store); err != nil {
			return errors.Join(err, store.Close(context.Background()))
		}

		listener, err := next.Start(port, assets, production)

		if err != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			return errors.Join(err, store.Close(ctx))
		}

		game = next
		port = listener.Addr().(*net.TCPAddr).Port
		log.Printf("Go server listening on %s", listener.Addr())
		return nil
	}

	maintenanceServer.stopGame = func(ctx context.Context) error {
		previous := game
		game = nil
		return previous.Stop(ctx)
	}

	if err := maintenanceServer.startGame(); err != nil {
		log.Printf("Game unavailable: %v; live maintenance remains available", err)
	} else {
		maintenanceServer.running = true
	}

	if err := maintenanceServer.serve(); err != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()

		if maintenanceServer.running {
			err = errors.Join(err, maintenanceServer.stopGame(ctx))
		}

		log.Fatal(err)
	}

	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, os.Interrupt, syscall.SIGTERM)
	log.Print("World maintenance ready")
	<-stopped
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	if err := maintenanceServer.close(ctx); err != nil {
		log.Print(err)
	}
}
