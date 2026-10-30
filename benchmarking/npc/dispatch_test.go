package behavior

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/npc/collector"
	"github.com/burntcustard/unicorn-mining-co/src/server/npc/testhost"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

/*
Measure ordinary dispatch and station discovery without launching workers.
This includes public-controller bookkeeping, so its timings are not equivalent
to the former private discovery-only benchmark.
*/
func BenchmarkCollectorDispatch(b *testing.B) {
	logRuntime(b)

	catalog, err := specs.Load()

	if err != nil {
		b.Fatal(err)
	}

	for _, scenario := range []struct {
		name  string
		items int
	}{{"idle", 0}, {"loose", 256}} {
		b.Run(scenario.name, func(b *testing.B) {
			host := testhost.New(25, catalog)
			manager := collector.New(host)
			world := host.World()

			for range 2000 {
				object := simulation.NewGameObject(simulation.ObjectProperties{World: world}, catalog.Simulation)
				simulation.AddEntity(world, object)
			}

			for index := range scenario.items {
				position := Vec.Create(float64(index%4)*2000+100, float64(index/4%4)*2000+100)
				item := objects.NewItem("gold", simulation.ObjectProperties{World: world, Position: position}, catalog)

				if index%2 == 0 {
					simulation.AddEntity(world, item)
				} else {
					host.Regions.Sleeping.Set(item.ID, item)
				}
			}

			manager.Dispatch()

			for _, station := range manager.Stations {
				station.CheckAt = math.MaxUint64
			}

			host.Regions.View(Vec.Vector{}, nil)
			interval := uint64(catalog.CollectorSpec.DiscoveryInterval / catalog.Simulation.SimulationStep)
			b.ReportAllocs()
			b.ResetTimer()

			for b.Loop() {
				world.Tick += interval
				manager.Dispatch()
				host.Regions.View(Vec.Vector{}, nil)
			}
		})
	}
}
