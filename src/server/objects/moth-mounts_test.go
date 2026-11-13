package objects

import (
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestMothWeaponMountsAndInitialLoadout(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "moth"})

	for _, index := range []int{4, 5, 9, 10} {
		mount := ship.Mounts()[index]

		if mount.Module != nil {
			t.Fatalf("weapon mount %d should start empty", index)
		}

		for _, id := range []string{"autogun", "laser", "plasmaAccelerator"} {
			if !slices.Contains(mount.Fits, id) {
				t.Fatalf("weapon mount %d does not accept %s", index, id)
			}
		}
	}

	for index, id := range map[int]string{0: "powerPlant4V", 2: "cargoHatchPair", 3: "thrusterDualMd", 6: "hornDrill", 7: "searchLight", 8: "thrusterDualMd", 11: "hornDrill", 12: "searchLight"} {
		module := ship.Mounts()[index].Module

		if module == nil || module.ModuleBase().Type != id {
			t.Fatalf("initial mount %d should contain %s", index, id)
		}
	}
}
