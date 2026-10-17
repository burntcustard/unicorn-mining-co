package objects_test

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
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

	plant.ModuleBase().Spec.PowerGenerated = 2
	plant.ModuleBase().Spec.PowerCapacity = 64
	system.ModuleBase().Spec.Power, system.ModuleBase().Spec.PowerActivated = 1, 1
	engine.ModuleBase().Spec.PowerActivated = 2
	ship.StoredPower = 2
	ship.Fly(0, 0)

	if ship.PowerUsage() != 3 {
		t.Fatal("idle thrusters must demand active power")
	}

	ship.Fly(1, 1)
	fullThrust, fullTurn := ship.ForwardThrust(), ship.RotationalThrust()
	ship.UpdatePower(1)

	if ship.StoredPower != 1 || ship.ThrusterPower != 1 {
		t.Fatal("storage did not cover deficit")
	}

	ship.UpdatePower(1)
	ship.UpdatePower(1)

	if ship.StoredPower != 0 || ship.ThrusterPower != 0.5 || ship.SystemsPower != 1 || ship.ForwardThrust() != fullThrust/2 || ship.RotationalThrust() != fullTurn/2 {
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

	if restored.StoredPower != 0 || restored.ThrusterPower != 0.5 || restored.SystemsPower != 1 {
		t.Fatal("simulation checkpoint lost power state")
	}

	ship.StoredPower = 0.5
	ship.UpdatePower(1)

	if ship.ThrusterPower != 0.75 || ship.StoredPower != 0 {
		t.Fatal("partial tick supply is incorrect")
	}

	plant.ModuleBase().Spec.PowerGenerated = 0.5
	ship.UpdatePower(1)

	if ship.SystemsPower != 0.5 || ship.ThrusterPower != 0 {
		t.Fatal("systems did not receive supply first")
	}

	plant.ModuleBase().Spec.PowerGenerated = 0
	ship.UpdatePower(1)

	if ship.SystemsPower != 0 || ship.ThrusterPower != 0 {
		t.Fatal("unpowered modules still operate")
	}

	plant.ModuleBase().Spec.PowerGenerated = 5
	ship.UpdatePower(2)

	if ship.StoredPower != 4 {
		t.Fatal("MW did not integrate into MJ")
	}

	ship.UpdatePower(100)

	if ship.StoredPower != 64 {
		t.Fatal("storage did not clamp to capacity")
	}

	plant.ModuleBase().Mount.Health = 0
	ship.UpdatePower(1)

	if ship.StoredPower != 0 || ship.PowerGeneration() != 0 || ship.PowerCapacity() != 0 || ship.ThrusterPower != 0 {
		t.Fatal("broken plant still supplies power")
	}
}

func TestCompactShipPowerStorage(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})

	for _, stored := range []float64{0, 12.5, ship.PowerCapacity()} {
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
