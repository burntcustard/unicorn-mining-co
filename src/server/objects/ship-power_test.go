package objects_test

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"math"
	"testing"
)

func TestStreamingPower(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})

	if ship.StoredPower != ship.PowerCapacity() {
		t.Fatal("new ship is not charged")
	}

	engine := ship.Engine()
	engineDemand := engine.ModuleBase().Spec.PowerActivated
	systemDemand := engineDemand / 2
	close := func(value, expected float64) bool { return math.Abs(value-expected) < 1e-9 }
	var plant, system simulation.Module

	for _, module := range ship.Modules() {
		spec := &module.ModuleBase().Spec
		spec.Power, spec.PowerActivated = 0, 0

		if spec.PowerGenerated > 0 {
			plant = module
		} else if module != engine {
			system = module
		}
	}

	plant.ModuleBase().Spec.PowerGenerated = engineDemand
	system.ModuleBase().Spec.Power, system.ModuleBase().Spec.PowerActivated = systemDemand, systemDemand
	engine.ModuleBase().Spec.PowerActivated = engineDemand
	ship.StoredPower = engineDemand
	ship.Fly(0, 0)

	if !close(ship.PowerUsage(), engineDemand+systemDemand) {
		t.Fatal("idle thrusters must demand active power")
	}

	ship.Fly(1, 1)
	fullThrust, fullTurn := ship.ForwardThrust(), ship.RotationalThrust()
	ship.UpdatePower(1)

	if !close(ship.StoredPower, engineDemand/2) || ship.ThrusterPower != 1 {
		t.Fatal("storage did not cover deficit")
	}

	ship.UpdatePower(1)
	ship.UpdatePower(1)

	if !close(ship.StoredPower, 0) || !close(ship.ThrusterPower, 0.5) || ship.SystemsPower != 1 || !close(ship.ForwardThrust(), fullThrust/2) || !close(ship.RotationalThrust(), fullTurn/2) {
		t.Fatal("spare generation did not provide half thrust")
	}

	saved := objects.CaptureEntity(ship)
	encoded, err := persistence.Encode(saved)

	if err != nil {
		t.Fatal(err)
	}

	var decoded objects.SavedEntity

	if err := persistence.Decode(encoded, &decoded); err != nil {
		t.Fatal(err)
	}

	restoredEntity, err := objects.RestoreEntity(decoded, world)

	if err != nil {
		t.Fatal(err)
	}

	restored := restoredEntity.(*objects.Ship)

	if !close(restored.StoredPower, 0) || !close(restored.ThrusterPower, 0.5) || restored.SystemsPower != 1 {
		t.Fatal("simulation checkpoint lost power state")
	}

	ship.StoredPower = systemDemand / 2
	ship.UpdatePower(1)

	if !close(ship.ThrusterPower, 0.75) || !close(ship.StoredPower, 0) {
		t.Fatal("partial tick supply is incorrect")
	}

	plant.ModuleBase().Spec.PowerGenerated = systemDemand / 2
	ship.UpdatePower(1)

	if !close(ship.SystemsPower, 0.5) || ship.ThrusterPower != 0 {
		t.Fatal("systems did not receive supply first")
	}

	plant.ModuleBase().Spec.PowerGenerated = 0
	ship.UpdatePower(1)

	if ship.SystemsPower != 0 || ship.ThrusterPower != 0 {
		t.Fatal("unpowered modules still operate")
	}

	plant.ModuleBase().Spec.PowerGenerated = engineDemand + systemDemand + engineDemand
	ship.UpdatePower(2)

	if !close(ship.StoredPower, engineDemand*2) {
		t.Fatal("MW did not integrate into MJ")
	}

	ship.UpdatePower(ship.PowerCapacity() / engineDemand)

	if ship.StoredPower != ship.PowerCapacity() {
		t.Fatal("storage did not clamp to capacity")
	}

	plant.ModuleBase().Mount.Health = 0
	ship.UpdatePower(1)

	if !close(ship.StoredPower, 0) || ship.PowerGeneration() != 0 || ship.PowerCapacity() != 0 || ship.ThrusterPower != 0 {
		t.Fatal("broken plant still supplies power")
	}
}

func TestCompactShipPowerStorage(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})

	for _, stored := range []float64{0, ship.PowerCapacity() / 3, ship.PowerCapacity()} {
		ship.StoredPower = stored
		saved := objects.CaptureShip(ship)
		restored, err := objects.RestoreShip(saved, world, 1)

		if err != nil || restored.StoredPower != stored {
			t.Fatal("stored energy did not round-trip", stored, err)
		}
	}

	saved := objects.CaptureShip(ship)
	saved.StoredPower = nil
	restored, err := objects.RestoreShip(saved, world, 1)

	if err != nil || restored.StoredPower != restored.PowerCapacity() {
		t.Fatal("legacy save did not start charged", err)
	}

	for _, stored := range []float64{-1, ship.PowerCapacity() + 1} {
		saved.StoredPower = &stored

		if _, err := objects.RestoreShip(saved, world, 1); err == nil {
			t.Fatal("invalid stored energy accepted", stored)
		}
	}
}
