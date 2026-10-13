package network

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"testing"
)

func TestRefuelAndEmptyTankRespawn(t *testing.T) {
	t.Parallel()

	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]

	if p.ship.Fuel != p.ship.FuelCapacity {
		t.Fatal("new pilot must start full")
	}

	p.ship.Fuel = 0
	p.profile.Credits = 100
	request := protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "refuel"}}
	s.Receive(request, socket)

	if p.ship.Fuel != 0 || p.profile.Credits != 100 {
		t.Fatal("undocked refuel accepted")
	}

	description := s.nearestStation(p.ship.Position)
	p.ship.Position = description.Position
	p.ship.DockedTo = new(int64(description.ID))
	s.regions.View(p.ship.Position, nil)
	p.profile.Credits = 23
	s.Receive(request, socket)

	if p.ship.Fuel != 0 || p.profile.Credits != 23 {
		t.Fatal("unaffordable refuel accepted")
	}

	p.profile.Credits = 24
	s.Receive(request, socket)

	if p.ship.Fuel != p.ship.FuelCapacity || p.profile.Credits != 0 {
		t.Fatal("full refill must cost 24 credits")
	}

	s.Receive(request, socket)

	if p.profile.Credits != 0 {
		t.Fatal("full tank charged twice")
	}

	p.ship.Fuel = 60
	p.profile.Credits = 12
	s.Receive(request, socket)

	if p.ship.Fuel != 120 || p.profile.Credits != 0 {
		t.Fatal("half refill must cost 12 credits")
	}

	old := p.ship
	old.Fuel = 0
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.ship != old {
		t.Fatal("docked ship must refuel, not respawn")
	}

	old.DockedTo = nil
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.ship == old || p.ship.Fuel != p.ship.FuelCapacity || p.ship.DockedTo == nil {
		t.Fatal("empty tank must allow a fully fueled respawn")
	}
}
