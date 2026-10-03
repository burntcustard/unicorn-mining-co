package objects

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

func TestDefinitionDrivenCraft(t *testing.T) {
	catalog, err := definitions.Load()
	if err != nil {
		t.Fatal(err)
	}
	scout := catalog.ShipDefinitions["mustang"]
	scout.CargoSpace = 20
	catalog.ShipDefinitions["testScout"] = scout
	depot := catalog.StationDefinitions["corral"]
	depot.LocalMovementRadius = 900
	catalog.StationDefinitions["testDepot"] = depot
	world := simulation.CreateWorld(25, catalog)
	first := CreateShip(world, Properties{DefinitionID: "testScout"})
	second := CreateShip(world, Properties{DefinitionID: "testScout"})
	if first.DefinitionID != "testScout" || first.CargoSpace != 20 || len(first.Modules()) != len(scout.StartingModules) {
		t.Fatal("ship did not consume selected definition")
	}
	first.Mounts()[0].Health = 0
	first.CargoContents = append(first.CargoContents, NewItem("diamond", simulation.ObjectProperties{}, catalog))
	if second.Mounts()[0].Health <= 0 || len(second.CargoContents) != 0 || first.Modules()[0] == second.Modules()[0] {
		t.Fatal("ships share mutable state")
	}
	station := CreateStation(Properties{DefinitionID: "testDepot"}, catalog)
	if station.DefinitionID != "testDepot" || station.LocalMovementRadius != 900 {
		t.Fatal("station did not consume selected definition")
	}
}
