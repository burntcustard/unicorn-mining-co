package objects_test

import (
	"bytes"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"testing"
)

func TestSavedEntityRoundTrip(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	w := simulation.CreateWorld(25, catalog)
	id := int64(7)
	ship := objects.CreatePlayerShip(w, objects.Properties{ObjectProperties: simulation.ObjectProperties{PlayerID: &id, Position: Vec.Create(12, 34), Velocity: Vec.Create(5, -6)}})
	ship.Launching, ship.HasLaunching = 1.5, true
	ship.Fly(1, -1)
	ship.SetModuleActive("cargoHatch", true)
	ship.Mounts()[0].Health -= 5
	health := ship.HullHealth()
	health[0] -= 8
	ship.SetHullHealth(health)
	ship.CargoContents = append(ship.CargoContents, objects.NewItem("diamond", simulation.ObjectProperties{World: w}, catalog), modules.Create("searchLight", simulation.ObjectProperties{World: w}, catalog))
	radius := 80.0
	asteroid := simulation.CreateAsteroid(w, simulation.AsteroidProperties{Position: Vec.Create(700, 800), Radius: &radius, Contents: []int{1, 3}}).LockGeometry()
	asteroid.Segments()[0].Health -= 1
	station := objects.CreateStation(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: w}}, catalog)
	station.SetHullHealth(station.HullHealth())
	fill := 1.0
	wreck := objects.CreateWreckage(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: w}}, []objects.WreckageSegment{{Radius: 10, Health: 2, FillShade: &fill, Offset: Vec.Create(2, 3), Stroke: [][][]float64{{{1, 2}, {3, 4}}}}}, catalog)
	wreck.Decay = 2
	message := "hello"
	item := objects.NewItem("message", simulation.ObjectProperties{World: w, Message: &message}, catalog)

	for _, entity := range []simulation.Entity{ship, asteroid, station, wreck, item} {
		t.Run(entity.Base().Kind, func(t *testing.T) {
			saved := objects.CaptureEntity(entity)
			before, err := persistence.Encode(saved)

			if err != nil {
				t.Fatal(err)
			}

			var decoded objects.SavedEntity

			if err := persistence.Decode(before, &decoded); err != nil {
				t.Fatal(err)
			}

			restored, err := objects.RestoreEntity(decoded, w)

			if err != nil {
				t.Fatal(err)
			}

			switch restored := restored.(type) {
			case *objects.Ship:
				if restored.Name != "Mustang" || restored.CargoContents[0].(*objects.Item).Name != "Diamond" {
					t.Fatal("ship and cargo display names must be reconstructed from specs")
				}
			case *objects.Item:
				if restored.Name != "Message" {
					t.Fatal("item display name must be reconstructed from its spec")
				}
			}

			after, err := persistence.Encode(objects.CaptureEntity(restored))

			if err != nil {
				t.Fatal(err)
			}

			if !bytes.Equal(before, after) {
				t.Fatalf("%s did not preserve mechanics through encoding/restoration", entity.Base().Kind)
			}
		})
	}
}

func TestUnstrokedModuleWreckageRoundTrip(t *testing.T) {
	catalog, _ := specs.Load()

	for _, id := range []string{"cargoHatch", "plasmaAccelerator", "autogun", "laser"} {
		for _, side := range []float64{-1, 1} {
			world := simulation.CreateWorld(25, catalog)
			ship := objects.CreatePlayerShip(world, objects.Properties{})
			var mounted *simulation.Mount

			for _, mount := range ship.Mounts() {
				for _, fit := range mount.Fits {
					if fit == id && mount.LocalPosition.Y*side > 0 {
						mounted = mount
					}
				}
			}

			module := modules.Create(id, simulation.ObjectProperties{World: world}, catalog)
			ship.Fit(module, mounted)
			simulation.AddEntity(world, ship)
			ship.Detach(mounted)
			var debris *objects.Craft

			world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
				if craft, ok := entity.(*objects.Craft); ok && craft.Decay != 0 {
					debris = craft
				}
			})

			if debris == nil {
				t.Fatal("destroyed module did not leave wreckage")
			}

			check := func(craft *objects.Craft) {
				for i, segment := range craft.Wreckage() {
					original := debris.Wreckage()[i]

					if (segment.FillShade == nil) != (original.FillShade == nil) || segment.FillShade != nil && *segment.FillShade != *original.FillShade {
						t.Fatalf("%s wreckage lost its paint shade", id)
					}

					if segment.Color != original.Color {
						t.Fatalf("%s wreckage lost its explicit color", id)
					}

					if segment.Stroke == nil || len(segment.Stroke) != 0 || segment.FillShade == nil && segment.Color == "" {
						t.Fatalf("%s wreckage lost its fill or gained an outline: stroke=%#v fill=%v", id, segment.Stroke, segment.FillShade)
					}
				}
			}

			check(debris)
			encoded, err := persistence.Encode(objects.CaptureEntity(debris))

			if err != nil {
				t.Fatal(err)
			}

			var saved objects.SavedEntity

			if err := persistence.Decode(encoded, &saved); err != nil {
				t.Fatal(err)
			}

			restored, err := objects.RestoreEntity(saved, world)

			if err != nil {
				t.Fatal(err)
			}

			check(restored.(*objects.Craft))
		}
	}
}

func TestSavedStateOwnsItsMemory(t *testing.T) {
	catalog, _ := specs.Load()
	w := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(w, objects.Properties{})
	ship.CargoContents = append(ship.CargoContents, objects.NewItem("diamond", simulation.ObjectProperties{World: w}, catalog))
	saved := objects.CaptureEntity(ship)
	before, _ := persistence.Encode(saved)
	ship.Modules()[0].Base().Shades[0] = "modified"
	ship.CargoContents[0].Base().Label = "changed"
	after, _ := persistence.Encode(saved)

	if !bytes.Equal(before, after) {
		t.Fatal("background encoding would observe mutable world state")
	}
}

func TestSavedPositionsRoundWithoutChangingMechanics(t *testing.T) {
	catalog, _ := specs.Load()
	w := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(w, objects.Properties{ObjectProperties: simulation.ObjectProperties{World: w, Position: Vec.Create(12.7, -34.2), Velocity: Vec.Create(0.25, -0.125), Rotation: 0.123}})
	ship.Mounts()[0].Health -= 0.125
	cargo := objects.NewItem("diamond", simulation.ObjectProperties{World: w, Position: Vec.Create(2.2, -3.7)}, catalog)
	ship.CargoContents = append(ship.CargoContents, cargo)
	saved := objects.CaptureEntity(ship)

	if saved.Object.Position != Vec.Create(13, -34) || saved.CargoContents[0].Object.Position != Vec.Create(2, -4) || ship.Position != Vec.Create(12.7, -34.2) || cargo.Position != Vec.Create(2.2, -3.7) {
		t.Fatal("positions were not rounded in an isolated saved copy")
	}

	restored, err := objects.RestoreEntity(saved, w)

	if err != nil {
		t.Fatal(err)
	}

	if restored.Base().Velocity != ship.Velocity || restored.Base().Rotation != ship.Rotation || restored.(*objects.Ship).Mounts()[0].Health != ship.Mounts()[0].Health {
		t.Fatal("rounding changed fractional motion/damage")
	}
}

func BenchmarkCaptureMovementBatch(b *testing.B) {
	catalog, _ := specs.Load()
	w := simulation.CreateWorld(25, catalog)
	entities := []simulation.Entity{objects.CreatePlayerShip(w, objects.Properties{})}

	for i := 0; i < 8; i++ {
		a := simulation.CreateAsteroid(w, simulation.AsteroidProperties{Contents: []int{1, 2}}).LockGeometry()
		a.Segments()[0].Health -= 0.25
		entities = append(entities, a)
	}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		for _, e := range entities {
			objects.CaptureEntity(e)
		}
	}
}

func TestSavedCorralVariants(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)

	for _, id := range []string{"", "corral", "corral-5", "corral-6"} {
		station := objects.CreateStation(objects.Properties{DefinitionID: id, ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)
		saved := objects.CaptureEntity(station)
		saved.Object.DefinitionID = id
		entity, err := objects.RestoreEntity(saved, world)

		if err != nil {
			t.Fatal(err)
		}

		restored := entity.(*objects.Station)
		bays := 1

		if id == "corral-6" {
			bays = 2
		}

		if len(restored.DockingBays) != bays {
			t.Fatalf("%q restored wrong bay count", id)
		}

		if restored.DefinitionID == "corral" {
			t.Fatal("legacy station ID leaked into replication")
		}
	}
}
