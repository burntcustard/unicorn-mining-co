package objects

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestProjectileStationInterior(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, weapon := range []string{"autogun", "plasmaAccelerator"} {
		for _, mode := range []string{"hull", "module", "ship", "nearerImpact"} {
			t.Run(weapon+"/"+mode, func(t *testing.T) {
				world := simulation.CreateWorld(1, catalog)

				station := newStation(Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, []*simulation.SegmentPlan{{
					DisablePhysics: true,
					Health:         new(100.0),
					Points:         &simulation.ShapeOutline{Points: []simulation.Point{{40, -20}, {60, -20}, {60, 20}, {40, 20}}},
				}}, catalog)

				simulation.AddEntity(world, station)

				if mode == "module" {
					station.Segments[0].Hull = false
				}

				if mode == "ship" {
					station.Kind = "ship"
				}

				x, health := 80.0, 100.0

				if mode == "nearerImpact" {
					x = 20
				}

				target := simulation.NewGameObject(simulation.ObjectProperties{World: world, Position: Vec.Create(x, 0), Radius: new(5.0), Health: &health}, catalog.Simulation)
				simulation.AddEntity(world, target)
				hullHealth := station.Segments[0].Health
				shot := NewProjectile(weapon, simulation.ObjectProperties{World: world, Velocity: Vec.Create(1000, 0)}, catalog)
				simulation.AddEntity(world, shot)
				shot.CaptureSweep()
				shot.Update(0.1)
				events := []protocol.SimulationEvent{}
				shot.ResolveHits(&events, world, 0.1)

				if _, exists := world.Entities.Get(shot.ID); !shot.Dead || exists {
					t.Fatal("hits must remove the projectile")
				}

				if mode == "hull" {
					if len(events) != 0 || station.Segments[0].Health != hullHealth || target.Health != health || target.Velocity != (Vec.Vector{}) {
						t.Fatal("station interiors must absorb projectiles without events, damage, or explosion impulses")
					}
				} else {
					if len(events) == 0 {
						t.Fatal("other nonphysical segments must be ignored and earlier physical impacts must resolve")
					}

					hit, ok := events[0].(protocol.CollisionEvent)

					if !ok || hit.B != target.ID {
						t.Fatal("the physical target must receive the impact")
					}
				}
			})
		}
	}
}
