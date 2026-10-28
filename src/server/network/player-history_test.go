package network

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func assertTickPlayerOrder(t *testing.T, s *GameSession) {
	t.Helper()
	var expected []tickPlayer

	s.players.ForEach(func(p *playerRecord, token string) {
		if p.socket != nil || !p.hiddenShip {
			expected = append(expected, tickPlayer{player: p, token: token})
		}
	})

	s.beginTickPlayers()
	defer s.endTickPlayers()

	if !slices.Equal(s.tickPlayers, expected) {
		t.Fatal("tick roster changed membership or saved-profile iteration order")
	}
}

func TestPlayerHistoryRosterLifecycle(t *testing.T) {
	t.Parallel()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	s := NewGameSession(25, catalog)
	clock := time.Unix(100000, 0)

	s.now = func() time.Time { return clock }

	first, menu, departing, dormant := &benchmarkSocket{}, &benchmarkSocket{}, &benchmarkSocket{}, &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, first)
	s.Receive(protocol.Control{Type: "prepare"}, menu)
	s.Receive(protocol.Control{Type: "hello"}, departing)
	s.Receive(protocol.Control{Type: "prepare"}, dormant)
	p := s.playersBySocket[first]
	s.Disconnect(dormant)
	assertTickPlayerOrder(t, s)
	s.Disconnect(first)
	s.Disconnect(menu)
	s.Disconnect(departing)
	assertTickPlayerOrder(t, s)

	// Reconnect the earliest profile after later profiles already entered the roster.
	replacement := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "prepare", PlayerToken: p.profile.ID}, replacement)
	assertTickPlayerOrder(t, s)
	s.Disconnect(first)
	assertTickPlayerOrder(t, s)

	// Replacing an authenticated connection must leave exactly one roster entry.
	newest := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: p.profile.ID}, newest)
	assertTickPlayerOrder(t, s)
	s.Disconnect(replacement)
	assertTickPlayerOrder(t, s)
	portal := s.sectors[s.currentSector].portals[0]
	s.relocatePlayer(p, portal.DestinationSector, sectorArrival{})
	assertTickPlayerOrder(t, s)
	clock = clock.Add(time.Duration(catalog.Simulation.Flight.LaunchDuration*float64(time.Second)) + time.Millisecond)
	s.Tick(1)
	assertTickPlayerOrder(t, s)
}

func TestPlayerHistoryRosterIsStableDuringTick(t *testing.T) {
	t.Parallel()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	s := NewGameSession(25, catalog)
	a, b := &benchmarkSocket{}, &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "prepare"}, a)
	s.Receive(protocol.Control{Type: "prepare"}, b)
	s.beginTickPlayers()
	before := slices.Clone(s.tickPlayers)
	s.Disconnect(a)

	if !slices.Equal(s.tickPlayers, before) {
		t.Fatal("a lifecycle update changed the current tick's stable roster")
	}

	s.endTickPlayers()
	assertTickPlayerOrder(t, s)
}

func TestPlayerHistoryProgressAfterRestore(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	token := p.profile.ID
	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	p, _ = s.players.Get(token)
	p.profile.UnlockedPaints &^= 1 | 1<<3
	red := "RED"

	s.progress([]protocol.SimulationEvent{
		protocol.ItemCollected{By: p.playerID, Unlock: &red},
		protocol.Docked{PlayerID: p.playerID, DockedTo: 101},
		protocol.Docked{PlayerID: p.playerID, DockedTo: 102},
		protocol.Docked{PlayerID: p.playerID, DockedTo: 103},
	})

	if p.profile.UnlockedPaints&(1|1<<3) != 1|1<<3 || !slices.Equal(p.profile.Visited, []int64{101, 102, 103}) {
		t.Fatal("restored offline profile did not receive its own progression")
	}

	if _, pending := s.persistence.players[p]; !pending {
		t.Fatal("restored profile progression was not queued for persistence")
	}

	assertTickPlayerOrder(t, s)
}

func TestExpiredPlayerHistoryDoesNotReceiveProgress(t *testing.T) {
	t.Parallel()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	s := NewGameSession(25, catalog)
	clock := time.Unix(100000, 0)

	s.now = func() time.Time { return clock }

	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	s.Disconnect(socket)
	clock = clock.Add(31 * time.Minute)
	s.Tick(1)

	if s.players.Has(p.profile.ID) {
		t.Fatal("nonpersistent profile did not expire")
	}

	s.progress([]protocol.SimulationEvent{protocol.Docked{PlayerID: p.playerID, DockedTo: 101}})

	if len(p.profile.Visited) != 0 {
		t.Fatal("expired profile remained reachable by its former player ID")
	}

	assertTickPlayerOrder(t, s)
}

func BenchmarkPlayerHistory(b *testing.B) {
	catalog, err := specs.Load()

	if err != nil {
		b.Fatal(err)
	}

	for _, workload := range []string{"roster", "collections", "ticks"} {
		for _, history := range []int{0, 2500, 10000} {
			b.Run(fmt.Sprintf("%s/%d", workload, history), func(b *testing.B) {
				s := NewGameSession(25, catalog)
				sockets := make([]*benchmarkSocket, 16)
				var events []protocol.SimulationEvent

				for i := range sockets {
					sockets[i] = &benchmarkSocket{}
					s.Receive(protocol.Control{Type: "hello"}, sockets[i])
					p := s.playersBySocket[sockets[i]]
					events = append(events, protocol.ItemCollected{By: p.playerID})
				}

				// Share an inert ship to isolate profile-count traversal from geometry
				// and GC costs. The benchmark also compiles against the prior source.
				for i := range history {
					token := fmt.Sprint(i)
					p := &playerRecord{sectorID: s.currentSector, playerID: -int64(i + 1), hiddenShip: true, ship: s.playersBySocket[sockets[0]].ship}
					p.profile.ID = token
					s.players.Set(token, p)
				}

				if workload == "collections" {
					s.beginTickPlayers()
					defer s.endTickPlayers()
				}

				b.ReportAllocs()
				b.ResetTimer()

				for range b.N {
					switch workload {
					case "roster":
						s.beginTickPlayers()
						s.endTickPlayers()
					case "collections":
						s.progress(events)
					case "ticks":
						for _, socket := range sockets {
							s.Receive(protocol.Control{Type: "snapshotAck", Sequence: socket.sequence}, socket)
						}

						s.Tick(1)
					}
				}
			})
		}
	}
}
