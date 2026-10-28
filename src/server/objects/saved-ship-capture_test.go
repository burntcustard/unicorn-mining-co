package objects

import (
	"bytes"
	"encoding/json"
	"math"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func legacyCaptureShip(ship *Ship) SavedShip {
	stored := max(0, min(ship.PowerCapacity(), ship.StoredPower))
	s := SavedShip{StoredPower: &stored, TransitTime: ship.TransitTime, TransitGate: ship.TransitGate, Fuel: ship.Fuel, ID: ship.ID, Type: ship.DefinitionID, Position: [2]int64{int64(math.Round(ship.Position.X)), int64(math.Round(ship.Position.Y))}, Rotation: ship.Rotation, Dead: ship.Dead, DockedTo: savedPointer(ship.DockedTo), Hull: ship.HullHealth(), Modules: []SavedShipModule{}}

	if s.Type == "" {
		s.Type = "mustang"
	}

	if !slices.Equal(ship.Shades, ship.Catalog.Colors["white"]) {
		s.Paint = savedPaint(ship.Shades, ship.Catalog)
	}

	for _, state := range ship.ModuleStates() {
		if state.Mount < 0 {
			continue
		}

		m := SavedShipModule{ID: *state.ID, Type: ship.Catalog.ModuleIDs[state.Type], Mount: state.Mount, Health: finiteHealth(*state.Health), HealthActivated: savedPointer(state.HealthActivated), Paint: savedPaint(state.Shades, ship.Catalog)}

		if state.FireCooldown != nil {
			m.FireCooldown = *state.FireCooldown
		}

		last := -1

		for i, segment := range state.Segments {
			if segment.Active != 0 || segment.ActivationProgress != 0 {
				last = i
			}
		}

		for _, segment := range state.Segments[:last+1] {
			m.Active = append(m.Active, [2]float64{segment.Active, segment.ActivationProgress})
		}

		s.Modules = append(s.Modules, m)
	}

	for _, entity := range ship.CargoContents {
		o := entity.Base()
		cargo := SavedCargo{Mined: o.Mined, ID: o.ID, Health: finiteHealth(o.Health), Message: savedPointer(o.Message), Unlock: o.Unlock}

		if m, ok := entity.(simulation.Module); ok {
			cargo.Module, cargo.Type, cargo.Paint = true, m.ModuleBase().Type, savedPaint(o.Shades, ship.Catalog)
		} else if o.Resource >= 0 && o.Resource < len(ship.Catalog.ItemIDs) {
			cargo.Type = ship.Catalog.ItemIDs[o.Resource]

			if item, ok := entity.(*Item); ok {
				cargo.Rounds = savedPointer(item.Rounds)
			}
		}

		s.Cargo = append(s.Cargo, cargo)
	}

	return s
}

func assertShipCaptureEquivalent(t *testing.T, ship *Ship) {
	t.Helper()
	want, wantErr := json.Marshal(legacyCaptureShip(ship))
	got, gotErr := json.Marshal(CaptureShip(ship))

	if wantErr != nil || gotErr != nil {
		if wantErr == nil || gotErr == nil || wantErr.Error() != gotErr.Error() {
			t.Fatalf("capture changed JSON failure: got %v, want %v", gotErr, wantErr)
		}

		return
	}

	if !bytes.Equal(got, want) {
		t.Fatalf("capture changed saved JSON\ngot  %s\nwant %s", got, want)
	}
}

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

func TestShipCaptureMatchesLegacy(t *testing.T) {
	t.Parallel()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	var ids []string

	for id := range catalog.ShipSpecs {
		ids = append(ids, id)
	}

	slices.Sort(ids)

	for _, id := range ids {
		t.Run(id, func(t *testing.T) {
			assertShipCaptureEquivalent(t, NewShip(id, Properties{ObjectProperties: simulation.ObjectProperties{World: simulation.CreateWorld(25, catalog)}}, catalog))
			ship := shipCaptureFixture(catalog, id)
			assertShipCaptureEquivalent(t, ship)

			for i, mount := range ship.Mounts() {
				if i%2 == 0 {
					ship.Fit(nil, mount)
				}
			}

			assertShipCaptureEquivalent(t, ship)
			ship.DefinitionID = ""
			ship.Dead = true
			ship.Shades = []string{"unmatched"}
			assertShipCaptureEquivalent(t, ship)
		})
	}
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
		mount.Module.ModuleBase().ChargeCooldown = math.NaN()
		assertShipCaptureEquivalent(t, ship)

		for _, segment := range ship.Segments {
			if segment.Mount == mount {
				segment.Active, segment.ActivationProgress = 0, 0
			}
		}

		assertShipCaptureEquivalent(t, ship)
		mount.HealthActivated = nil
		assertShipCaptureEquivalent(t, ship)
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

func BenchmarkShipCaptureComparison(b *testing.B) {
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
		for _, capture := range []struct {
			name string
			run  func(*Ship) SavedShip
		}{{"legacy", legacyCaptureShip}, {"current", CaptureShip}} {
			b.Run(fixture.name+"/"+capture.name, func(b *testing.B) {
				b.ReportAllocs()
				b.ResetTimer()

				for range b.N {
					capturedShip = capture.run(fixture.ship)
				}
			})
		}
	}
}
