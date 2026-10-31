package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

func primeContactForecast(ship *objects.Ship) {
	var events []protocol.SimulationEvent
	ship.World.Collisions.CapturePoses(ship.World.Entities)
	ship.World.Collisions.Step(ship.World.Entities, 0, &events)
}

func assertPickupForecast(t *testing.T, ship *objects.Ship, item *objects.Item, thrust, turn float64) {
	t.Helper()
	primeContactForecast(ship)
	forecast := newContactForecast(ship, item, collectionCenters(ship, nil))
	prediction, ready := forecast.predict(thrust, turn, 6)

	if !ready {
		t.Fatal("fixture has no native collision geometry")
	}

	dt := ship.Catalog.Simulation.SimulationStep
	arrived, seconds := false, prediction.seconds

	for tick := range int(math.Round(prediction.seconds / dt)) {
		if tick > 0 && tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = forecast.controls(ship.Base(), item.Base())
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

		if slices.Contains(ship.CargoContents, simulation.Entity(item)) {
			arrived, seconds = true, float64(tick+1)*dt
			break
		}
	}

	shipError, itemError := Vec.Distance(ship.Position, prediction.ship.Position), Vec.Distance(item.Position, prediction.target.Position)
	t.Logf("forecast=%v/%.3fs safe=%v actual=%v/%.3fs shipError=%g itemError=%g", prediction.arrived, prediction.seconds, prediction.safe, arrived, seconds, shipError, itemError)

	if !prediction.safe {
		t.Fatal("safe pickup fixture was rejected by the forecast")
	}

	if prediction.arrived != arrived || math.Abs(prediction.seconds-seconds) > dt+.001 || shipError > .1 || itemError > .1 {
		t.Fatal("native forecast disagrees with real engine/contact/pickup physics")
	}
}

func TestContactForecastMatchesPickupPhysics(t *testing.T) {
	for _, hull := range []string{"courser", "finch"} {
		for _, scenario := range []struct {
			name                      string
			position                  Vec.Vector
			rotation, heading, thrust float64
		}{
			{"aligned", Vec.Create(180, 0), 0, 0, 1},
			{"broadside", Vec.Create(180, 0), math.Pi / 2, 0, 1},
			{"offset", Vec.Create(160, 15), .7, 0, 1},
			{"turning", Vec.Create(180, 60), .7, .3, 1},
			{"coast", Vec.Create(80, 0), 0, 0, 0},
		} {
			t.Run(fmt.Sprintf("%s/%s", hull, scenario.name), func(t *testing.T) {
				ship := arrivalShip(t, hull)
				collectionThroat(t, ship)
				item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: scenario.position, Rotation: scenario.rotation}, ship.Catalog)
				simulation.AddEntity(ship.World, item)
				assertPickupForecast(t, ship, item, scenario.thrust, collectionTurnInput(ship, scenario.heading-ship.Rotation))
			})
		}
	}
}

func TestContactForecastTracksStationParentAcquisitionAndExit(t *testing.T) {
	for _, spin := range []float64{-.04, .04} {
		for _, exiting := range []bool{false, true} {
			t.Run(fmt.Sprintf("spin%g/exiting%v", spin, exiting), func(t *testing.T) {
				ship := arrivalShip(t, "finch")
				collectionThroat(t, ship)
				station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Spin: spin, Radius: new(400.)}}, ship.Catalog)
				simulation.AddEntity(ship.World, station)
				ship.Position, ship.Rotation = Vec.Create(650, 0), math.Pi
				position := Vec.Create(350, 0)

				if exiting {
					ship.Position, ship.Rotation, position = Vec.Create(550, 0), 0, Vec.Create(900, 0)
					ship.LocalMovementParent, ship.LocalMovementRate = station, 1
				}

				item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, ID: new(int64(101)), Position: position, Rotation: ship.Rotation}, ship.Catalog)
				simulation.AddEntity(ship.World, item)
				assertPickupForecast(t, ship, item, 1, 0)
			})
		}
	}
}

func TestContactForecastCannotMutateLiveCargoOrParents(t *testing.T) {
	ship := arrivalShip(t, "courser")
	collectionThroat(t, ship)
	station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Spin: .03}}, ship.Catalog)
	simulation.AddEntity(ship.World, station)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(200, 50), Velocity: Vec.Create(80, -35), Spin: -2.4}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	contents := []simulation.Entity{item}
	item.Collections = []*[]simulation.Entity{&contents}
	item.LocalMovementParent, item.LocalMovementRate = station, .4
	item.Decay, item.Health = 100, .1
	primeContactForecast(ship)
	before, parent, beforeShip := *item.Base(), *station.Base(), *ship.Base()
	changes := 0

	ship.World.EntityChanged = func(simulation.Entity, bool) { changes++ }

	forecast := newContactForecast(ship, item, collectionCenters(ship, nil))

	if _, ready := forecast.predict(1, 0, 6); !ready {
		t.Fatal("missing fixture geometry")
	}

	resident, exists := ship.World.Entities.Get(item.ID)

	if !exists || resident != item || changes != 0 || len(contents) != 1 || contents[0] != item {
		t.Fatal("forecast changed live entity collections")
	}

	if item.Position != before.Position || item.Velocity != before.Velocity || item.Rotation != before.Rotation || item.Spin != before.Spin || item.Health != before.Health || item.Dead != before.Dead || item.LocalMovementParent != station || item.LocalMovementRate != .4 || item.Self != before.Self || item.World != before.World {
		t.Fatal("forecast changed live item motion or ownership")
	}

	if ship.Position != beforeShip.Position || ship.Velocity != beforeShip.Velocity || ship.Rotation != beforeShip.Rotation || ship.Spin != beforeShip.Spin || ship.Dead != beforeShip.Dead || ship.Self != beforeShip.Self || ship.World != beforeShip.World {
		t.Fatal("forecast changed live ship motion or ownership")
	}

	if station.Position != parent.Position || station.Velocity != parent.Velocity || station.Rotation != parent.Rotation || station.Spin != parent.Spin {
		t.Fatal("forecast moved a live parent")
	}
}

func TestContactForecastTracksPassiveItemMotion(t *testing.T) {
	for _, velocity := range []Vec.Vector{{}, {X: 80, Y: -35}, {X: 650, Y: 120}, {X: .1}} {
		t.Run(fmt.Sprintf("velocity%v", velocity), func(t *testing.T) {
			ship := arrivalShip(t, "courser")
			collectionThroat(t, ship)
			item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(200, 50), Velocity: velocity, Rotation: .7, Spin: -2.4}, ship.Catalog)
			simulation.AddEntity(ship.World, item)
			assertPickupForecast(t, ship, item, 1, 0)
		})
	}
}

/*
The controller must not use gentle station-wall impacts as part of an entry.
Ordinary docking contacts at the bay core remain covered by the docking matrix.
*/
func TestContactForecastRejectsStationWallContacts(t *testing.T) {
	ship := arrivalShip(t, "courser")
	ship.Position = Vec.Create(500, 0)
	station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Radius: new(400.)}}, ship.Catalog)
	simulation.AddEntity(ship.World, station)
	primeContactForecast(ship)
	ship.Position = Vec.Create(260, 150)
	prediction, ready := newContactForecast(ship, station, nil).predict(0, 0, ship.Catalog.Simulation.SimulationStep)

	if !ready || prediction.safe || prediction.arrived {
		t.Fatalf("station wall was approved: ready=%v safe=%v arrived=%v", ready, prediction.safe, prediction.arrived)
	}
}
