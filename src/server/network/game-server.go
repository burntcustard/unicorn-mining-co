// Port of src/server/game-server.ts. Socket readers enqueue messages; the
// owner goroutine alone calls GameSession and changes the world.
package network

import (
	"context"
	"errors"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type socketEvent struct {
	socket    *WebSocket
	message   protocol.Control
	connected bool
}

type GameServer struct {
	stopContext context.Context
	shutdownErr error
	session     *GameSession
	http        *http.Server
	events      chan socketEvent
	wake        chan struct{}
	done        chan struct{}
	stopped     chan struct{}
	once        sync.Once
	clients     atomic.Int32
	catalog     specs.Catalog
}

func NewGameServer(seed float64, catalog specs.Catalog) *GameServer {
	return &GameServer{session: NewGameSession(seed, catalog), events: make(chan socketEvent, 256), wake: make(chan struct{}, 1), done: make(chan struct{}), stopped: make(chan struct{}), catalog: catalog}
}

func (s *GameServer) EnablePersistence(store *persistence.Store) error {
	return s.session.EnablePersistence(store)
}

func (s *GameServer) Start(port int, assets string, production bool) (net.Listener, error) {
	listener, err := net.Listen("tcp", "0.0.0.0:"+strconv.Itoa(port))

	if err != nil {
		return nil, err
	}

	ordinary := HandleHTTP(assets)

	s.http = &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" && s.session.persistence != nil && s.session.persistence.store.Err() != nil {
			http.Error(w, "Storage unavailable", http.StatusServiceUnavailable)
			return
		}

		if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			ordinary.ServeHTTP(w, r)
			return
		}

		if s.clients.Add(1) > 40 {
			s.clients.Add(-1)
			http.Error(w, "Server full", http.StatusServiceUnavailable)
			return
		}

		socket, err := Upgrade(w, r, production)

		if err != nil {
			s.clients.Add(-1)
			return
		}

		if !s.enqueue(socketEvent{socket: socket, connected: true}) {
			socket.Terminate()
			s.clients.Add(-1)
			return
		}

		go s.read(socket)
	})}

	go s.run()

	go func() { _ = s.http.Serve(listener) }()

	return listener, nil
}

func (s *GameServer) enqueue(event socketEvent) bool {
	select {
	case s.events <- event:
	case <-s.done:
		return false
	}

	if event.message.Type != "input" && event.message.Type != "snapshotAck" {
		select {
		case s.wake <- struct{}{}:
		default:
		}
	}

	return true
}

func (s *GameServer) read(socket *WebSocket) {
	defer func() {
		if socket.closing.Load() {
			<-socket.Done()
		}

		socket.Terminate()
		s.enqueue(socketEvent{socket: socket})
		s.clients.Add(-1)
	}()

	timeout := time.AfterFunc(10*time.Second, func() { socket.CloseWith(1008, "Hello timeout") })

	defer timeout.Stop()
	greeted := false
	messages := 0
	window := time.Now()
	var buffer []byte

	for {
		kind, data, err := socket.ReadMessageInto(buffer)

		if err != nil {
			return
		}

		buffer = data
		now := time.Now()

		if now.Sub(window) >= time.Second {
			window = now
			messages = 0
		}

		messages++

		if kind != OpBinary || messages > 120 {
			socket.CloseWith(1008, "Message limit")
			return
		}

		message, err := protocol.DecodeClientControl(data, s.catalog.Protocol, s.catalog.Simulation.SimulationStep)

		if err != nil {
			socket.CloseWith(1007, "Invalid message")
			return
		}

		if message.Type == "hello" {
			if greeted {
				socket.CloseWith(1008, "Already joined")
				return
			}

			greeted = true
			timeout.Stop()
		}

		if !s.enqueue(socketEvent{socket: socket, message: message}) {
			return
		}
	}
}

func (s *GameServer) run() {
	defer close(s.stopped)
	sockets := map[*WebSocket]time.Time{}
	period := time.Duration(s.catalog.Simulation.SimulationStep * float64(time.Second))
	next := time.Now().Add(period)
	timer := time.NewTimer(period)
	defer timer.Stop()
	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	/*
	 * Inputs and receipts affect the next tick. Drain the same ordered inbox
	 * before that tick, or immediately when a connection/control event wakes us.
	 * The queue capacity bounds each drain so a busy reader cannot starve ticks.
	 */
	drain := func() {
		for range cap(s.events) {
			select {
			case event := <-s.events:
				if event.connected {
					sockets[event.socket] = time.Time{}
				} else if event.message.Type != "" {
					s.session.Receive(event.message, event.socket)
				} else {
					delete(sockets, event.socket)
					s.session.Disconnect(event.socket)
				}
			default:
				return
			}
		}
	}

	for {
		select {
		case <-s.done:
			for socket := range sockets {
				s.session.Disconnect(socket)
				socket.Terminate()
			}

			if s.session.persistence != nil {
				s.shutdownErr = errors.Join(s.session.shutdownPersistence(s.stopContext), s.session.persistence.store.Close(s.stopContext))
			}

			return
		case <-s.wake:
			drain()
		case now := <-heartbeat.C:
			for socket, last := range sockets {
				if !last.IsZero() && socket.LastPong().Before(last) {
					socket.Terminate()
				} else {
					sockets[socket] = now

					if socket.Ping() != nil {
						socket.Terminate()
					}
				}
			}
		case <-timer.C:
			drain()
			ticks := min(s.catalog.Simulation.MaxCatchUpTicks, max(1, int(time.Since(next)/period)+1))
			s.session.Tick(uint64(ticks))
			next = next.Add(time.Duration(ticks) * period)
			timer.Reset(max(time.Millisecond, time.Until(next)))
		}
	}
}

func (s *GameServer) Stop(ctx context.Context) error {
	s.once.Do(func() { s.stopContext = ctx; close(s.done) })

	if s.http == nil {
		return nil
	}

	err := s.http.Shutdown(ctx)
	<-s.stopped
	return errors.Join(err, s.shutdownErr)
}
