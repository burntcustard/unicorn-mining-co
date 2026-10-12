package objects_test

import (
	"encoding/json"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"math"
	"testing"
)

func TestFuelConsumptionAndReserve(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})

	near := func(actual, expected float64) {
		t.Helper()

		if math.Abs(actual-expected) > 1e-8 {
			t.Fatalf("%g != %g", actual, expected)
		}
	}

	usage := ship.Engine().ModuleBase().Spec.FuelUsage

	for _, control := range [][3]float64{{1, 0, 1}, {0, 1, .5}, {0, -1, .5}, {1, 1, 1}, {0, 0, 0}} {
		ship.Fuel = ship.FuelCapacity
		ship.Fly(control[0], control[1])
		ship.Update(1)
		near(ship.FuelCapacity-ship.Fuel, usage*control[2])
	}

	ship.Fuel = ship.FuelCapacity
	speed, turn := ship.MaxSpeed(), ship.RotationalThrust()
	ship.Fuel = ship.FuelCapacity * .05

	if ship.LowFuel() {
		t.Fatal("5% must retain normal speed")
	}

	ship.Fuel = 3
	ship.Fly(1, 1)
	near(ship.MaxSpeed(), speed/2)
	near(ship.RotationalThrust(), turn/2)
	ship.Update(1)
	near(ship.Fuel, 3-usage*0.25)
	ship.Fuel = 1e-10
	ship.Update(1)

	if ship.Fuel != 0 || ship.ForwardThrust() != 0 || ship.RotationalThrust() != 0 {
		t.Fatal("empty tank still supplies thrust")
	}

	for _, segment := range ship.Segments {
		if segment.ModuleSpec().ForwardThrust != 0 && segment.Active != 0 {
			t.Fatal("empty thruster still flares")
		}
	}

	ship.Fuel = 60
	ship.DockedTo = new(int64(999))
	ship.Update(1)
	near(ship.Fuel, 60)
	ship.DockedTo = nil
	ship.Fit(nil, ship.Engine().ModuleBase().Mount)
	ship.Update(1)
	near(ship.Fuel, 60)

	for _, spec := range catalog.ModuleSpecs {
		if spec.Behavior != "thruster" {
			continue
		}

		duration := ship.FuelCapacity * 1.15 / spec.FuelUsage

		if duration < 31*60 || duration > 63*60 {
			t.Fatal("thruster endurance outside 31–63 minutes", duration)
		}
	}
}

func TestFuelSaveRoundTrip(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})

	for _, fuel := range []float64{0, 3.25, 120} {
		ship.Fuel = fuel
		data, err := json.Marshal(objects.CaptureShip(ship))

		if err != nil {
			t.Fatal(err)
		}

		var saved objects.SavedShip

		if err = json.Unmarshal(data, &saved); err != nil {
			t.Fatal(err)
		}

		restored, err := objects.RestoreShip(saved, world, 1)

		if err != nil || restored.Fuel != fuel {
			t.Fatal("saved fuel changed", err)
		}

		encoded, err := persistence.Encode(objects.CaptureEntity(ship))

		if err != nil {
			t.Fatal(err)
		}

		var savedEntity objects.SavedEntity

		if err := persistence.Decode(encoded, &savedEntity); err != nil {
			t.Fatal(err)
		}

		entity, err := objects.RestoreEntity(savedEntity, world)

		if err != nil || entity.(*objects.Ship).Fuel != fuel {
			t.Fatal("world ship fuel changed", err)
		}
	}
}
