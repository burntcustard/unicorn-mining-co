package objects

import (
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestThrusterSurvivesUntilItsHullIsDestroyed(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, shipType := range []string{"mustang", "arrow", "crotus", "courser"} {
		t.Run(shipType, func(t *testing.T) {
			world := simulation.CreateWorld(25, catalog)
			ship := CreatePlayerShip(world, Properties{DefinitionID: shipType, PlayerID: new(int64(1))})
			simulation.AddEntity(world, ship)
			engine := ship.Engine()
			mount := engine.ModuleBase().Mount
			hull := mount.Hull

			if shipType == "mustang" || shipType == "courser" {
				coreCount := 0

				for _, segment := range ship.Segments {
					if segment.Hull && segment.Core {
						coreCount++
					}
				}

				index := 4

				if shipType == "courser" {
					index = 3
				}

				if hull.Core || coreCount != 1 || ship.Cockpit.HullPlan != ship.HullSegments[index] {
					t.Fatal("only the forward hull should be a core")
				}
			}

			engineHealth := mount.Health
			var nozzle *simulation.Segment

			for _, segment := range ship.Segments {
				if segment.Module == engine {
					nozzle = segment
					break
				}
			}

			Damage(hull, hull.Health-1)
			ship.Update(0)

			if hull.Health != 1 || ship.Engine() != engine || mount.Health != engineHealth || ship.Stranded() {
				t.Fatal("a living hull lost its thruster")
			}

			Damage(nozzle, 1)

			if hull.Health != 0 {
				t.Fatal("a hit on the thruster did not damage its hull")
			}

			ship.Update(0)

			if ship.Dead || ship.Engine() != nil || !ship.Stranded() || slices.Contains(ship.Modules(), engine) {
				t.Fatal("destroying the engine hull did not leave a living stranded ship")
			}

			restored, err := RestoreShip(CaptureShip(ship), world, 1)

			if err != nil || !restored.Stranded() || restored.Engine() != nil {
				t.Fatalf("stranded ship did not survive persistence: %v", err)
			}

			for _, segment := range ship.Segments {
				if segment.Hull && segment.Core {
					Damage(segment, 10000)
				}
			}

			ship.Update(0)

			if !ship.Dead || ship.Stranded() {
				t.Fatal("full destruction did not end the stranded state")
			}
		})
	}
}

func TestShipIsStrandedOnlyAfterLosingEveryThrusterHull(t *testing.T) {
	catalog, _ := specs.Load()
	definition := catalog.ShipSpecs["courser"]
	definition.HullSegments = slices.Clone(definition.HullSegments)
	definition.HullSegments[0].Core = true
	definition.HullSegments[3].Mounts = append(slices.Clone(definition.HullSegments[3].Mounts), []specs.MountPoint{{X: 0, Y: 0, Fits: []string{"thrusterSingleSm"}}})
	definition.InitialLoadout = []specs.InitialModule{{Mount: 0, Module: "cannonSm"}, {Mount: 1, Module: "thrusterSingleSm"}, {Mount: 2, Module: "powerPlant"}, {Mount: 3, Module: "cargoHatchPair"}, {Mount: 4, Module: "thrusterSingleSm"}, {Mount: 5, Module: "cannonSm"}}
	catalog.ShipSpecs["courser"] = definition
	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)
	first := ship.Engine().ModuleBase().Mount.Hull
	Damage(first, 10000)
	ship.Update(0)

	if ship.Dead || ship.Engine() == nil || ship.Stranded() {
		t.Fatal("losing one thruster hull stranded a ship with another engine")
	}

	second := ship.Engine().ModuleBase().Mount.Hull

	if first == second {
		t.Fatal("fixture did not fit engines to different hulls")
	}

	Damage(second, 10000)
	ship.Update(0)

	if ship.Dead || !ship.Stranded() {
		t.Fatal("losing the last thruster hull did not strand the ship")
	}
}
