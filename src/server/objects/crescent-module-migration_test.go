package objects

import (
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

func TestLegacyCrescentThrustersMigrateAtRestoreBoundaries(t *testing.T) {
	ship, world := npcShipFixture("crescent")

	for _, index := range []int{1, 2} {
		mount := ship.Mounts()[index]
		mount.Health = 7
		mount.Module.Base().Shades = world.Specification.PaintColors[1]
		part := ship.SegmentsAtMount(mount)[0]
		part.Active, part.ActivationProgress = 1, .4
	}

	ship.CargoContents = append(ship.CargoContents, modules.Create("thrusterSingleSm", simulation.ObjectProperties{World: world}, world.Specification))

	check := func(restored *Ship) {
		t.Helper()

		for _, index := range []int{1, 2} {
			mount := restored.Mounts()[index]
			original := ship.Mounts()[index]

			if mount.Module.ModuleBase().Type != "thrusterCrescent" || mount.Module.Base().ID != original.Module.Base().ID || mount.Health != 7 || !slices.Equal(mount.Module.Base().Shades, original.Module.Base().Shades) {
				t.Fatal("legacy fitted thruster migration lost identity, health, or paint")
			}

			part := restored.SegmentsAtMount(mount)[0]

			if part.Active != 1 || part.ActivationProgress != .4 {
				t.Fatal("legacy fitted thruster migration reset activation state")
			}
		}

		if len(restored.CargoContents) != 1 || restored.CargoContents[0].(simulation.Module).ModuleBase().Type != "thrusterSingleSm" {
			t.Fatal("legacy migration changed an ordinary cargo thruster")
		}
	}

	saved := CaptureShip(ship)

	for index := range saved.Modules {
		if saved.Modules[index].Type == "thrusterCrescent" {
			saved.Modules[index].Type = "thrusterSingleSm"
		}
	}

	restored, err := RestoreShip(saved, world, 7)

	if err != nil {
		t.Fatal(err)
	}

	check(restored)

	checkpoint := CaptureEntity(ship)

	for index := range checkpoint.ModuleTypes {
		if checkpoint.ModuleTypes[index] == "thrusterCrescent" {
			checkpoint.ModuleTypes[index] = "thrusterSingleSm"
		}
	}

	entity, err := RestoreEntity(checkpoint, world)

	if err != nil {
		t.Fatal(err)
	}

	check(entity.(*Ship))

	unrelated, otherWorld := flightFixture(t)
	other, err := RestoreShip(CaptureShip(unrelated), otherWorld, 9)

	if err != nil || other.Mounts()[1].Module.ModuleBase().Type != "thrusterSingleSm" {
		t.Fatal("legacy migration changed a fitted module on another ship", err)
	}
}
