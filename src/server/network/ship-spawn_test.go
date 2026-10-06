package network

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"slices"
	"testing"
)

func TestPlayerSpawnAndRespawnReceiveStarterModules(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]

	checkEquipment := func() {
		t.Helper()
		actual := []string{}

		for _, module := range p.ship.Modules() {
			if module.ModuleBase().Mount == nil {
				t.Fatal("starter module was not fitted")
			}

			actual = append(actual, module.ModuleBase().Type)
		}

		expected := []string{}
		for _, entry := range catalog.ShipSpecs["mustang"].InitialLoadout {
			expected = append(expected, entry.Module)
		}
		slices.Sort(expected)
		slices.Sort(actual)

		if !slices.Equal(actual, expected) {
			t.Fatalf("starter modules: got %v, want %v", actual, expected)
		}
	}

	checkEquipment()
	// Rejoining an existing ship must not grant missing equipment again.
	mount := p.ship.Modules()[0].ModuleBase().Mount
	p.ship.Fit(nil, mount)
	s.Disconnect(socket)
	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: p.profile.ID}, socket)

	if len(p.ship.Modules()) != len(catalog.ShipSpecs["mustang"].InitialLoadout) || mount.Module != nil {
		t.Fatal("reconnecting granted starter equipment again")
	}

	previousID := p.shipID
	p.ship.Remove()
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.shipID == previousID {
		t.Fatal("respawn did not create a new ship")
	}

	checkEquipment()
}

func TestProceduralWrecksStartWithoutModules(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	ranges := protocol.Ranges(catalog.Simulation.WorldRanges)
	ranges.Wreck = catalog.Simulation.PreGeneratedRadius
	view := s.regions.View(Vec.Vector{}, &ranges)

	if len(view.Wrecks) == 0 {
		t.Fatal("no procedural wrecks found")
	}

	d := view.Wrecks[0]
	s.regions.Sync(s.World, []Vec.Vector{d.Position})
	entity, ok := s.World.Entities.Get(int64(d.ID))

	if !ok {
		t.Fatal("wreck was not loaded")
	}

	wreck := entity.(*objects.Ship)

	if len(wreck.Modules()) != 0 || len(wreck.CargoContents) == 0 {
		t.Fatal("procedural wreck must have no fitted modules and retain its salvage")
	}
}

func TestArrowRespawnPreservesShipAndLoadout(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	p.ship.Remove()
	p.ship = objects.CreatePlayerShip(s.World, objects.Properties{DefinitionID: "arrow", PlayerID: &p.playerID})
	p.shipID = p.ship.ID
	s.Receive(protocol.Control{Type: "respawn"}, socket)
	if p.ship.DefinitionID != "arrow" || len(p.ship.Modules()) != 3 {
		t.Fatal("respawn must preserve Arrow and restore its cargo hatches and medium thruster")
	}
	thruster := p.ship.Mounts()[2].Module
	if thruster == nil || thruster.ModuleBase().Type != "thrusterSingleMd" {
		t.Fatal("Arrow must start with its medium thruster")
	}
	for _, index := range []int{0, 4} {
		module := p.ship.Mounts()[index].Module
		if module == nil || module.ModuleBase().Type != "cargoHatch" {
			t.Fatal("respawn must equip both rear cargo hatches")
		}
	}
}
