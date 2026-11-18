package objects

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestThrusterOutputUsesAllOriginalMounts(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "moth", PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)
	first, second := ship.Mounts()[3], ship.Mounts()[8]
	medium := first.Module.ModuleBase().Spec
	large := modules.Create("thrusterDualLg", simulation.ObjectProperties{World: world}, catalog)
	ship.Fit(large, second)
	largeSpec := large.ModuleBase().Spec

	check := func(forward, rotational, fuel float64) {
		t.Helper()

		if math.Abs(ship.ForwardThrust()-forward) > 1e-9 || math.Abs(ship.RotationalThrust()-rotational) > 1e-9 {
			t.Fatalf("thrust = (%g, %g), want (%g, %g)", ship.ForwardThrust(), ship.RotationalThrust(), forward, rotational)
		}

		ship.Fuel = ship.FuelCapacity
		ship.Fly(1, 0)
		ship.ConsumeFuel(1)

		if math.Abs(ship.Fuel-(ship.FuelCapacity-fuel)) > 1e-9 {
			t.Fatalf("fuel consumed = %g, want %g", ship.FuelCapacity-ship.Fuel, fuel)
		}
	}

	check((medium.ForwardThrust+largeSpec.ForwardThrust)/2, (medium.RotationalThrust+largeSpec.RotationalThrust)/2, medium.FuelUsage+largeSpec.FuelUsage)
	ship.Fit(nil, second)
	check(medium.ForwardThrust/2, medium.RotationalThrust/2, medium.FuelUsage)
	ship.Fit(large, second)

	// A dead hull no longer contributes even before its mount is detached.
	hullHealth := first.Hull.Health
	first.Hull.Health = 0
	check(largeSpec.ForwardThrust/2, largeSpec.RotationalThrust/2, largeSpec.FuelUsage)

	if ship.Engine() != large {
		t.Fatal("the thruster on the dead hull was still selected")
	}

	first.Hull.Health = hullHealth

	Damage(first.Hull, 10000)
	check(largeSpec.ForwardThrust/2, largeSpec.RotationalThrust/2, largeSpec.FuelUsage)
	ship.Update(0)
	check(largeSpec.ForwardThrust/2, largeSpec.RotationalThrust/2, largeSpec.FuelUsage)

	restored, err := RestoreShip(CaptureShip(ship), world, 1)

	if err != nil {
		t.Fatal(err)
	}

	ship = restored
	check(largeSpec.ForwardThrust/2, largeSpec.RotationalThrust/2, largeSpec.FuelUsage)
}

func TestCargoThrusterDoesNotPowerShip(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "moth"})
	first, second := ship.Mounts()[3], ship.Mounts()[8]
	cargoThruster := first.Module
	ship.Fit(nil, first)
	ship.Fit(nil, second)
	// Even a stale mount reference on cargo cannot make it an active engine.
	cargoThruster.ModuleBase().Mount = first

	if ship.Engine() != nil || !ship.Stranded() || ship.ForwardThrust() != 0 || ship.RotationalThrust() != 0 {
		t.Fatal("a cargo thruster kept the ship operational")
	}
}

func TestSingleNozzleTurningFlare(t *testing.T) {
	ship, world, _ := thrustBoosterFixture(t)
	catalog := world.Specification

	for _, id := range []string{"thrusterSingleSm", "thrusterSingleMd"} {
		engine := modules.Create(id, simulation.ObjectProperties{World: world}, catalog)
		ship.Fit(engine, ship.Mounts()[0])

		for _, control := range [][3]float64{{0, 1, .5}, {0, -1, .5}, {1, 1, .5}, {1, -1, .5}, {1, .5, .75}, {1, 0, 1}, {0, 0, 0}} {
			ship.Fly(control[0], control[1])

			for _, segment := range ship.SegmentsAtMount(engine.ModuleBase().Mount) {
				if math.Abs(segment.Active-control[2]) > 1e-9 {
					t.Fatalf("%s forward=%g turn=%g: flare=%g, want %g", id, control[0], control[1], segment.Active, control[2])
				}
			}
		}
	}

	engine := modules.Create("thrusterDualSm", simulation.ObjectProperties{World: world}, catalog)
	ship.Fit(engine, ship.Mounts()[0])

	for _, turn := range []float64{-1, 1} {
		for _, forward := range []float64{0, 1} {
			ship.Fly(forward, turn)

			for _, segment := range ship.SegmentsAtMount(engine.ModuleBase().Mount) {
				expected := forward * ship.Rules.Flight.SteeringEase

				if turn == -segment.ThrusterNozzleSide {
					expected = 1
				}

				if segment.Active != expected {
					t.Fatal("dual nozzles lost differential steering")
				}
			}
		}
	}
}
