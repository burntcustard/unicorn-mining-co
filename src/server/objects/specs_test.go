package objects

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestSpecDrivenCraft(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	scout := catalog.ShipSpecs["mustang"]
	scout.CargoSpace = 20
	catalog.ShipSpecs["testScout"] = scout
	depot := catalog.StationSpecs["corral-5"]
	depot.LocalMovementRadius = 900
	catalog.StationSpecs["testDepot"] = depot
	world := simulation.CreateWorld(25, catalog)
	id := int64(1)

	for _, props := range []Properties{{DefinitionID: "testScout"}, {DefinitionID: "testScout", PlayerID: &id}} {
		if len(CreateShip(world, props).Modules()) != 0 {
			t.Fatal("generic ships must start without modules, including player-owned ships")
		}
	}

	first := CreatePlayerShip(world, Properties{DefinitionID: "testScout"})
	second := CreatePlayerShip(world, Properties{DefinitionID: "testScout"})

	if first.DefinitionID != "testScout" || first.CargoSpace != 20 || len(first.Modules()) != len(scout.InitialLoadout) {
		t.Fatal("ship did not consume selected spec")
	}

	first.Mounts()[0].Health = 0
	first.CargoContents = append(first.CargoContents, NewItem("diamond", simulation.ObjectProperties{World: world}, catalog))

	if second.Mounts()[0].Health <= 0 || len(second.CargoContents) != 0 || first.Modules()[0] == second.Modules()[0] {
		t.Fatal("ships share mutable state")
	}

	station := CreateStation(Properties{DefinitionID: "testDepot", ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)

	if station.DefinitionID != "testDepot" || station.LocalMovementRadius != 900 {
		t.Fatal("station did not consume selected spec")
	}
}

func TestArrowInitialLoadout(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "arrow"})

	if len(ship.Modules()) != 4 {
		t.Fatal("Arrow must start with two cargo hatches, a medium thruster and a power plant")
	}

	thruster := ship.Mounts()[2].Module

	if thruster == nil || thruster.ModuleBase().Type != "thrusterSingleMd" {
		t.Fatal("Arrow must start with its medium thruster")
	}

	for _, index := range []int{0, 4} {
		mount := ship.Mounts()[index]

		if mount.Module == nil || mount.Module.ModuleBase().Type != "cargoHatch" || mount.LocalPosition.X != -9 {
			t.Fatal("Arrow must have a cargo hatch at each rear side mount")
		}
	}

	if len(CreateShip(world, Properties{DefinitionID: "arrow"}).Modules()) != 0 {
		t.Fatal("generic Arrow ships must remain unequipped")
	}
}

func TestStartingPowerPlants(t *testing.T) {
	catalog, _ := specs.Load()

	for shipType := range catalog.ShipSpecs {
		t.Run(shipType, func(t *testing.T) {
			world := simulation.CreateWorld(25, catalog)
			ship := CreatePlayerShip(world, Properties{DefinitionID: shipType})
			plants := 0

			for _, mount := range ship.Mounts() {
				if mount.Module == nil || mount.Module.ModuleBase().Type != "powerPlant" {
					continue
				}

				plants++

				if len(mount.Module.ModuleBase().Model) != 0 || mount.Module.ModuleBase().Spec.PowerGenerated <= 0 {
					t.Fatal("power plants must generate power without a visible model")
				}

				mount.Health = 40
			}

			if plants != 1 {
				t.Fatalf("expected one starting power plant, got %d", plants)
			}

			restored, err := RestoreShip(CaptureShip(ship), world, 1)

			if err != nil {
				t.Fatal(err)
			}

			plants = 0

			for _, mount := range restored.Mounts() {
				if mount.Module != nil && mount.Module.ModuleBase().Type == "powerPlant" {
					plants++

					if mount.Health != 40 {
						t.Fatal("restoring an internal plant must retain its health")
					}
				}
			}

			if plants != 1 {
				t.Fatal("restoring a ship lost its internal power plant")
			}
		})
	}
}
