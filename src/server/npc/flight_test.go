package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

/*
Exercise real angular acceleration, drag, thrust, power and fuel at the AI's 5 Hz decision rate.
*/
func flyPilot(ship *objects.Ship, pilot *Pilot, ticks int, destination func(float64) Movement, observe func(int, float64, float64)) {
	thrust, turn := 0.0, 0.0

	for tick := 0; tick < ticks; tick++ {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, destination(float64(tick)/30))
		}

		ship.Fly(thrust, turn)
		ship.Update(1.0 / 30)
		ship.World.Tick++
		observe(tick, thrust, turn)
	}
}

func flightShip(t *testing.T) *objects.Ship {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)
	return ship
}

func TestWaitingPirateFacesPlayerWithoutThrusting(t *testing.T) {
	for _, heading := range []float64{-math.Pi + .01, -math.Pi / 2, 0, math.Pi / 2} {
		ship := flightShip(t)
		ship.Face(heading)
		ship.Velocity = Vec.Create(12, -5)
		ship.Spin = 0.3
		pilot := &Pilot{}

		targetAt := func(now float64) Vec.Vector {
			if now < 8 {
				return Vec.Create(300, 0)
			}

			return Vec.Create(0, 300)
		}

		flyPilot(ship, pilot, 30*20, func(now float64) Movement {
			return Movement{Position: targetAt(now), Waiting: true}
		}, func(tick int, thrust, turn float64) {
			if thrust != 0 {
				t.Fatal("waiting pirate used forward thrust")
			}

			if tick > 300 && Vec.Length(ship.Velocity) != 0 {
				t.Fatal("waiting ship did not stop drifting")
			}

			now := float64(tick) / 30

			if now >= 4 && now < 8 || now >= 12 {
				offset := Vec.Subtract(targetAt(now), ship.Position)
				angle := math.Remainder(math.Atan2(offset.Y, offset.X)-ship.Rotation, 2*math.Pi)

				if math.Abs(angle) > .03 {
					t.Fatalf("waiting pirate did not face player: heading=%g time=%g error=%g", heading, now, angle)
				}
			}

			if now > 14 && (turn != 0 || math.Abs(ship.Spin) > .001) {
				t.Fatal("waiting pirate kept turning after facing the player")
			}
		})
	}
}

func TestPilotCommitsToAnAsteroidDetour(t *testing.T) {
	for _, y := range []float64{-50, 0, 50} {
		ship := flightShip(t)
		ship.Position.Y = y
		obstacle := simulation.NewGameObject(simulation.ObjectProperties{World: ship.World, ID: new(int64(99)), Position: Vec.Create(500, 0), Radius: new(160.0)}, ship.Catalog.Simulation)
		obstacle.Kind = "asteroid"
		simulation.AddEntity(ship.World, obstacle)
		pilot := &Pilot{}
		target := Vec.Create(1000, 0)
		reached, turns := false, 0
		lastSign := 0

		flyPilot(ship, pilot, 30*25, func(float64) Movement { return Movement{Position: target} }, func(tick int, thrust, turn float64) {
			for _, collider := range ship.HitboxColliding() {
				if collider.Physics != nil && !*collider.Physics || collider.PickupPoint {
					continue
				}

				shape := query.ShapeData{Position: collider.GetPosition(), Rotation: collider.GetRotation(), Radius: collider.GetRadius(), Outline: collider.ShapeOutline, CollisionMargin: collider.CollisionMargin}

				if _, contact := query.ContactBetween(shape, query.ShapeData{Position: obstacle.Position, Radius: obstacle.Radius}, ship.Catalog.Simulation.LinearSlop); contact {
					t.Fatalf("detour crossed asteroid hull, start y=%g tick=%d", y, tick)
				}
			}

			if Vec.Distance(ship.Position, target) < 30 {
				reached = true
			}

			if tick%steeringIntervalTicks(ship) == 0 && math.Abs(turn) > .05 {
				sign := 1

				if turn < 0 {
					sign = -1
				}

				if lastSign != 0 && sign != lastSign {
					turns++
				}

				lastSign = sign
			}
		})

		if !reached || turns > 4 {
			t.Fatalf("detour did not finish smoothly, start y=%g reached=%v steering reversals=%d", y, reached, turns)
		}
	}
}

func TestCombatUsesItsThrusterAcrossCommittedRuns(t *testing.T) {
	ship := flightShip(t)
	pilot := &Pilot{}
	speedLimit, engineThrust := ship.MaxSpeed(), ship.ForwardThrust()
	powered, turnOnly := 0, 0
	totalSpeed := 0.0
	closest := math.Inf(1)

	flyPilot(ship, pilot, 30*60, func(now float64) Movement {
		return Movement{Position: Vec.Create(350+120*math.Cos(now*.18), 120*math.Sin(now*.18)), PassDistance: 70, TargetID: 2}
	}, func(tick int, thrust, turn float64) {
		now := float64(tick) / 30
		enemy := Vec.Create(350+120*math.Cos(now*.18), 120*math.Sin(now*.18))
		closest = min(closest, Vec.Distance(ship.Position, enemy))

		if tick <= 300 {
			return
		}

		if thrust > .3 {
			powered++
		}

		if thrust < .05 && math.Abs(turn) > .1 {
			turnOnly++
		}

		totalSpeed += Vec.Length(ship.Velocity)
	})

	if powered < 1100 || turnOnly > 225 || totalSpeed/1499 < speedLimit*.6 {
		t.Fatalf("combat still stalls: powered=%d turning without thrust=%d average speed=%g", powered, turnOnly, totalSpeed/1499)
	}

	if closest < 80 {
		t.Fatalf("attack runs rammed the target: closest distance=%g", closest)
	}

	if ship.MaxSpeed() != speedLimit || ship.ForwardThrust() != engineThrust {
		t.Fatal("AI changed engine performance instead of using normal controls")
	}
}

func TestCombatStaysEngagedWithStationaryAndMovingTargets(t *testing.T) {
	for _, separation := range []float64{350, 1000} {
		for _, velocity := range []Vec.Vector{Vec.Create(0, 0), Vec.Create(120, 0), Vec.Create(-120, 0), Vec.Create(0, 120)} {
			for _, heading := range []float64{0, math.Pi / 2, math.Pi} {
				t.Run(fmt.Sprintf("distance=%g/velocity=%v/heading=%.2f", separation, velocity, heading), func(t *testing.T) {
					ship := flightShip(t)
					ship.Face(heading)
					pilot := &Pilot{}
					inRange, withoutAim := 0, 0

					targetAt := func(now float64) Vec.Vector { return Vec.AddScaled(Vec.Create(separation, 0), velocity, now) }

					flyPilot(ship, pilot, 30*120, func(now float64) Movement {
						return Movement{Position: targetAt(now), Velocity: velocity, PassDistance: 70, TargetID: 2}
					}, func(tick int, _, _ float64) {
						target := targetAt(float64(tick) / 30)
						distance := Vec.Distance(ship.Position, target)

						if distance > 1200 {
							t.Fatalf("attack run flew away from the target: distance=%g time=%g", distance, float64(tick)/30)
						}

						if distance < 80 {
							t.Fatalf("attack run rammed the target: distance=%g time=%g", distance, float64(tick)/30)
						}

						if distance < 700 {
							inRange++
						}

						// Use the cannon's actual lead and firing cone, not just the target bearing.
						flight := min(distance/ship.Catalog.ModuleSpecs["cannonSm"].Projectile.Speed, 1)
						aim := Vec.Subtract(Vec.AddScaled(target, Vec.Subtract(velocity, ship.Velocity), flight), ship.Position)
						angle := math.Remainder(math.Atan2(aim.Y, aim.X)-ship.Rotation, 2*math.Pi)
						withoutAim++

						if distance < 700 && math.Abs(angle) < .12 {
							withoutAim = 0
						}

						if withoutAim > 30*20 {
							t.Fatal("attack runs stopped lining up shots")
						}
					})

					if inRange < 30*120*.8 {
						t.Fatalf("attack runs spent too long outside cannon range: %g%% in range", float64(inRange)/36)
					}
				})
			}
		}
	}
}

func TestSearchFliesAnExpandingSpiral(t *testing.T) {
	ship := flightShip(t)
	search := &Search{Origin: ship.Position, Heading: ship.Rotation}
	pilot := &Pilot{}
	traveled, previousAngle, previousRadius := 0.0, 0.0, 0.0
	reversals, lastSign := 0, 0
	moving := 0

	flyPilot(ship, pilot, 30*100, func(float64) Movement { return search.Movement(ship) }, func(tick int, thrust, turn float64) {
		offset := Vec.Subtract(ship.Position, search.Origin)
		angle, radius := math.Atan2(offset.Y, offset.X), Vec.Length(offset)

		if tick > 120 {
			traveled += math.Remainder(angle-previousAngle, 2*math.Pi)

			if Vec.Length(ship.Velocity) > 20 {
				moving++
			}

			if tick%steeringIntervalTicks(ship) == 0 && math.Abs(turn) > 0.05 {
				sign := 1

				if turn < 0 {
					sign = -1
				}

				if lastSign != 0 && sign != lastSign {
					reversals++
				}

				lastSign = sign
			}
		}

		if tick == 30*25 {
			previousRadius = radius
		}

		previousAngle = angle
	})

	radius := Vec.Distance(ship.Position, search.Origin)

	if traveled < 2*math.Pi || radius < previousRadius+250 || moving < 2400 || reversals > 10 {
		t.Fatalf("search did not expand smoothly: turns=%g radius=%g earlyRadius=%g moving=%d reversals=%d", traveled/(2*math.Pi), radius, previousRadius, moving, reversals)
	}
}

func TestPilotReachesReportedLocation(t *testing.T) {
	ship := flightShip(t)
	pilot := &Pilot{}
	target := Vec.Create(300, 0)
	closest := math.Inf(1)

	flyPilot(ship, pilot, 30*20, func(float64) Movement { return Movement{Position: target} }, func(int, float64, float64) {
		closest = min(closest, Vec.Distance(ship.Position, target))
	})

	if closest > 10 {
		t.Fatalf("pilot stopped short of the reported location: %g", closest)
	}
}
