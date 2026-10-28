package objects_test

import (
	"bytes"
	"slices"
	"syscall"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

type entityModuleCaptureFixture struct {
	name   string
	entity simulation.Entity
	craft  *objects.Craft
}

func entityModuleCaptureFixtures(t testing.TB) []entityModuleCaptureFixture {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{})
	station := objects.CreateStation(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)
	cargo := objects.CreatePlayerShip(world, objects.Properties{})

	for range 16 {
		cargo.CargoContents = append(cargo.CargoContents, modules.Create("searchLight", simulation.ObjectProperties{World: world}, catalog))
	}

	fixtures := []entityModuleCaptureFixture{{"ship", ship, ship.Craft}, {"station", station, station.Craft}, {"cargo", cargo, cargo.Craft}}

	for _, fixture := range fixtures {
		for i, module := range fixture.craft.Modules() {
			module.Base().Shades = slices.Clone(module.Base().Shades)
			data := module.ModuleBase()
			data.ChargeCooldown, data.FireCooldown = 0.25, 0.5

			if data.Mount != nil {
				data.Mount.Health = float64(i) / 10
				activation := float64(i) / 20
				data.Mount.HealthActivated = &activation
			}
		}

		for _, segment := range fixture.craft.Segments {
			if segment.Module != nil {
				segment.Active, segment.ActivationProgress = 0.5, 0.25
			}
		}
	}

	return fixtures
}

func TestEntityModuleCapturePreservesStateAndOwnership(t *testing.T) {
	for _, fixture := range entityModuleCaptureFixtures(t) {
		t.Run(fixture.name, func(t *testing.T) {
			saved := objects.CaptureEntity(fixture.entity)
			want := objects.SavedEntity{Modules: fixture.craft.ModuleStates()}

			if fixture.entity.Base().Kind == "station" {
				want.Modules = slices.DeleteFunc(want.Modules, func(module objects.ModuleState) bool { return module.Mount < 0 })
			}

			for _, module := range want.Modules {
				want.ModuleTypes = append(want.ModuleTypes, fixture.craft.Catalog.ModuleIDs[module.Type])
			}

			encode := func(state objects.SavedEntity) []byte {
				t.Helper()
				data, err := persistence.Encode(state)

				if err != nil {
					t.Fatal(err)
				}

				return data
			}

			got := objects.SavedEntity{Modules: saved.Modules, ModuleTypes: saved.ModuleTypes}

			if fixture.entity.Base().Kind != "station" && len(want.Modules) == 0 {
				t.Fatal("ship fixture needs fitted modules")
			}

			if !bytes.Equal(encode(got), encode(want)) {
				t.Fatal("captured module values differ from craft module state")
			}

			before := encode(saved)

			for _, module := range fixture.craft.Modules() {
				module.Base().ID += 1000
				module.Base().Health = 123

				if len(module.Base().Shades) > 0 {
					module.Base().Shades[0] = "changed"
				}

				data := module.ModuleBase()
				data.ChargeCooldown, data.FireCooldown = 234, 345

				if data.Mount != nil {
					data.Mount.Health = 456

					if data.Mount.HealthActivated != nil {
						*data.Mount.HealthActivated = 567
					}
				}
			}

			for _, segment := range fixture.craft.Segments {
				segment.Active, segment.ActivationProgress = 0, 0
			}

			// A later ModuleStates call must own its values independently too.
			for _, module := range fixture.craft.ModuleStates() {
				*module.ID, *module.Health = 678, 789

				for i := range module.Segments {
					module.Segments[i].Active, module.Segments[i].ActivationProgress = 1, 1
				}
			}

			if !bytes.Equal(before, encode(saved)) {
				t.Fatal("captured module state retained mutable live pointers or segments")
			}
		})
	}
}

var capturedEntityModules objects.SavedEntity

// Compare this same benchmark with the archived saved-state.go compiler overlay;
// keeping one implementation avoids a second full CaptureEntity function here.
func BenchmarkEntityModuleCapture(b *testing.B) {
	for _, fixture := range entityModuleCaptureFixtures(b) {
		b.Run(fixture.name, func(b *testing.B) {
			moduleCount := len(objects.CaptureEntity(fixture.entity).Modules)
			var before, after syscall.Rusage

			if err := syscall.Getrusage(syscall.RUSAGE_SELF, &before); err != nil {
				b.Fatal(err)
			}

			b.ReportAllocs()
			b.ResetTimer()

			for range b.N {
				capturedEntityModules = objects.CaptureEntity(fixture.entity)
			}

			b.StopTimer()

			if err := syscall.Getrusage(syscall.RUSAGE_SELF, &after); err != nil {
				b.Fatal(err)
			}

			cpu := after.Utime.Nano() + after.Stime.Nano() - before.Utime.Nano() - before.Stime.Nano()
			b.ReportMetric(float64(cpu)/float64(b.N), "cpu-ns/op")
			b.ReportMetric(float64(moduleCount), "modules/op")
		})
	}
}
