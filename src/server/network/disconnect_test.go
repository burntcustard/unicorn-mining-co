package network

import (
	"context"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"
)

func TestDisconnectedShipCooldown(t *testing.T) {
	t.Parallel()

	for _, reconnectEarly := range []bool{false, true} {
		t.Run(map[bool]string{false: "expires", true: "reconnect-cancels"}[reconnectEarly], func(t *testing.T) {
			catalog, err := specs.Load()

			if err != nil {
				t.Fatal(err)
			}

			s := NewGameSession(25, catalog)
			clock := time.Unix(100000, 0)

			s.now = func() time.Time { return clock }

			socket, observerSocket := &benchmarkSocket{}, &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			p := s.playersBySocket[socket]
			token := p.profile.ID
			ship := p.ship
			ship.Fuel = 3.25
			ship.SetModuleActive("searchLight", true)
			ship.SetModuleActive("cargoHatch", true)
			ship.Velocity = Vec.Create(3, 4)
			ship.Fly(1, 1)
			s.Receive(protocol.Control{Type: "hello"}, observerSocket)
			observer := s.playersBySocket[observerSocket]
			s.Disconnect(socket)

			if !s.World.Entities.Has(p.shipID) || s.World.Players.Has(p.playerID) || p.socket != nil || ship.Forward != 0 || ship.Turn != 0 || ship.Velocity != (Vec.Vector{}) {
				t.Fatal("disconnect must stop flight and retain the ship during its cooldown")
			}

			cooldown := time.Duration(catalog.Simulation.Flight.LaunchDuration * float64(time.Second))
			clock = clock.Add(cooldown - time.Millisecond)
			s.Tick(1)

			if !s.World.Entities.Has(p.shipID) || !slices.Contains(observer.binaryReplication.entityIDs, uint64(p.shipID)) {
				t.Fatal("ship disappeared before the cooldown expired")
			}

			if reconnectEarly {
				socket = &benchmarkSocket{}
				s.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)
			}

			clock = clock.Add(time.Millisecond)
			s.Receive(protocol.Control{Type: "snapshotAck", Sequence: observerSocket.sequence}, observerSocket)
			s.Tick(1)

			if s.World.Entities.Has(p.shipID) != reconnectEarly || slices.Contains(observer.binaryReplication.entityIDs, uint64(p.shipID)) != reconnectEarly || p.hiddenShip == reconnectEarly {
				t.Fatal("cooldown did not remove the offline ship or was not canceled by reconnect")
			}

			if !reconnectEarly {
				// Hidden ships must stay outside region loading and simulation.
				s.regions.Sync(s.World, s.positions())
				s.Tick(1)

				if s.World.Entities.Has(p.shipID) || s.regions.Sleeping.Has(p.shipID) {
					t.Fatal("offline ship reappeared through region loading")
				}

				socket = &benchmarkSocket{}
				s.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)
			}

			if ship.Fuel != 3.25 {
				t.Fatal("fuel changed while disconnected")
			}

			if s.playersBySocket[socket].ship != ship || !s.World.Entities.Has(p.shipID) || !ship.ModuleActive("searchLight") || !ship.ModuleActive("cargoHatch") {
				t.Fatal("reconnect must restore the same ship and module state")
			}
		})
	}
}

func TestDisconnectedDeadShipDoesNotReappear(t *testing.T) {
	t.Parallel()

	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	clock := time.Unix(100000, 0)

	s.now = func() time.Time { return clock }

	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	p.ship.Remove()
	s.Disconnect(socket)
	clock = clock.Add(time.Minute)
	s.Tick(1)
	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: p.profile.ID}, socket)

	if s.World.Entities.Has(p.shipID) || p.hiddenShip || !p.ship.Dead {
		t.Fatal("disconnect cooldown resurrected a destroyed ship")
	}
}

func TestFatalDamageDisconnectStillAllowsRespawn(t *testing.T) {
	t.Parallel()

	for _, disconnectBeforeUpdate := range []bool{false, true} {
		t.Run(map[bool]string{false: "after-update", true: "before-update"}[disconnectBeforeUpdate], func(t *testing.T) {
			catalog, _ := specs.Load()
			s := NewGameSession(25, catalog)
			socket := &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			p := s.playersBySocket[socket]
			previousID := p.shipID

			for _, segment := range p.ship.Segments {
				if segment.Core {
					objects.Damage(segment, 10000)
				}
			}

			if disconnectBeforeUpdate {
				s.Disconnect(socket)
			}

			s.Tick(1)

			if !disconnectBeforeUpdate {
				s.Disconnect(socket)
			}

			socket = &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello", PlayerToken: p.profile.ID}, socket)

			if s.World.Entities.Has(previousID) || !p.ship.Dead || slices.Contains(p.binaryReplication.entityIDs, uint64(previousID)) {
				t.Fatal("reconnect must load the dead state without waiting for another death")
			}

			s.Receive(protocol.Control{Type: "respawn"}, socket)

			if p.shipID == previousID || p.ship.Dead || !s.World.Entities.Has(p.shipID) || !slices.Contains(p.binaryReplication.entityIDs, uint64(p.shipID)) {
				t.Fatal("reconnected dead player cannot respawn")
			}
		})
	}
}

func socketTick(s *GameSession, socket *soundSocket) {
	p := s.playersBySocket[socket]
	s.Receive(protocol.Control{Type: "snapshotAck", Sequence: p.snapshotSequence}, socket)
	s.Tick(1)
}

func TestDockedReconnectWithMinedCargoDoesNotDispatchPirates(t *testing.T) {
	for _, restart := range []bool{false, true} {
		for _, login := range []string{"hello", "prepare"} {
			t.Run(strconv.FormatBool(restart)+"/"+login, func(t *testing.T) {
				var s *GameSession
				var p *playerRecord
				var socket *soundSocket
				var store *persistence.Store
				path := filepath.Join(t.TempDir(), "world.sqlite")

				if restart {
					s, store = persistedSession(t, path)
					socket = &soundSocket{}
					s.Receive(protocol.Control{Type: "hello"}, socket)
					p = s.playersBySocket[socket]
				} else {
					catalog, _ := specs.Load()
					s = NewGameSession(25, catalog)
					socket = &soundSocket{}
					s.Receive(protocol.Control{Type: "hello"}, socket)
					p = s.playersBySocket[socket]
				}

				home := s.nearestStation(p.ship.Position)
				dockedTo := s.regions.IDOffset + int64(home.ID)
				p.ship.Position = home.Position
				p.ship.DockedTo = &dockedTo
				p.ship.CargoContents = nil

				for range 3 {
					id := simulation.EntityID(s.World)
					item := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World, ID: &id}, s.World.Specification)
					item.Mined = true
					p.ship.CargoContents = append(p.ship.CargoContents, item)
				}

				token := p.profile.ID
				s.Disconnect(socket)

				if restart {
					committedSession(t, s)

					if err := store.Close(context.Background()); err != nil {
						t.Fatal(err)
					}

					s, store = persistedSession(t, path)
					defer store.Close(context.Background())
				}

				socket = &soundSocket{}
				s.Receive(protocol.Control{Type: login, PlayerToken: token}, socket)
				p = s.playersBySocket[socket]

				if login == "prepare" {
					for range 31 {
						socketTick(s, socket)
					}

					if len(s.sectors[s.currentSector].pirates.Capture()) != 0 {
						t.Fatal("preparing a docked returning player dispatched a pirate")
					}

					s.Receive(protocol.Control{Type: "play"}, socket)
				}

				for range 90 {
					socketTick(s, socket)
				}

				if p.ship.DockedTo == nil || *p.ship.DockedTo != dockedTo || p.ship.MinedCargoValue() <= s.World.Specification.PirateSpec.CargoValueThreshold || !s.World.Players.Has(p.playerID) {
					t.Fatal("reconnection did not preserve an active docked ship and its valuable mined cargo")
				}

				if len(s.sectors[s.currentSector].pirates.Capture()) != 0 {
					t.Fatal("docked mined cargo dispatched a pirate after reconnection")
				}

				p.ship.Launch()
				s.World.Tick += 30
				s.sectors[s.currentSector].pirates.Dispatch()

				if len(s.sectors[s.currentSector].pirates.Capture()) != 1 {
					t.Fatal("the docked guard permanently disabled later dispatches")
				}
			})
		}
	}
}
