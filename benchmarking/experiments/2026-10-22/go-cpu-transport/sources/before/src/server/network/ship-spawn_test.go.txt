package network

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"strconv"
	"testing"
)

func TestPlayerSpawnAndRespawnReceiveStarterModules(t *testing.T) {
	t.Parallel()

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
	t.Parallel()

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
	t.Parallel()

	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	p.ship.Remove()
	p.ship = objects.CreatePlayerShip(s.World, objects.Properties{DefinitionID: "arrow", PlayerID: &p.playerID})
	p.shipID = p.ship.ID
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	expected := catalog.ShipSpecs["arrow"].InitialLoadout

	if p.ship.DefinitionID != "arrow" || len(p.ship.Modules()) != len(expected) {
		t.Fatal("respawn must preserve Arrow and restore its starter loadout")
	}

	for _, entry := range expected {
		module := p.ship.Mounts()[entry.Mount].Module

		if module == nil || module.ModuleBase().Type != entry.Module {
			t.Fatalf("respawn must equip %s at mount %d", entry.Module, entry.Mount)
		}
	}
}

func TestCourserReconnectPreservesCannonToggle(t *testing.T) {
	t.Parallel()
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	p.ship.Remove()
	p.ship = objects.CreatePlayerShip(s.World, objects.Properties{DefinitionID: "courser", PlayerID: &p.playerID})
	p.ship.Add()
	p.shipID = p.ship.ID
	p.ship.SetModuleActive("cannonSm", true)
	p.ship.SetModuleActive("cargoHatch", true)
	s.Disconnect(socket)
	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: p.profile.ID}, socket)
	s.Tick(1)

	if p.ship.DefinitionID != "courser" || !p.lastInput.AutogunActive || !p.ship.ModuleActive("cannonSm") || !p.ship.ModuleActive("cargoHatch") {
		t.Fatal("reconnection must preserve Courser's cannon and paired hatch toggles")
	}

	p.ship.Remove()
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	for _, entry := range catalog.ShipSpecs["courser"].InitialLoadout {
		module := p.ship.Mounts()[entry.Mount].Module

		if p.ship.DefinitionID != "courser" || module == nil || module.ModuleBase().Type != entry.Module {
			t.Fatal("respawn must restore Courser and its starter equipment")
		}
	}
}

func TestCoreDestructionAllowsRespawn(t *testing.T) {
	t.Parallel()

	catalog, _ := specs.Load()

	for _, shipType := range []string{"mustang", "arrow", "courser"} {
		coreCount := 0

		for _, plan := range catalog.ShipSpecs[shipType].HullSegments {
			if plan.Core {
				coreCount++
			}
		}

		for index, plan := range catalog.ShipSpecs[shipType].HullSegments {
			if !plan.Core {
				continue
			}

			t.Run(shipType+"/"+strconv.Itoa(index), func(t *testing.T) {
				s := NewGameSession(25, catalog)
				socket := &benchmarkSocket{}
				s.Receive(protocol.Control{Type: "hello"}, socket)
				p := s.playersBySocket[socket]
				p.ship.Remove()
				p.ship = objects.CreatePlayerShip(s.World, objects.Properties{DefinitionID: shipType, PlayerID: &p.playerID})
				p.ship.Add()
				p.shipID = p.ship.ID
				previousID := p.shipID

				for _, segment := range p.ship.Segments {
					if segment.HullPlan == p.ship.HullSegments[index] {
						objects.Damage(segment, 10000)
						break
					}
				}

				s.Tick(1)

				if coreCount > 1 && (p.ship.Dead || !s.World.Entities.Has(previousID)) {
					t.Fatal("a surviving core must keep its ship alive")
				}

				for _, segment := range p.ship.Segments {
					if segment.Hull && segment.Core {
						objects.Damage(segment, 10000)
					}
				}

				s.Tick(1)

				if s.World.Entities.Has(previousID) || !p.ship.Dead {
					t.Fatal("fatal core damage must remove the ship")
				}

				s.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
					object := entity.Base()

					if object.Mass <= 0 || math.IsNaN(object.Position.X) || math.IsNaN(object.Position.Y) || math.IsNaN(object.Rotation) || math.IsInf(object.Position.X, 0) || math.IsInf(object.Position.Y, 0) {
						t.Fatalf("fatal core damage left invalid debris: mass=%v position=%v rotation=%v", object.Mass, object.Position, object.Rotation)
					}
				})

				s.Receive(protocol.Control{Type: "respawn"}, socket)

				if p.shipID == previousID || !s.World.Entities.Has(p.shipID) {
					t.Fatal("fatal core damage must allow respawn")
				}
			})
		}
	}
}

func TestShipDeathWithCargoKeepsPlayersConnected(t *testing.T) {
	t.Parallel()

	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket, observer := &benchmarkSocket{}, &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	s.Receive(protocol.Control{Type: "hello"}, observer)
	p := s.playersBySocket[socket]
	itemID := simulation.EntityID(s.World)
	item := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World, ID: &itemID}, catalog)
	spare := modules.Create("searchLight", simulation.ObjectProperties{World: s.World}, catalog)
	p.ship.CargoContents = append(p.ship.CargoContents, item, spare)

	for _, segment := range p.ship.Segments {
		if segment.Core {
			objects.Damage(segment, 10000)
		}
	}

	s.Tick(1)

	if !p.ship.Dead || s.World.Entities.Has(p.shipID) || len(p.ship.CargoContents) != 0 {
		t.Fatal("death must remove the ship and release its cargo")
	}

	for _, cargo := range []simulation.Entity{item, spare} {
		if cargo.Base().ID <= 0 || !s.World.Entities.Has(cargo.Base().ID) {
			t.Fatal("released cargo must have a replicable world entity ID")
		}
	}

	if item.ID != itemID {
		t.Fatal("released world items must retain their identity")
	}

	for range 60 {
		for _, client := range []*benchmarkSocket{socket, observer} {
			previous := client.sequence
			s.Receive(protocol.Control{Type: "snapshotAck", Sequence: previous}, client)
		}

		s.Tick(1)
	}

	if socket.sequence < 60 || observer.sequence < 60 {
		t.Fatal("both players must keep receiving snapshots after the death")
	}

	previousID := p.shipID
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.shipID == previousID || p.ship.Dead || !s.World.Entities.Has(p.shipID) {
		t.Fatal("cargo release must still allow respawning")
	}
}

func TestHydratedFatalHullAllowsRespawn(t *testing.T) {
	t.Parallel()

	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	health := p.ship.HullHealth()

	for index, plan := range p.ship.HullSegments {
		if plan.Core {
			health[index] = 0
		}
	}

	p.ship.SetHullHealth(health)
	previousID := p.shipID
	s.Tick(1)

	if s.World.Entities.Has(previousID) || !p.ship.Dead {
		t.Fatal("a player ship hydrated without cores must die")
	}

	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.shipID == previousID || !s.World.Entities.Has(p.shipID) {
		t.Fatal("a player ship hydrated without cores must allow respawn")
	}
}

func TestStrandedShipManualRespawn(t *testing.T) {
	t.Parallel()

	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	old := p.ship
	credits := p.profile.Credits

	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.ship != old {
		t.Fatal("a working ship must not be replaced")
	}

	old.SetHullHealth([]float64{0, 0, 7, 30, 34, 0, 0, 0})

	for _, segment := range old.Segments {
		if segment.ModuleSpec().ForwardThrust != 0 {
			objects.Damage(segment, 10000)
			break
		}
	}

	s.Tick(1)
	s.Receive(protocol.Control{Type: "input", Sequence: 1, Tick: s.World.Tick, Input: protocol.Input{HornDrill: true, SearchLight: true}}, socket)
	s.Tick(1)

	if old.Dead || old.Engine() != nil || !old.ModuleActive("hornDrill") || !old.ModuleActive("searchLight") {
		t.Fatal("the stranded ship must stay alive with working surviving modules")
	}

	station := int64(s.nearestStation(old.Position).ID)
	old.DockedTo = &station
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.ship != old {
		t.Fatal("refitting an engine in a docking bay must not allow respawn")
	}

	old.DockedTo = nil
	old.Launching = 1
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.ship != old {
		t.Fatal("a launching ship must not allow respawn")
	}

	old.Launching = 0
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.ship == old || !old.Dead || s.World.Entities.Has(old.ID) || p.ship.Dead || p.ship.Engine() == nil || p.ship.DockedTo == nil || p.profile.Credits != credits {
		t.Fatal("manual respawn must replace the stranded ship at a station and retain player progress")
	}
}
