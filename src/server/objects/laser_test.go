package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

func TestLaserContinuousDamage(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, rotation := range []float64{0, math.Pi / 2, math.Pi} {
		world := simulation.CreateWorld(25, catalog)
		playerID := int64(1)
		ship := CreatePlayerShip(world, Properties{PlayerID: &playerID})
		simulation.AddEntity(world, ship)
		ship.Rotation = rotation
		laser := modules.Create("laser", simulation.ObjectProperties{World: world}, catalog)

		for _, mount := range ship.Mounts() {
			if slices.Contains(mount.Fits, "laser") {
				ship.Fit(laser, mount)
				break
			}
		}

		if laser.ModuleBase().Mount == nil {
			t.Fatal("laser must fit an existing weapon mount")
		}

		y := laser.ModuleBase().Mount.LocalPosition.Y
		health := 100.0
		near := NewItem("gold", simulation.ObjectProperties{World: world, Position: simulation.RotatePoint(Vec.Create(150, y), rotation), Health: &health}, catalog)
		far := NewItem("gold", simulation.ObjectProperties{World: world, Position: simulation.RotatePoint(Vec.Create(250, y), rotation), Health: &health}, catalog)
		simulation.AddEntity(world, near)
		simulation.AddEntity(world, far)
		events := []protocol.SimulationEvent{}
		ship.Control(protocol.Input{LaserActive: true, Fire: true}, &events)
		ship.ResolveLasers(1, &events)

		if near.Health != 100 {
			t.Fatal("deployment must not damage targets")
		}

		ship.UpdateModules(.5)

		for tick := 0; tick < 30; tick++ {
			simulation.UpdateEntities(world, simulation.UpdateEntitiesOptions{Events: &events})
		}

		var hits []protocol.LaserDamage

		for _, event := range events {
			if hit, ok := event.(protocol.LaserDamage); ok {
				hits = append(hits, hit)
				want := simulation.RotatePoint(Vec.Create(near.Position.X, near.Position.Y), -rotation)
				point := simulation.RotatePoint(hit.Position, -rotation)

				if math.Abs(hit.Damage-.1) > 1e-8 || hit.TargetID != near.ID || point.X >= want.X || point.X < want.X-near.Radius-2 || math.Abs(point.Y-y) > 1e-5 {
					t.Fatalf("beam event must identify damage at the first contact: %+v", hit)
				}
			}
		}

		if len(hits) != 30 {
			t.Fatalf("steady fire must damage once per tick, got %d events", len(hits))
		}

		if math.Abs(near.Health-97) > 1e-8 || far.Health != 100 {
			t.Fatalf("nearest target must receive 3 damage/second at rotation %v: %v %v", rotation, near.Health, far.Health)
		}

		world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
			if entity.Base().Kind == "projectile" {
				t.Fatal("laser must not create projectiles")
			}
		})

		ship.Firing = false
		ship.ResolveLasers(1, &events)

		if math.Abs(near.Health-97) > 1e-8 {
			t.Fatal("release must stop damage")
		}

		ship.Firing = true
		ship.SetModuleActive("laser", false)
		ship.ResolveLasers(1, &events)

		if math.Abs(near.Health-97) > 1e-8 {
			t.Fatal("retraction must stop damage")
		}
	}
}
