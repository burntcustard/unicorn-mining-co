package objects_test

import (
	"bytes"
	"log"
	"strings"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestCompactShipSkipsRemovedDefinitions(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})
	saved := objects.CaptureShip(ship)
	removed := saved.Modules[0]
	removed.Type = "retired-module"
	saved.Modules[0] = removed

	saved.Cargo = []objects.SavedCargo{
		{ID: 1001, Type: "retired-module", Module: true},
		{ID: 1002, Type: "retired-item"},
		{ID: 1003, Type: "autogunAmmo", Rounds: new(73)},
	}

	var warnings bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&warnings)
	defer log.SetOutput(previous)
	restored, err := objects.RestoreShip(saved, world, 1)

	if err != nil || restored == nil {
		t.Fatal("removed definitions must not prevent restoring a ship", err)
	}

	if restored.Mounts()[removed.Mount].Module != nil || len(restored.Modules()) != len(saved.Modules)-1 {
		t.Fatal("the removed module must leave its mount empty and retain other equipment")
	}

	if len(restored.CargoContents) != 1 || restored.CargoContents[0].Base().ID != 1003 || *restored.CargoContents[0].(*objects.Item).Rounds != 73 {
		t.Fatal("only removed cargo must be discarded")
	}

	for _, id := range []string{"retired-module", "retired-item"} {
		if !strings.Contains(warnings.String(), id) {
			t.Fatalf("missing warning identifying removed definition %q", id)
		}
	}

	// Removing a power plant also reduces capacity below the saved battery level.
	saved = objects.CaptureShip(ship)

	for i := range saved.Modules {
		if saved.Modules[i].Type == "powerPlant" {
			saved.Modules[i].Type = "retired-power-plant"
		}
	}

	restored, err = objects.RestoreShip(saved, world, 1)

	if err != nil || restored.StoredPower != restored.PowerCapacity() || restored.PowerCapacity() != 0 {
		t.Fatal("removed power equipment must clamp stored energy to the remaining capacity", err)
	}
}

func TestSavedEntitySkipsRemovedDefinitions(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})

	ship.CargoContents = []simulation.Entity{
		modules.Create("searchLight", simulation.ObjectProperties{World: world}, catalog),
		objects.NewItem("diamond", simulation.ObjectProperties{World: world}, catalog),
	}

	saved := objects.CaptureEntity(ship)
	removedMount := saved.Modules[0].Mount
	saved.ModuleTypes[0] = "retired-module"
	saved.CargoContents[0].ModuleType = "retired-module"
	restored, err := objects.RestoreEntity(saved, world)

	if err != nil || restored == nil {
		t.Fatal("removed definitions must not prevent restoring a world craft", err)
	}

	craft := restored.(*objects.Ship)

	if craft.Mounts()[removedMount].Module != nil || len(craft.Modules()) != len(ship.Modules())-2 || len(craft.CargoContents) != 1 || craft.CargoContents[0].Base().ID != ship.CargoContents[1].Base().ID {
		t.Fatal("world craft restoration must discard only the removed modules")
	}

	for _, removed := range []objects.SavedEntity{
		{ModuleType: "retired-module"},
		{Object: objects.SavedObject{Kind: "ship", DefinitionID: "retired-ship"}},
		{Object: objects.SavedObject{Kind: "station", DefinitionID: "retired-station"}},
		{Object: objects.SavedObject{Kind: "projectile", DefinitionID: "retired-module"}},
		{Object: objects.SavedObject{Kind: "item", HasResource: true, Resource: len(catalog.ItemIDs)}},
	} {
		entity, err := objects.RestoreEntity(removed, world)

		if err != nil || entity != nil {
			t.Fatal("removed world definitions must be skipped without an error", err)
		}
	}

	compact := objects.CaptureShip(ship)
	compact.Type = "retired-ship"

	if entity, err := objects.RestoreShip(compact, world, 1); err != nil || entity != nil {
		t.Fatal("a removed player hull must be skipped without an error", err)
	}
}
