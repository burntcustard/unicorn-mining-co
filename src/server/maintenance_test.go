package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func maintenanceFixture(t *testing.T) *maintenanceServer {
	t.Helper()
	path := filepath.Join(t.TempDir(), "world.sqlite")

	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.WriteFile(path+suffix, []byte("old progress"), 0600); err != nil {
			t.Fatal(err)
		}
	}

	return &maintenanceServer{
		databasePath: path,
		running:      true,
		stopGame:     func(context.Context) error { return nil },
		startGame:    func() error { return os.WriteFile(path, []byte("fresh world"), 0600) },
	}
}

func maintenanceRequest(s *maintenanceServer, action string) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	s.handle(response, httptest.NewRequest(http.MethodPost, "/"+action, nil))
	return response
}

func TestLiveResetArchivesOnlyAfterFlushAndResumesWithoutAnotherReset(t *testing.T) {
	s := maintenanceFixture(t)

	s.stopGame = func(ctx context.Context) error {
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}

		return os.WriteFile(s.databasePath, []byte("flushed progress"), 0600)
	}

	response := maintenanceRequest(s, "reset-world")

	if response.Code != http.StatusOK || !s.running {
		t.Fatal(response.Code, response.Body.String())
	}

	archives, err := filepath.Glob(s.databasePath + ".reset-*")

	if err != nil || len(archives) != 1 {
		t.Fatal(archives, err)
	}

	for _, suffix := range []string{"", "-wal", "-shm"} {
		data, err := os.ReadFile(filepath.Join(archives[0], "world.sqlite"+suffix))
		expected := "old progress"

		if suffix == "" {
			expected = "flushed progress"
		}

		if err != nil || string(data) != expected {
			t.Fatal("archive lost flushed database or sidecars", err)
		}
	}

	response = maintenanceRequest(s, "resume-world")

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "no world reset") {
		t.Fatal(response.Code, response.Body.String())
	}

	remaining, _ := filepath.Glob(s.databasePath + ".reset-*")

	if len(remaining) != 1 {
		t.Fatal("resume archived another world", remaining)
	}
}

func TestLiveResetRefusesFailedShutdown(t *testing.T) {
	s := maintenanceFixture(t)

	s.stopGame = func(context.Context) error { return errors.New("disk write failed") }

	response := maintenanceRequest(s, "reset-world")

	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "not archived") {
		t.Fatal(response.Code, response.Body.String())
	}

	if archives, _ := filepath.Glob(s.databasePath + ".reset-*"); len(archives) != 0 {
		t.Fatal("failed flush must preserve the original database")
	}

	if data, err := os.ReadFile(s.databasePath); err != nil || string(data) != "old progress" {
		t.Fatal("failed flush changed the database", err)
	}

	if response = maintenanceRequest(s, "reset-world"); response.Code != http.StatusConflict {
		t.Fatal("failed maintenance cannot repeat a reset without resuming", response.Code)
	}

	if response = maintenanceRequest(s, "resume-world"); response.Code != http.StatusOK {
		t.Fatal(response.Code, response.Body.String())
	}
}

func TestLiveResetKeepsControlAvailableAfterRestartFailure(t *testing.T) {
	s := maintenanceFixture(t)

	s.startGame = func() error { return errors.New("port unavailable") }

	response := maintenanceRequest(s, "reset-world")

	if response.Code != http.StatusInternalServerError || s.running {
		t.Fatal(response.Code, response.Body.String())
	}

	archives, _ := filepath.Glob(s.databasePath + ".reset-*")

	if len(archives) != 1 {
		t.Fatal("old world must remain archived", archives)
	}

	s.startGame = func() error { return os.WriteFile(s.databasePath, []byte("fresh world"), 0600) }

	response = maintenanceRequest(s, "resume-world")

	if response.Code != http.StatusOK || !s.running {
		t.Fatal(response.Code, response.Body.String())
	}

	archives, _ = filepath.Glob(s.databasePath + ".reset-*")

	if len(archives) != 1 {
		t.Fatal("recovery must not repeat the reset", archives)
	}
}

func TestLiveResetRefusesArchiveWhileAnotherOwnerHoldsDatabaseLock(t *testing.T) {
	s := maintenanceFixture(t)
	lock, err := os.OpenFile(s.databasePath+".lock", os.O_CREATE|os.O_RDWR, 0600)

	if err != nil {
		t.Fatal(err)
	}

	defer lock.Close()

	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}

	response := maintenanceRequest(s, "reset-world")

	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "stop the game server") {
		t.Fatal(response.Code, response.Body.String())
	}

	if data, err := os.ReadFile(s.databasePath); err != nil || string(data) != "old progress" {
		t.Fatal("failed archive changed the database", err)
	}

	if archives, _ := filepath.Glob(s.databasePath + ".reset-*"); len(archives) != 0 {
		t.Fatal("archive ran before the database lock was released")
	}
}

func TestLiveMaintenanceRejectsConcurrentCommands(t *testing.T) {
	s := maintenanceFixture(t)

	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})

	s.stopGame = func(context.Context) error {
		close(entered)
		<-release
		return nil
	}

	go func() {
		defer close(finished)
		maintenanceRequest(s, "reset-world")
	}()

	<-entered
	response := maintenanceRequest(s, "reset-world")
	close(release)
	<-finished

	if response.Code != http.StatusConflict {
		t.Fatal("concurrent reset must not be queued and replayed", response.Code)
	}

	if archives, _ := filepath.Glob(s.databasePath + ".reset-*"); len(archives) != 1 {
		t.Fatal("concurrent request created another archive", archives)
	}
}

func TestLiveMaintenanceRefusesMissingUnarchivedDatabase(t *testing.T) {
	s := maintenanceFixture(t)
	s.running = false

	if err := os.Remove(s.databasePath); err != nil {
		t.Fatal(err)
	}

	response := maintenanceRequest(s, "resume-world")

	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), "original database must exist") {
		t.Fatal(response.Code, response.Body.String())
	}
}

func TestShutdownDuringLiveResetDoesNotArchiveOrRestart(t *testing.T) {
	s := maintenanceFixture(t)

	s.stopGame = func(context.Context) error { s.closing.Store(true); return nil }

	response := maintenanceRequest(s, "reset-world")

	if response.Code != http.StatusServiceUnavailable {
		t.Fatal(response.Code, response.Body.String())
	}

	if archives, _ := filepath.Glob(s.databasePath + ".reset-*"); len(archives) != 0 {
		t.Fatal("shutdown must interrupt maintenance before archiving")
	}

	if data, err := os.ReadFile(s.databasePath); err != nil || string(data) != "old progress" {
		t.Fatal("shutdown changed the saved world", err)
	}
}

func TestAcceptedLiveResetFinishesAfterCallerDisconnects(t *testing.T) {
	s := maintenanceFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	s.stopGame = func(flushContext context.Context) error {
		cancel()
		return flushContext.Err()
	}

	response := httptest.NewRecorder()
	s.handle(response, httptest.NewRequest(http.MethodPost, "/reset-world", nil).WithContext(ctx))

	if response.Code != http.StatusOK || !s.running {
		t.Fatal("client disconnect must not interrupt an accepted reset halfway through", response.Code, response.Body.String())
	}
}

func TestInitialLoadFailureAllowsExplicitResetWithoutStoppingAnUnstartedGame(t *testing.T) {
	s := maintenanceFixture(t)
	s.running, s.canReset = false, true

	s.stopGame = func(context.Context) error {
		t.Fatal("an unstarted game has no pending saves to flush")
		return nil
	}

	response := maintenanceRequest(s, "reset-world")

	if response.Code != http.StatusOK || !s.running {
		t.Fatal(response.Code, response.Body.String())
	}

	archives, _ := filepath.Glob(s.databasePath + ".reset-*")

	if len(archives) != 1 {
		t.Fatal("the incompatible world must be archived before startup", archives)
	}

	if data, err := os.ReadFile(filepath.Join(archives[0], "world.sqlite")); err != nil || string(data) != "old progress" {
		t.Fatal("initial load failure must not alter archived progress", err)
	}
}
