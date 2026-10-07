package objects_test

import (
	"fmt"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestDockingBayOnGenericCraft(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	world.Collisions = gameplay.NewGameCollisions(catalog)
	// Reuse the station's hull spec, but expose only a generic Craft.
	craft := objects.CreateStation(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, catalog).Craft
	craft.Self, craft.Kind = craft, "craft"
	simulation.AddEntity(world, craft)
	playerID := int64(7)
	ship := objects.CreatePlayerShip(world, objects.Properties{ObjectProperties: simulation.ObjectProperties{PlayerID: &playerID, Position: Vec.Create(150, 0), Rotation: 0.4}})
	simulation.AddEntity(world, ship)
	events := simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Ticks: 1})

	if ship.DockedTo == nil || *ship.DockedTo != craft.ID {
		t.Fatal("ship did not dock to the generic craft")
	}

	if math.Abs(ship.Rotation-0.4) > 1e-6 {
		t.Fatal("docking changed the arrival angle")
	}

	for _, segment := range ship.Segments {
		if segment.Active != 0 {
			t.Fatal("docking left a module active")
		}
	}

	simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Ticks: 1})

	if math.Abs(ship.Rotation-0.4) > 1e-6 {
		t.Fatal("docked updates reset the arrival angle")
	}

	for _, event := range events {
		if docked, ok := event.(protocol.Docked); ok && docked.PlayerID == playerID && docked.DockedTo == craft.ID {
			return
		}
	}

	t.Fatal("docking did not report the target craft ID")
}

func TestCorralBays(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, id := range []string{"corral-5", "corral-6"} {
		world := simulation.CreateWorld(25, catalog)
		world.Collisions = gameplay.NewGameCollisions(catalog)
		station := objects.NewStation(id, objects.Properties{ObjectProperties: simulation.ObjectProperties{World: world, Rotation: 0.7}}, catalog)
		simulation.AddEntity(world, station)
		ship := objects.CreatePlayerShip(world, objects.Properties{})
		simulation.AddEntity(world, ship)

		for _, angle := range station.DockingBays {
			ship.DockedTo = nil
			ship.Launching = 0
			ship.Position = Vec.Create(150*math.Cos(station.Rotation+angle), 150*math.Sin(station.Rotation+angle))
			simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Ticks: 1})

			if ship.DockedTo == nil || *ship.DockedTo != station.ID {
				t.Fatalf("%s bay %g did not dock", id, angle)
			}
		}

		// Selection must cover a future station with three bays as well.
		station.DockingBays = []float64{0, math.Pi / 2, math.Pi}
		chosen := map[float64]bool{}

		for range 100 {
			ship.DockedTo = &station.ID
			ship.Launch()
			valid := false

			for _, bay := range station.DockingBays {
				if ship.Rotation == station.Rotation+bay {
					valid = true
					chosen[bay] = true
				}
			}

			if !valid || ship.DockedTo != nil {
				t.Fatal("launch did not choose a station bay")
			}
		}

		if len(chosen) != 3 {
			t.Fatal("launch did not use every available bay")
		}
	}
}

func TestCorralLaunchDuringTick(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, angle := range []float64{0, math.Pi} {
		t.Run(fmt.Sprint(angle), func(t *testing.T) {
			world := simulation.CreateWorld(25, catalog)
			world.Collisions = gameplay.NewGameCollisions(catalog)
			station := objects.NewStation("corral-6", objects.Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)
			station.DockingBays = []float64{angle}
			simulation.AddEntity(world, station)
			playerID := int64(7)
			ship := objects.CreatePlayerShip(world, objects.Properties{ObjectProperties: simulation.ObjectProperties{PlayerID: &playerID}})
			simulation.AddEntity(world, ship)
			simulation.AddPlayer(world, simulation.Player{ID: playerID, ShipID: ship.ID})
			ship.DockedTo = &station.ID
			simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Inputs: map[int64]protocol.InputFrame{playerID: {Changes: []protocol.InputChange{{Offset: catalog.Simulation.SimulationStep / 2, Input: protocol.Input{Launch: true}}}}}})

			if math.Abs(ship.Spin) > 0.1 {
				t.Fatalf("instant launch turn became spin: %g", ship.Spin)
			}

			for range 150 {
				simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Inputs: map[int64]protocol.InputFrame{playerID: {Input: protocol.Input{Thrust: 1}}}})
			}

			distance := ship.Position.X*math.Cos(angle) + ship.Position.Y*math.Sin(angle)

			if distance < station.LocalMovementRadius || math.Abs(ship.Spin) > 0.1 {
				t.Fatalf("failed to leave bay: distance %g spin %g", distance, ship.Spin)
			}
		})
	}
}

func TestDockingImmediatelyDisablesModules(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	station := objects.CreateStation(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{ObjectProperties: simulation.ObjectProperties{Rotation: 0.4, Spin: 3}})

	for _, segment := range ship.Segments {
		segment.Active = 1
	}

	var bay *collision.Collider

	for _, collider := range station.Hitbox() {
		if collider.DockSegment {
			bay = collider
			break
		}
	}

	if bay == nil {
		t.Fatal("missing docking trigger")
	}

	var events []protocol.SimulationEvent
	station.HandleDockingContacts([]collision.Contact{{Collider: bay, Other: ship.Hitbox()[0]}}, &events, world, catalog.Simulation.SimulationStep)

	if ship.DockedTo == nil || ship.Rotation != 0.4 || ship.Spin != 0 {
		t.Fatal("docking must retain the arrival angle and stop spin")
	}

	for _, segment := range ship.Segments {
		if segment.Active != 0 {
			t.Fatal("docking must disable modules before the next update")
		}
	}
}
