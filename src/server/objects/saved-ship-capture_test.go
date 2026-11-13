package objects

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func shipCaptureFixture(catalog specs.Catalog, id string) *Ship {
	world := simulation.CreateWorld(25, catalog)
	ship := NewShip(id, Properties{ObjectProperties: simulation.ObjectProperties{World: world, Position: Vec.Create(12.5, -34.5), Rotation: 0.123}}, catalog)
	ship.Shades = catalog.PaintColors[len(catalog.PaintColors)-1]
	ship.StoredPower = 0
	ship.DockedTo = new(int64(0))
	ship.TransitTime, ship.TransitGate = -0.5, 123

	for i, mount := range ship.Mounts() {
		if len(mount.Fits) == 0 {
			continue
		}

		module := modules.Create(mount.Fits[0], simulation.ObjectProperties{World: world}, catalog)
		ship.Fit(module, mount)
		module.Base().Shades = catalog.PaintColors[i%len(catalog.PaintColors)]
		module.Base().Health = 999
		mount.Health = 17 + float64(i)/10
		mount.HealthActivated = new(float64(i))
		module.ModuleBase().FireCooldown = float64(i-1) / 10
		module.ModuleBase().ChargeCooldown = 0.25

		if i%3 == 0 {
			mount.Health = math.NaN()
		}

		for _, pair := range [][2]float64{{0, 0}, {1, 0.25}, {0, 0}, {0, 0.5}, {0, 0}} {
			ship.Segments = append(ship.Segments, &simulation.Segment{Mount: mount, Module: module, Active: pair[0], ActivationProgress: pair[1]})
		}
	}

	message := "Find the next field"
	ammo := NewItem("autogunAmmo", simulation.ObjectProperties{World: world}, catalog)
	ammo.Rounds = new(0)
	ammo.Mined = true
	ship.CargoContents = append(ship.CargoContents,
		ammo,
		NewItem("diamond", simulation.ObjectProperties{World: world, Health: new(math.NaN())}, catalog),
		modules.Create("searchLight", simulation.ObjectProperties{World: world}, catalog),
		NewItem("message", simulation.ObjectProperties{World: world, Message: &message}, catalog),
	)
	ship.CargoContents[len(ship.CargoContents)-1].Base().Unlock = "RED"
	return ship
}

func TestShipCapturePreservesZeroAndNonfiniteModuleState(t *testing.T) {
	t.Parallel()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, cooldown := range []float64{-1, 0, 0.25, math.NaN(), math.Inf(1)} {
		ship := CreatePlayerShip(simulation.CreateWorld(25, catalog), Properties{})
		mount := ship.Mounts()[0]
		mount.Health = math.NaN()
		mount.HealthActivated = new(0.0)
		mount.Module.ModuleBase().FireCooldown = cooldown
		saved := CaptureShip(ship).Modules[0]

		if saved.Health != nil || saved.HealthActivated == nil || *saved.HealthActivated != 0 {
			t.Fatal("capture must preserve zero activation and omit nonfinite health")
		}

		if cooldown > 0 {
			if saved.FireCooldown != cooldown {
				t.Fatal("capture lost positive cooldown", cooldown)
			}
		} else if saved.FireCooldown != 0 {
			t.Fatal("capture must omit inactive cooldown", cooldown)
		}
	}
}

func TestShipCaptureDoesNotRetainMutableModuleState(t *testing.T) {
	t.Parallel()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	ship := shipCaptureFixture(catalog, "mustang")
	saved := CaptureShip(ship)
	want, err := json.Marshal(saved)

	if err != nil {
		t.Fatal(err)
	}

	for _, mount := range ship.Mounts() {
		mount.Health = 123

		if mount.HealthActivated != nil {
			*mount.HealthActivated = 234
		}

		if mount.Module != nil {
			mount.Module.Base().Shades = nil
			mount.Module.ModuleBase().FireCooldown = 345
		}
	}

	for _, segment := range ship.Segments {
		segment.Active, segment.ActivationProgress = 0, 0
	}

	got, err := json.Marshal(saved)

	if err != nil || !bytes.Equal(got, want) {
		t.Fatal("captured module state retained mutable live data", err)
	}
}

var capturedShip SavedShip

func BenchmarkShipCapture(b *testing.B) {
	catalog, err := specs.Load()

	if err != nil {
		b.Fatal(err)
	}

	defaultShip := CreatePlayerShip(simulation.CreateWorld(25, catalog), Properties{})
	active := shipCaptureFixture(catalog, "mustang")
	cargo := shipCaptureFixture(catalog, "mustang")

	for range 128 {
		cargo.CargoContents = append(cargo.CargoContents,
			modules.Create("searchLight", simulation.ObjectProperties{World: cargo.World}, catalog),
			NewItem("diamond", simulation.ObjectProperties{World: cargo.World}, catalog),
		)
	}

	for _, fixture := range []struct {
		name string
		ship *Ship
	}{{"default", defaultShip}, {"active", active}, {"cargo", cargo}} {
		b.Run(fixture.name, func(b *testing.B) {
			b.ReportAllocs()
			b.ResetTimer()

			for range b.N {
				capturedShip = CaptureShip(fixture.ship)
			}
		})
	}
}
