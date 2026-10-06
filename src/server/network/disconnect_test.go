package network

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"slices"
	"testing"
	"time"
)

func TestDisconnectedShipCooldown(t *testing.T) {
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
				t.Fatal("cooldown did not remove the offline ship or was not cancelled by reconnect")
			}

			if !reconnectEarly {
				// Hidden ships must stay outside region loading and simulation.
				s.regions.Sync(s.World, s.positions())
				s.Tick(1)

				if s.World.Entities.Has(p.shipID) || s.regions.sleeping.Has(p.shipID) {
					t.Fatal("offline ship reappeared through region loading")
				}

				socket = &benchmarkSocket{}
				s.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)
			}

			if s.playersBySocket[socket].ship != ship || !s.World.Entities.Has(p.shipID) || !ship.ModuleActive("searchLight") || !ship.ModuleActive("cargoHatch") {
				t.Fatal("reconnect must restore the same ship and module state")
			}
		})
	}
}

func TestDisconnectedDeadShipDoesNotReappear(t *testing.T) {
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
