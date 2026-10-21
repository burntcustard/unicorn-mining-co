package gameplay

import (
	"fmt"
	"math"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestCourserCollectsOnlyInsideItsCargoHatch(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, heading := range []float64{0, math.Pi / 2} {
		for _, scenario := range []struct {
			name     string
			position Vec.Vector
			moving   bool
			item     string
		}{
			{"ahead of cannons", Vec.Create(35, 0), false, "diamond"},
			{"above hull", Vec.Create(4, -30), false, "diamond"},
			{"below hull", Vec.Create(4, 30), false, "diamond"},
			{"behind hull", Vec.Create(-30, 0), false, "diamond"},
			{"outside cannon channel", Vec.Create(15, 12), false, "diamond"},
			{"between open doors", Vec.Create(10, 0), false, "diamond"},
			{"at door hinges", Vec.Create(7.8, 0), false, "diamond"},
			{"just behind hinges", Vec.Create(6.8, 0), false, "diamond"},
			{"between cannons", Vec.Create(70, 0), true, "diamond"},
			{"gold lengthwise", Vec.Create(70, 0), true, "gold"},
			{"amethyst", Vec.Create(70, 0), true, "amethyst"},
			{"opal", Vec.Create(70, 0), true, "opal"},
		} {
			t.Run(fmt.Sprintf("%s/heading%g", scenario.name, heading), func(t *testing.T) {
				world := simulation.CreateWorld(25, catalog)
				world.Collisions = NewGameCollisions(catalog)
				ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
				ship.Position = Vec.Create(100, 200)
				ship.Face(heading)
				simulation.AddEntity(world, ship)
				ship.SetModuleActive("cargoHatch", true)
				ship.SetModuleActive("cannonSm", true)
				ship.UpdateModules(1)
				item := objects.NewItem(scenario.item, simulation.ObjectProperties{World: world, Position: Vec.Add(ship.Position, simulation.RotatePoint(scenario.position, heading)), Rotation: heading}, catalog)
				simulation.AddEntity(world, item)
				ticks := 1

				if scenario.moving {
					item.Velocity = simulation.RotatePoint(Vec.Create(-40, 0), heading)
					ticks = 30 * 5
				}

				for range ticks {
					simulation.UpdateWorld(world, simulation.UpdateWorldOptions{})

					if slices.Contains(ship.CargoContents, simulation.Entity(item)) {
						local := simulation.RotatePoint(Vec.Subtract(item.Position, ship.Position), -ship.Rotation)

						if !scenario.moving || local.X > 6 || local.X < -1 || math.Abs(local.Y) > 7 {
							t.Fatalf("cargo must pass behind the hatch doors before collection: %v", local)
						}

						return
					}
				}

				if scenario.moving {
					t.Fatalf("cargo did not pass between the cannons into the open hatch: item=%v velocity=%v ship=%v", item.Position, item.Velocity, ship.Position)
				}
			})
		}
	}
}
