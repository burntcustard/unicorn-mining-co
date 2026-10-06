package main

import (
	"encoding/hex"
	"encoding/json"
	"maps"
	"os"
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server/network"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func main() {
	catalog, err := specs.Load()

	if err != nil {
		panic(err)
	}

	type destruction struct {
		ShipType string `json:"shipType"`
		Hull     int    `json:"hull"`
		Before   string `json:"before"`
		Damaged  string `json:"damaged"`
		Settled  string `json:"settled"`
	}

	cases := []destruction{}

	for _, shipType := range slices.Sorted(maps.Keys(catalog.ShipSpecs)) {
		for index := range catalog.ShipSpecs[shipType].HullSegments {
			world := simulation.CreateWorld(25, catalog)
			ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: shipType})
			simulation.AddEntity(world, ship)

			if !ship.HullSegments[index].Core {
				ship.CargoContents = append(ship.CargoContents, modules.Create("searchLight", simulation.ObjectProperties{World: world}, catalog))
			}

			manager := network.NewBinaryReplicationManager(catalog)
			options := network.SnapshotOptions{World: world, ShipID: ship.ID}
			before := manager.Initial(options)

			for _, segment := range ship.Segments {
				if segment.HullPlan == ship.HullSegments[index] {
					objects.Damage(segment, 10000)
					break
				}
			}

			world.Tick++
			damaged := manager.Initial(options)
			ship.Update(0)
			world.Tick++
			settled := manager.Initial(options)
			cases = append(cases, destruction{shipType, index, hex.EncodeToString(before), hex.EncodeToString(damaged), hex.EncodeToString(settled)})
		}
	}

	if err := json.NewEncoder(os.Stdout).Encode(cases); err != nil {
		panic(err)
	}
}
