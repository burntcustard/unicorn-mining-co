package main

import (
	"context"
	"errors"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"io"
	"net"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type maintenanceServer struct {
	databasePath string
	startGame    func() error
	stopGame     func(context.Context) error
	mutex        sync.Mutex
	closing      atomic.Bool
	running      bool
	canReset     bool
	archived     bool
	http         *http.Server
}

// serve exposes maintenance only through a private filesystem socket. The
// running control service must not be replaced, even if its game is stopped.
func (s *maintenanceServer) serve() error {
	path := s.databasePath + ".control.sock"
	info, err := os.Lstat(path)

	if err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return fmt.Errorf("maintenance socket path is occupied by a non-socket file: %s", path)
		}

		connection, err := net.DialTimeout("unix", path, time.Second)

		if err == nil {
			connection.Close()
			return fmt.Errorf("a live maintenance service already owns %s", path)
		}

		if !errors.Is(err, syscall.ECONNREFUSED) && !os.IsNotExist(err) {
			return err
		}

		if err := os.Remove(path); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}

	listener, err := net.Listen("unix", path)

	if err != nil {
		return err
	}

	if err := os.Chmod(path, 0600); err != nil {
		listener.Close()
		return err
	}

	s.http = &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(s.handle)}

	go func() { _ = s.http.Serve(listener) }()

	return nil
}

func (s *maintenanceServer) handle(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/reset-world" && r.URL.Path != "/resume-world" {
		http.NotFound(w, r)
		return
	}

	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "Use POST for maintenance", http.StatusMethodNotAllowed)
		return
	}

	if !s.mutex.TryLock() {
		http.Error(w, "Another maintenance command is in progress", http.StatusConflict)
		return
	}

	defer s.mutex.Unlock()

	if s.closing.Load() {
		http.Error(w, "Server is shutting down", http.StatusServiceUnavailable)
		return
	}

	fail := func(err error) {
		http.Error(w, fmt.Sprintf("Maintenance failed: %v. The Machine remains running; fix the error and use --resume-world-live to resume without another reset.", err), http.StatusInternalServerError)
	}

	archive := ""

	if r.URL.Path == "/reset-world" {
		if !s.running && !s.canReset {
			http.Error(w, "The game is stopped after failed maintenance; use --resume-world-live first", http.StatusConflict)
			return
		}

		s.canReset, s.archived = false, false

		if s.running {
			s.running = false
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			err := s.stopGame(ctx)
			cancel()

			if err != nil {
				fail(fmt.Errorf("game shutdown did not flush successfully; database was not archived: %w", err))
				return
			}
		}

		if s.closing.Load() {
			http.Error(w, "Server is shutting down", http.StatusServiceUnavailable)
			return
		}

		// Release the old world before allocating its replacement on the same VM.
		runtime.GC()
		var err error
		archive, err = persistence.Reset(s.databasePath)

		if err != nil {
			fail(err)
			return
		}

		s.archived = true
	}

	if !s.running {
		// A failed archive must not silently resume against an empty database.
		if !s.archived {
			if _, err := os.Stat(s.databasePath); err != nil {
				fail(fmt.Errorf("original database must exist before resuming: %w", err))
				return
			}
		}

		if s.closing.Load() {
			http.Error(w, "Server is shutting down", http.StatusServiceUnavailable)
			return
		}

		if err := s.startGame(); err != nil {
			fail(err)
			return
		}

		s.running = true
	}

	if archive != "" {
		fmt.Fprintf(w, "World reset complete; previous database archived in %s\n", archive)
	} else {
		fmt.Fprintln(w, "Game running; no world reset was run.")
	}
}

func (s *maintenanceServer) close(ctx context.Context) error {
	s.closing.Store(true)
	err := s.http.Close()
	s.mutex.Lock()
	defer s.mutex.Unlock()

	if s.running {
		s.running = false
		err = errors.Join(err, s.stopGame(ctx))
	}

	return err
}

// requestMaintenance controls the running server without stopping its Machine
// or exposing a reset endpoint on the public HTTP listener.
func requestMaintenance(databasePath, action string) error {
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", databasePath+".control.sock")
	}}

	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 20 * time.Second}
	response, err := client.Post("http://maintenance/"+action, "text/plain", nil)

	if err != nil {
		return fmt.Errorf("cannot contact the running game; do not retry a reset automatically after a timeout: %w", err)
	}

	defer response.Body.Close()
	message, err := io.ReadAll(io.LimitReader(response.Body, 65536))

	if err != nil {
		return err
	}

	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("%s", strings.TrimSpace(string(message)))
	}

	_, err = os.Stdout.Write(message)
	return err
}
