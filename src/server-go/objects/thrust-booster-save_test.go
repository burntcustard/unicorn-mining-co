package objects_test

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server-go/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server-go/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server-go/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server-go/simulation"
)

func checkSavedThrustBooster(t *testing.T, module simulation.Module, id int64, charge, fire float64) {
	t.Helper()
	data := module.ModuleBase()

	if data.Type != "thrustBooster" || module.Base().ID != id || data.ChargeCooldown != charge || data.FireCooldown != fire {
		t.Fatalf("restored module = %q/%d charge %g fire %g", data.Type, module.Base().ID, data.ChargeCooldown, data.FireCooldown)
	}
}

func roundTripThrustBoosterSave(t *testing.T, saved objects.SavedEntity) objects.SavedEntity {
	t.Helper()
	encoded, err := persistence.Encode(saved)

	if err != nil {
		t.Fatal(err)
	}

	var decoded objects.SavedEntity

	if err := persistence.Decode(encoded, &decoded); err != nil {
		t.Fatal(err)
	}

	return decoded
}

func TestThrustBoosterLooseSavePreservesCharge(t *testing.T) {
	world := objects.BoosterTestWorld(t)
	module := modules.Create("thrustBooster", simulation.ObjectProperties{World: world}, world.Specification)
	module.ModuleBase().ChargeCooldown, module.ModuleBase().FireCooldown = 7, 1
	saved := objects.CaptureEntity(module)
	module.ModuleBase().ChargeCooldown, module.ModuleBase().FireCooldown = 0, 0
	restored, err := objects.RestoreEntity(roundTripThrustBoosterSave(t, saved), world)

	if err != nil {
		t.Fatal(err)
	}

	checkSavedThrustBooster(t, restored.(simulation.Module), module.Base().ID, 7, 1)
}

func TestThrustBoosterFullShipSavePreservesFittedAndCargoCharges(t *testing.T) {
	world := objects.BoosterTestWorld(t)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "boosterFixture"})
	cargo, fitted := ship.Mounts()[1].Module, ship.Mounts()[2].Module
	ship.CargoContents = append(ship.CargoContents, objects.NewItem("diamond", simulation.ObjectProperties{World: world}, world.Specification))
	ship.Fit(nil, ship.Mounts()[1])
	cargo.ModuleBase().ChargeCooldown, cargo.ModuleBase().FireCooldown = 7, 1
	fitted.ModuleBase().ChargeCooldown, fitted.ModuleBase().FireCooldown = 8, .5
	saved := roundTripThrustBoosterSave(t, objects.CaptureEntity(ship))
	restoredEntity, err := objects.RestoreEntity(saved, world)

	if err != nil {
		t.Fatal(err)
	}

	restored := restoredEntity.(*objects.Ship)
	checkSavedThrustBooster(t, restored.Mounts()[2].Module, fitted.Base().ID, 8, .5)

	if len(restored.CargoContents) != 2 || restored.CargoContents[0].Base().Name != "Diamond" {
		t.Fatal("restoring cargo boost charges changed cargo ordering")
	}

	checkSavedThrustBooster(t, restored.CargoContents[1].(simulation.Module), cargo.Base().ID, 7, 1)
}

func TestThrustBoosterCompactShipSavePreservesFittedAndCargoCharges(t *testing.T) {
	world := objects.BoosterTestWorld(t)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "boosterFixture"})
	cargo, fitted := ship.Mounts()[1].Module, ship.Mounts()[2].Module
	ship.Fit(nil, ship.Mounts()[1])
	cargo.ModuleBase().ChargeCooldown, cargo.ModuleBase().FireCooldown = 7, 1
	fitted.ModuleBase().ChargeCooldown, fitted.ModuleBase().FireCooldown = 8, .5
	restored, err := objects.RestoreShip(objects.CaptureShip(ship), world, 7)

	if err != nil {
		t.Fatal(err)
	}

	checkSavedThrustBooster(t, restored.Mounts()[2].Module, fitted.Base().ID, 8, .5)
	checkSavedThrustBooster(t, restored.CargoContents[0].(simulation.Module), cargo.Base().ID, 7, 1)
}
