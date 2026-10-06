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
	depot := catalog.StationSpecs["corral"]
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
	if len(ship.Modules()) != 3 {
		t.Fatal("Arrow must start with two cargo hatches and a medium thruster")
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
