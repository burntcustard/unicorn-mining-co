package objects_test

import (
	"bytes"
	"encoding/json"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

func TestCompactShipRestoresConditionAndCargo(t *testing.T) {
	catalog, _ := specs.Load()
	w := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(w, objects.Properties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(12.7, -34.2), Velocity: Vec.Create(1.2, 3.4), Rotation: 0.123, Spin: 0.456}})
	ship.Shades = catalog.PaintColors[1]
	ship.Mounts()[0].Health -= 0.125
	hull := ship.HullHealth()
	hull[0] -= 0.25
	ship.SetHullHealth(hull)
	ship.SetModuleActive("searchLight", true)
	ship.UpdateModules(0.1)
	ship.Modules()[0].Base().Shades = catalog.PaintColors[4]
	dock := int64(123)
	ship.DockedTo = &dock
	message := "Find the next field"
	ship.CargoContents = append(ship.CargoContents, objects.NewItem("diamond", simulation.ObjectProperties{World: w}, catalog), modules.Create("searchLight", simulation.ObjectProperties{World: w}, catalog), objects.NewItem("message", simulation.ObjectProperties{World: w, Message: &message}, catalog))
	ship.CargoContents[1].Base().Health = math.NaN()
	saved := objects.CaptureShip(ship)
	data, err := json.Marshal(saved)

	if err != nil {
		t.Fatal(err)
	}

	var decoded objects.SavedShip

	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}

	restored, err := objects.RestoreShip(decoded, w, 7)

	if err != nil {
		t.Fatal(err)
	}

	if restored.Position != Vec.Create(13, -34) || restored.Velocity != (Vec.Vector{}) || restored.Spin != 0 || restored.Rotation != 0.123 || *restored.PlayerID != 7 || *restored.DockedTo != dock || !slices.Equal(restored.HullHealth(), hull) || !slices.Equal(restored.Shades, ship.Shades) {
		t.Fatal("minimal ship did not restore its saved condition")
	}

	after, err := json.Marshal(objects.CaptureShip(restored))

	if err != nil || !bytes.Equal(data, after) {
		t.Fatal("module health, activation, paint or cargo did not round-trip", string(data), string(after), err)
	}

	ship.Position.X++
	ship.Mounts()[0].Health--
	ship.CargoContents[2].Base().Message = new(string)
	unchanged, _ := json.Marshal(saved)

	if !bytes.Equal(data, unchanged) {
		t.Fatal("saved ship retains mutable world data")
	}

	for _, omitted := range []string{"velocity", "spin", "credits", "mass", "friction", "random", "ShapeOutline"} {
		if bytes.Contains(data, []byte("\""+omitted+"\"")) {
			t.Fatal("unneeded field remains", omitted)
		}
	}
}

func TestCompactShipSize(t *testing.T) {
	catalog, _ := specs.Load()
	ship := objects.CreatePlayerShip(simulation.CreateWorld(25, catalog), objects.Properties{})
	old, _ := persistence.Encode(objects.CaptureEntity(ship))
	data, err := json.Marshal(objects.CaptureShip(ship))

	if err != nil {
		t.Fatal(err)
	}

	t.Logf("default ship: %d bytes Gob world record -> %d bytes JSON ship record", len(old), len(data))

	if len(data) >= len(old)/2 {
		t.Fatal("minimal ship did not materially reduce storage")
	}
}

func TestCompactShipRestoresLegacyModuleIDs(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for oldID, newID := range map[string]string{"shieldGenerator": "shieldGeneratorSm", "thrusterSingle": "thrusterSingleMd"} {
		t.Run(oldID, func(t *testing.T) {
			world := simulation.CreateWorld(25, catalog)
			ship := objects.CreatePlayerShip(world, objects.Properties{})
			module := modules.Create(newID, simulation.ObjectProperties{World: world}, catalog)
			ship.Fit(module, nil)
			ship.CargoContents = append(ship.CargoContents, modules.Create(newID, simulation.ObjectProperties{World: world}, catalog))
			saved := objects.CaptureShip(ship)

			for i := range saved.Modules {
				if saved.Modules[i].Type == newID {
					saved.Modules[i].Type = oldID
				}
			}

			for i := range saved.Cargo {
				if saved.Cargo[i].Type == newID {
					saved.Cargo[i].Type = oldID
				}
			}

			restored, err := objects.RestoreShip(saved, world, 7)

			if err != nil {
				t.Fatal(err)
			}

			if !slices.ContainsFunc(restored.Modules(), func(m simulation.Module) bool { return m.ModuleBase().Type == newID }) {
				t.Fatal("legacy fitted module did not restore")
			}

			if !slices.ContainsFunc(restored.CargoContents, func(e simulation.Entity) bool {
				m, ok := e.(simulation.Module)
				return ok && m.ModuleBase().Type == newID
			}) {
				t.Fatal("legacy cargo module did not restore")
			}
		})
	}
}

func BenchmarkCaptureShip(b *testing.B) {
	catalog, _ := specs.Load()
	ship := objects.CreatePlayerShip(simulation.CreateWorld(25, catalog), objects.Properties{})
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		objects.CaptureShip(ship)
	}
}
