package objects_test

import (
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestShieldSizes(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	spec := catalog.ShipSpecs["mustang"]

	for i, segment := range spec.HullSegments {
		for j, mount := range segment.Mounts {
			for k, point := range mount {
				if slices.Contains(point.Fits, "shieldGeneratorSm") {
					spec.HullSegments[i].Mounts[j][k].Fits = append(point.Fits, "shieldGeneratorMd")
				}
			}
		}
	}

	catalog.ShipSpecs["mustang"] = spec

	for id, radius := range map[string]float64{"shieldGeneratorSm": 50, "shieldGeneratorMd": 60} {
		t.Run(id, func(t *testing.T) {
			world := simulation.CreateWorld(25, catalog)
			ship := objects.CreatePlayerShip(world, objects.Properties{})
			shield := modules.Create(id, simulation.ObjectProperties{World: world}, catalog)
			ship.Fit(shield, nil)

			if shield.ModuleBase().Mount == nil || shield.ModuleBase().Type != id {
				t.Fatal("shield variant must fit and retain its identity")
			}

			var events []protocol.SimulationEvent
			ship.Control(protocol.Input{ShieldGenerator: true}, &events)
			ship.UpdateModules(1)

			if !ship.ModuleActive("shieldGenerator") || !ship.ModuleActive(id) {
				t.Fatal("shared shield control must activate either size")
			}

			hitbox := ship.Hitbox()

			if len(hitbox) != 1 || hitbox[0].Radius != radius {
				t.Fatalf("want cover radius %v, got %v", radius, hitbox)
			}

			restored, err := objects.RestoreEntity(objects.CaptureEntity(ship), world)

			if err != nil {
				t.Fatal(err)
			}

			restoredShip := restored.(*objects.Ship)

			if !restoredShip.ModuleActive(id) || restoredShip.Hitbox()[0].Radius != radius {
				t.Fatal("saved shield size and activation must survive restoration")
			}

			ship.Control(protocol.Input{}, &events)

			if ship.ModuleActive(id) {
				t.Fatal("shared shield control must deactivate either size")
			}
		})
	}
}

func TestLegacyModuleIDs(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for oldID, newID := range map[string]string{"shieldGenerator": "shieldGeneratorSm", "thrusterSingle": "thrusterSingleMd"} {
		t.Run(oldID, func(t *testing.T) {
			world := simulation.CreateWorld(25, catalog)
			module := modules.Create(newID, simulation.ObjectProperties{World: world}, catalog)
			saved := objects.CaptureEntity(module)
			saved.ModuleType = oldID
			restored, err := objects.RestoreEntity(saved, world)

			if err != nil {
				t.Fatal(err)
			}

			if restored.(simulation.Module).ModuleBase().Type != newID {
				t.Fatal("legacy loose module must restore with its current ID")
			}

			ship := objects.CreatePlayerShip(world, objects.Properties{})

			for _, mount := range ship.Mounts() {
				if slices.Contains(mount.Fits, newID) {
					ship.Fit(module, mount)
					break
				}
			}

			savedShip := objects.CaptureEntity(ship)

			for i, id := range savedShip.ModuleTypes {
				if id == newID {
					savedShip.ModuleTypes[i] = oldID
				}
			}

			restoredShip, err := objects.RestoreEntity(savedShip, world)

			if err != nil {
				t.Fatal(err)
			}

			for _, id := range objects.CaptureEntity(restoredShip).ModuleTypes {
				if id == newID {
					return
				}
			}

			t.Fatal("legacy fitted module must restore with its current ID")
		})
	}
}
