package objects_test

import (
	"strings"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestSavedShipRejectsUnknownDefinitions(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})

	for _, test := range []struct {
		name   string
		mutate func(*objects.SavedShip)
	}{
		{"ship", func(s *objects.SavedShip) { s.Type = "retired-ship" }},
		{"module", func(s *objects.SavedShip) { s.Modules[0].Type = "retired-module" }},
		{"cargo module", func(s *objects.SavedShip) {
			s.Cargo = []objects.SavedCargo{{ID: 1001, Type: "retired-module", Module: true}}
		}},
		{"cargo item", func(s *objects.SavedShip) { s.Cargo = []objects.SavedCargo{{ID: 1002, Type: "retired-item"}} }},
		{"paint", func(s *objects.SavedShip) { s.Paint = new(len(catalog.PaintColors)) }},
	} {
		t.Run(test.name, func(t *testing.T) {
			saved := objects.CaptureShip(ship)
			test.mutate(&saved)

			if _, err := objects.RestoreShip(saved, world, 1); err == nil {
				t.Fatal("invalid saved definition was accepted")
			}
		})
	}
}

func TestSavedEntityRejectsUnknownDefinitions(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})
	ship.CargoContents = []simulation.Entity{modules.Create("searchLight", simulation.ObjectProperties{World: world}, catalog)}

	for _, test := range []struct {
		name   string
		mutate func(*objects.SavedEntity)
	}{
		{"fitted module", func(s *objects.SavedEntity) { s.ModuleTypes[0] = "retired-module" }},
		{"cargo module", func(s *objects.SavedEntity) { s.CargoContents[0].ModuleType = "retired-module" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			saved := objects.CaptureEntity(ship)
			test.mutate(&saved)

			if _, err := objects.RestoreEntity(saved, world); err == nil || !strings.Contains(err.Error(), "retired-module") {
				t.Fatal("invalid saved definition was accepted", err)
			}
		})
	}

	for _, saved := range []objects.SavedEntity{
		{ModuleType: "retired-module"},
		{Object: objects.SavedObject{Kind: "ship", DefinitionID: "retired-ship"}},
		{Object: objects.SavedObject{Kind: "station", DefinitionID: "retired-station"}},
		{Object: objects.SavedObject{Kind: "projectile", DefinitionID: "retired-module"}},
		{Object: objects.SavedObject{Kind: "item", HasResource: true, Resource: len(catalog.ItemIDs)}},
	} {
		if _, err := objects.RestoreEntity(saved, world); err == nil {
			t.Fatal("invalid saved entity definition was accepted")
		}
	}
}
