package npc

import (
	"fmt"
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

/*
Fast escaping targets need pursuit rather than long lateral flybys. Use normal
ship physics and optional neighboring asteroids, with the pirate initially facing
the player as it does after delivering its cargo demand.
*/
func TestCombatPursuesFastEscapingTargets(t *testing.T) {
	for _, clutter := range []bool{false, true} {
		for _, speed := range []float64{170, 190} {
			for _, heading := range []float64{0, math.Pi / 2} {
				t.Run(fmt.Sprintf("rocks=%v/speed=%g/heading=%.2f", clutter, speed, heading), func(t *testing.T) {
					ship := flightShip(t)
					world := ship.World
					world.ItemTypes = objects.ItemTypes(world.Specification)
					world.Collisions = gameplay.NewGameCollisions(world.Specification)
					ship.Face(heading)
					direction := Vec.Create(math.Cos(heading), math.Sin(heading))
					velocity := Vec.Scale(direction, speed)

					if clutter {
						for index := range 8 {
							y := 155.0

							if index%2 == 1 {
								y = -155
							}

							position := simulation.RotatePoint(Vec.Create(700+float64(index)*600, y), heading)
							rock := simulation.CreateAsteroid(world, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: position, Radius: new(90.0)}, PointCount: 7})
							simulation.AddEntity(world, rock.LockGeometry())
						}
					}

					pilot := &Pilot{}
					thrust, turn := 0.0, 0.0
					excess, finalDistance := 0.0, 0.0
					withoutAim, longestWithoutAim := 0, 0

					for tick := range 30 * 120 {
						target := Vec.Scale(direction, 350+speed*float64(tick)/30)

						if tick%steeringIntervalTicks(ship) == 0 {
							thrust, turn = pilot.Steer(ship, Movement{Position: target, Velocity: velocity, PassDistance: 70, TargetID: 2})
						}

						ship.Fly(thrust, turn)
						simulation.UpdateWorld(world, simulation.UpdateWorldOptions{})
						distance := Vec.Distance(ship.Position, target)
						finalDistance = distance

						if distance < 80 || distance > 1200 || ship.Dead || ship.Stranded() {
							t.Fatalf("pursuit lost safe engagement: time=%g distance=%g dead=%v stranded=%v", float64(tick)/30, distance, ship.Dead, ship.Stranded())
						}

						if tick >= 30*60 {
							excess += max(0, distance-220)
						}

						flight := min(distance/ship.Catalog.ModuleSpecs["cannonSm"].Projectile.Speed, 1)
						aim := Vec.Subtract(Vec.AddScaled(target, Vec.Subtract(velocity, ship.Velocity), flight), ship.Position)
						angle := math.Remainder(math.Atan2(aim.Y, aim.X)-ship.Rotation, 2*math.Pi)
						withoutAim++

						if distance < 700 && math.Abs(angle) < .12 {
							withoutAim = 0
						}

						longestWithoutAim = max(longestWithoutAim, withoutAim)
					}

					t.Logf("final distance=%.1f mean excess lag=%.1f longest without shot=%.1fs", finalDistance, excess/1800, float64(longestWithoutAim)/30)

					if finalDistance > 250 || excess/1800 > 20 || longestWithoutAim > 30*10 {
						t.Fatalf("pursuit remained inefficient: final distance=%.1f mean excess lag=%.1f longest without shot=%.1fs", finalDistance, excess/1800, float64(longestWithoutAim)/30)
					}
				})
			}
		}
	}
}

/*
Run both ships through normal thrust, angular response, drag and collisions.
Changing the target's controls never changes its position or velocity directly.
*/
func pursueMovingShip(t *testing.T, position, velocity Vec.Vector, seconds int, targetControls func(float64, *objects.Ship) (float64, float64), observe func(int, *objects.Ship, *objects.Ship, *Pilot, float64, float64)) int {
	t.Helper()
	ship := flightShip(t)
	world := ship.World
	world.ItemTypes = objects.ItemTypes(world.Specification)
	world.Collisions = gameplay.NewGameCollisions(world.Specification)
	target := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", ObjectProperties: simulation.ObjectProperties{Position: position, Velocity: velocity, PlayerID: new(int64(2))}})
	target.Face(math.Atan2(velocity.Y, velocity.X))
	simulation.AddEntity(world, target)
	ship.Face(math.Atan2(position.Y, position.X))
	pilot := &Pilot{}
	thrust, turn := 0.0, 0.0
	contactEpisodes, lastContact := 0, -30

	for tick := range 30 * seconds {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: target.Position, Velocity: target.Velocity, PassDistance: 70, TargetID: target.ID})
		}

		target.Fly(targetControls(float64(tick)/30, target))
		ship.Fly(thrust, turn)

		hitThisTick := false

		for _, event := range simulation.UpdateWorld(world, simulation.UpdateWorldOptions{}) {
			if hit, ok := event.(protocol.CollisionEvent); ok && (hit.A == ship.ID && hit.B == target.ID || hit.B == ship.ID && hit.A == target.ID) {
				hitThisTick = true
			}
		}

		if hitThisTick {
			if tick-lastContact >= 15 {
				contactEpisodes++
			}

			lastContact = tick
		}

		observe(tick, ship, target, pilot, thrust, turn)
	}

	return contactEpisodes
}

func targetFlight(ship *objects.Ship, speed, heading float64) (float64, float64) {
	forward := Vec.Create(math.Cos(ship.Rotation), math.Sin(ship.Rotation))
	maximum := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass
	thrust := max(0, min(1, (speed*ship.Drag+(speed-Vec.Dot(ship.Velocity, forward))*2)/maximum))
	return thrust, turnInput(ship, math.Remainder(heading-ship.Rotation, 2*math.Pi))
}

func pursuitCanFire(ship, target *objects.Ship) bool {
	distance := Vec.Distance(ship.Position, target.Position)
	flight := min(distance/ship.Catalog.ModuleSpecs["cannonSm"].Projectile.Speed, 1)
	aim := Vec.Subtract(Vec.AddScaled(target.Position, Vec.Subtract(target.Velocity, ship.Velocity), flight), ship.Position)
	angle := math.Remainder(math.Atan2(aim.Y, aim.X)-ship.Rotation, 2*math.Pi)
	return distance < 700 && math.Abs(angle) < .12
}

func TestCombatAvoidsFastApproachingAndCrossingTargets(t *testing.T) {
	for _, scenario := range []struct {
		name               string
		position, velocity Vec.Vector
		clearance          float64
		maxContactEpisodes int
	}{
		// A 32,805-schedule physics search found no 80-unit evasion here. It found
		// no-contact paths at 60.6 units; this case allows one graze and recovery.
		{"head on from180", Vec.Create(180, 0), Vec.Create(-120, 0), 50, 1},
		{"head on from350", Vec.Create(350, 0), Vec.Create(-170, 0), 80, 0},
		{"head on from500", Vec.Create(500, 0), Vec.Create(-190, 0), 80, 0},
		{"crossing", Vec.Create(350, -250), Vec.Create(0, 170), 80, 0},
		{"crossing mirrored", Vec.Create(350, 250), Vec.Create(0, -170), 80, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			closest, furthest, finalDistance := math.Inf(1), 0.0, 0.0
			closestAt := 0.0
			disabled := false
			withoutAim, longestWithoutAim := 0, 0
			heading := math.Atan2(scenario.velocity.Y, scenario.velocity.X)

			contactEpisodes := pursueMovingShip(t, scenario.position, scenario.velocity, 90, func(_ float64, target *objects.Ship) (float64, float64) {
				return targetFlight(target, Vec.Length(scenario.velocity), heading)
			}, func(tick int, ship, target *objects.Ship, _ *Pilot, _, _ float64) {
				distance := Vec.Distance(ship.Position, target.Position)
				disabled = disabled || ship.Dead || ship.Stranded() || target.Dead || target.Stranded()

				if distance < closest {
					closestAt = float64(tick) / 30
				}

				closest, furthest, finalDistance = min(closest, distance), max(furthest, distance), distance
				withoutAim++

				if pursuitCanFire(ship, target) {
					withoutAim = 0
				}

				longestWithoutAim = max(longestWithoutAim, withoutAim)
			})

			t.Logf("contact episodes=%d closest=%.1f at %.1fs furthest=%.1f final distance=%.1f longest without shot=%.1fs disabled=%v", contactEpisodes, closest, closestAt, furthest, finalDistance, float64(longestWithoutAim)/30, disabled)

			if contactEpisodes > scenario.maxContactEpisodes || closest < scenario.clearance || disabled || furthest > 1500 || finalDistance > 300 || longestWithoutAim > 30*30 {
				t.Fatal("fast target was not passed safely and pursued again")
			}
		})
	}
}

func TestCombatDoesNotWobbleAroundFastPursuitThreshold(t *testing.T) {
	passingChanges, reversals, lastSign := 0, 0, 0
	wasPassing := false
	closest, finalDistance := math.Inf(1), 0.0
	withoutAim, longestWithoutAim := 0, 0

	pursueMovingShip(t, Vec.Create(350, 0), Vec.Create(128, 0), 60, func(now float64, target *objects.Ship) (float64, float64) {
		return targetFlight(target, 124+7*math.Sin(now*2*math.Pi/3), 0)
	}, func(tick int, ship, target *objects.Ship, pilot *Pilot, _, turn float64) {
		distance := Vec.Distance(ship.Position, target.Position)
		closest, finalDistance = min(closest, distance), distance
		withoutAim++

		if pursuitCanFire(ship, target) {
			withoutAim = 0
		}

		longestWithoutAim = max(longestWithoutAim, withoutAim)

		if tick%steeringIntervalTicks(ship) == 0 && tick > 30*5 {
			if pilot.passing != wasPassing {
				passingChanges++
			}

			wasPassing = pilot.passing

			if math.Abs(turn) > .1 {
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
	})

	t.Logf("passing changes=%d steering reversals=%d closest=%.1f final distance=%.1f longest without shot=%.1fs", passingChanges, reversals, closest, finalDistance, float64(longestWithoutAim)/30)

	if passingChanges > 6 || reversals > 6 || closest < 80 || finalDistance > 300 || longestWithoutAim > 30*15 {
		t.Fatal("small changes in target speed repeatedly disrupted pursuit")
	}
}

func TestCombatRecoversAfterAPlayerTurnsBack(t *testing.T) {
	closest, furthest, finalDistance := math.Inf(1), 0.0, 0.0
	withoutAim, longestWithoutAim := 0, 0

	pursueMovingShip(t, Vec.Create(350, 0), Vec.Create(170, 0), 90, func(now float64, target *objects.Ship) (float64, float64) {
		heading := 0.0

		if now >= 20 {
			heading = math.Pi
		}

		return targetFlight(target, 170, heading)
	}, func(_ int, ship, target *objects.Ship, _ *Pilot, _, _ float64) {
		distance := Vec.Distance(ship.Position, target.Position)
		closest, furthest, finalDistance = min(closest, distance), max(furthest, distance), distance
		withoutAim++

		if pursuitCanFire(ship, target) {
			withoutAim = 0
		}

		longestWithoutAim = max(longestWithoutAim, withoutAim)
	})

	t.Logf("closest=%.1f furthest=%.1f final distance=%.1f longest without shot=%.1fs", closest, furthest, finalDistance, float64(longestWithoutAim)/30)

	if closest < 80 || furthest > 1500 || finalDistance > 300 || longestWithoutAim > 30*30 {
		t.Fatal("physical direction reversal broke safe pursuit")
	}
}
