package network

import (
	"slices"
	"testing"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestMenuPreparationWaitsForPlay(t *testing.T) {
	t.Parallel()

	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	clock := time.Unix(100000, 0)

	s.now = func() time.Time { return clock }

	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "prepare"}, socket)
	p := s.playersBySocket[socket]
	position, fuel := p.ship.Position, p.ship.Fuel

	if socket.packets != 1 || s.World.Players.Has(p.playerID) || s.World.Entities.Has(p.shipID) || len(s.positions()) != 0 {
		t.Fatal("preparation must send only welcome and leave the ship outside the world")
	}

	observerSocket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, observerSocket)
	observer := s.playersBySocket[observerSocket]

	for _, message := range []protocol.Control{
		{Type: "input", Sequence: 1, Input: protocol.Input{Thrust: 1, Launch: true}},
		{Type: "respawn"},
		{Type: "dock", Dock: protocol.DockAction{Action: "refuel"}},
	} {
		s.Receive(message, socket)
	}

	clock = clock.Add(4 * time.Minute)
	s.Tick(30)
	s.accountTime(p)

	if socket.packets != 1 || p.ship.Position != position || p.ship.Fuel != fuel || p.profile.PlayedFor != 0 || !p.playedAt.IsZero() || slices.Contains(observer.binaryReplication.entityIDs, uint64(p.shipID)) {
		t.Fatal("waiting in the menu must not simulate, replicate, or count playtime")
	}

	s.Receive(protocol.Control{Type: "play"}, socket)

	if !s.World.Players.Has(p.playerID) || !s.World.Entities.Has(p.shipID) || socket.packets != 2 || p.hiddenShip {
		t.Fatal("Play must insert the prepared ship and send its initial load")
	}

	s.Receive(protocol.Control{Type: "snapshotAck", Sequence: observerSocket.sequence}, observerSocket)
	s.Tick(1)

	if !slices.Contains(observer.binaryReplication.entityIDs, uint64(p.shipID)) {
		t.Fatal("other players must see the ship after Play")
	}

	packets := socket.packets
	s.Receive(protocol.Control{Type: "play"}, socket)

	if socket.packets != packets {
		t.Fatal("repeated Play must not respawn or resend the initial load")
	}

	clock = clock.Add(time.Minute)
	s.Disconnect(socket)

	if p.profile.PlayedFor != 60 {
		t.Fatalf("playtime includes menu time: %g", p.profile.PlayedFor)
	}
}

func TestReturningPilotStaysHiddenUntilPlay(t *testing.T) {
	t.Parallel()

	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	ship := p.ship
	s.Disconnect(socket)

	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "prepare", PlayerToken: p.profile.ID}, socket)

	if s.World.Entities.Has(p.shipID) || s.World.Players.Has(p.playerID) || p.ship != ship {
		t.Fatal("preparing a returning pilot must retain the saved ship outside the world")
	}

	s.Disconnect(socket)
	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "prepare", PlayerToken: p.profile.ID}, socket)
	s.Receive(protocol.Control{Type: "play"}, socket)

	if !s.World.Entities.Has(p.shipID) || p.ship != ship {
		t.Fatal("Play after a menu reconnect must reuse the saved ship")
	}
}
