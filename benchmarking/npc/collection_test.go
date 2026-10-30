package behavior

import (
	"runtime"
	"runtime/debug"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/npc/testhost"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

/*
Each operation constructs a fresh stock ship and completes its seeded pickup
list through normal physics. Report both simulation time and actual pickups
alongside CPU time and allocations; unlike steering samples, this includes setup.
*/
func BenchmarkCollection(b *testing.B) {
	logRuntime(b)

	for _, definition := range []string{"courser", "finch"} {
		for _, scenario := range testhost.CollectionCases {
			b.Run(definition+"/"+scenario.Name, func(b *testing.B) {
				var result testhost.CollectionResult
				b.ReportAllocs()

				for b.Loop() {
					result = testhost.RunCollection(b, definition, scenario)

					if result.Collected != result.Expected {
						b.Fatalf("collected %d/%d items", result.Collected, result.Expected)
					}
				}

				b.ReportMetric(result.Seconds, "sim-s/op")
				b.ReportMetric(float64(result.Collected), "pickups/op")
			})
		}
	}
}

func BenchmarkCollectionSteering(b *testing.B) {
	logRuntime(b)

	catalog, err := specs.Load()

	if err != nil {
		b.Fatal(err)
	}

	for _, definition := range []string{"courser", "finch"} {
		for _, position := range []struct {
			name  string
			value Vec.Vector
		}{{"nearby", Vec.Create(160, 100)}, {"behind", Vec.Create(-240, 0)}, {"travel", Vec.Create(2000, 0)}} {
			b.Run(definition+"/"+position.name, func(b *testing.B) {
				world := simulation.CreateWorld(25, catalog)
				ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: definition, PlayerID: new(int64(1))})
				simulation.AddEntity(world, ship)
				ship.SetModuleActive("cargoHatch", true)
				ship.UpdateModules(1)
				item := objects.NewItem("gold", simulation.ObjectProperties{World: world, Position: position.value, Rotation: 1.2}, catalog)
				simulation.AddEntity(world, item)
				pilot := &npc.Pilot{}
				destination := npc.Movement{Position: item.Position, Velocity: item.Velocity, IgnoreID: item.ID, Collect: true}
				pilot.Steer(ship, destination)
				b.ReportAllocs()
				b.ResetTimer()

				for b.Loop() {
					pilot.Steer(ship, destination)
				}
			})
		}
	}
}

func logRuntime(b *testing.B) {
	b.Logf("runtime=%s memoryLimit=%d gomaxprocs=%d", runtime.Version(), debug.SetMemoryLimit(-1), runtime.GOMAXPROCS(0))

	if build, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range build.Settings {
			if setting.Key == "GOEXPERIMENT" {
				b.Logf("GOEXPERIMENT=%s", setting.Value)
			}
		}
	}

}
