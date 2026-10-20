package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

/*
An unobstructed trip should use the ordinary engine's full thrust until passive
coasting can reach the destination. Changing drag must change that coasting plan.
*/
func TestPilotUsesFullThrustAndCoastsToDistantDestinations(t *testing.T) {
	for _, drag := range []float64{.3, 5.0 / 9, 1} {
		t.Run(fmt.Sprint(drag), func(t *testing.T) {
			ship := flightShip(t)
			ship.Drag = drag
			ship.World.Collisions = gameplay.NewGameCollisions(ship.Catalog)
			target := Vec.Create(2500, 0)
			pilot := Pilot{}
			thrust, turn := 0., 0.
			cruising, partialCruising, coasting := 0, 0, 0
			arrived := math.Inf(1)
			overshoot := 0.

			for tick := range 30 * 35 {
				distance := Vec.Distance(ship.Position, target)
				speed := Vec.Length(ship.Velocity)
				stoppingDistance := speed / drag

				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Steer(ship, Movement{Position: target})

					if distance > max(700, stoppingDistance*1.5+100) {
						cruising++

						if thrust < .99 {
							partialCruising++
						}
					}
				}

				if distance > 30 && distance < stoppingDistance*1.5 && speed > ship.MaxSpeed()*.2 && thrust < .01 {
					coasting++
				}

				ship.Fly(thrust, turn)
				simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
				overshoot = max(overshoot, ship.Position.X-target.X)

				if Vec.Distance(ship.Position, target) < 12 && Vec.Length(ship.Velocity) < 3 {
					arrived = min(arrived, float64(tick)/30)
				}
			}

			t.Logf("drag=%.3f full-power decisions=%d/%d coast ticks=%d arrival=%.2fs overshoot=%.1f final distance=%.1f", drag, cruising-partialCruising, cruising, coasting, arrived, overshoot, Vec.Distance(ship.Position, target))

			if cruising < 15 || partialCruising > 0 || coasting < 15 || arrived > 2500/ship.MaxSpeed()+5/drag+2 || overshoot > 20 || Vec.Distance(ship.Position, target) > 12 {
				t.Fatal("clear travel did not combine full thrust with a controlled coasting arrival")
			}
		})
	}
}

func TestPilotUsesFullThrustToCatchADistantMovingTarget(t *testing.T) {
	ship := flightShip(t)
	ship.World.Collisions = gameplay.NewGameCollisions(ship.Catalog)
	pilot := Pilot{}
	velocity := Vec.Create(120, 0)
	thrust, turn := 0., 0.
	cruising, partialCruising := 0, 0
	finalDistance := 0.

	for tick := range 30 * 30 {
		now := float64(tick) / 30
		target := Vec.AddScaled(Vec.Create(1500, 0), velocity, now)

		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: target, Velocity: velocity, FollowDistance: 140, TargetID: 2})

			if Vec.Distance(ship.Position, target) > 700 {
				cruising++

				if thrust < .99 {
					partialCruising++
				}
			}
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
		finalDistance = Vec.Distance(ship.Position, target)
	}

	t.Logf("full-power decisions=%d/%d final following distance=%.1f", cruising-partialCruising, cruising, finalDistance)

	if cruising < 15 || partialCruising > 0 || finalDistance > 200 || finalDistance < 80 {
		t.Fatal("distant target pursuit did not use the available thrust and settle into following")
	}
}
