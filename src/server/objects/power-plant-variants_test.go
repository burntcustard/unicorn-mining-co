package objects

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestPowerPlantVariantsRestore(t *testing.T) {
	catalog, err := specs.Load()
	if err != nil {
		t.Fatal(err)
	}

	shipSizes := map[string]int{"arrow": 2, "courser": 1, "crotus": 2, "finch": 1, "kestrel": 3, "moth": 4, "mustang": 2}
	if len(shipSizes) != len(catalog.ShipSpecs) {
		t.Fatal("every ship must have a tested power plant size")
	}

	for shipType, size := range shipSizes {
		for _, id := range catalog.StationModuleIDs {
			spec := catalog.ModuleSpecs[id]
			if spec.Behavior != "powerPlant" {
				continue
			}
			t.Run(shipType+"/"+id, func(t *testing.T) {
				world := simulation.CreateWorld(25, catalog)
				ship := CreatePlayerShip(world, Properties{DefinitionID: shipType})
				mountIndex := -1
				for i, candidate := range ship.Mounts() {
					if candidate.Module != nil && candidate.Module.ModuleBase().Spec.Behavior == "powerPlant" {
						mountIndex = i
						break
					}
				}
				if mountIndex < 0 {
					t.Fatal("ship has no starting power plant")
				}
				mount := ship.Mounts()[mountIndex]
				if mount.Module.ModuleBase().Type != fmt.Sprintf("powerPlant%dV", size) {
					t.Fatal("ship must start with a value plant of its assigned size")
				}
				compatible := strings.HasPrefix(id, fmt.Sprintf("powerPlant%d", size))
				if slices.Contains(mount.Fits, id) != compatible || spec.Weight <= 0 {
					t.Fatalf("incorrect mount compatibility or weight for %s", id)
				}
				ship.Fit(nil, mount)
				credits := 100000.0
				_, purchased := ship.ApplyDockAction(protocol.DockAction{Action: "buy", Module: int64(slices.Index(catalog.ModuleIDs, id)), HasMount: true, Mount: int64(mountIndex)}, &credits)
				if purchased != compatible {
					t.Fatalf("purchase of %s: got %v, want %v", id, purchased, compatible)
				}
				if !compatible {
					if credits != 100000 || mount.Module != nil {
						t.Fatal("an incompatible purchase must leave credits and mount unchanged")
					}
					cargoPurchase, bought := ship.ApplyDockAction(protocol.DockAction{Action: "buy", Module: int64(slices.Index(catalog.ModuleIDs, id))}, &credits)
					if !bought {
						t.Fatal("an incompatible plant can still be bought into cargo")
					}
					_, equipped := ship.ApplyDockAction(protocol.DockAction{Action: "equip", ModuleID: cargoPurchase.ModuleID, HasMount: true, Mount: int64(mountIndex)}, &credits)
					if equipped || mount.Module != nil {
						t.Fatal("an incompatible plant in cargo must not equip")
					}
					return
				}
				restored, err := RestoreShip(CaptureShip(ship), world, 1)
				if err != nil {
					t.Fatal(err)
				}
				restoredPlant := restored.Mounts()[mountIndex].Module
				if restoredPlant == nil || restoredPlant.ModuleBase().Type != id || restoredPlant.ModuleBase().Spec.Weight != spec.Weight || restoredPlant.ModuleBase().Spec.PowerGenerated != spec.PowerGenerated {
					t.Fatal("restored plant lost its identity or catalog values")
				}
			})
		}
	}
}
