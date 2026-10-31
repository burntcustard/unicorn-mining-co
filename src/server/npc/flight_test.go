package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

/*
Exercise real angular acceleration, drag, thrust, power and fuel at the AI's 5 Hz decision rate.
*/
func flyPilot(ship *objects.Ship, ticks int, controls func(float64) (float64, float64), observe func(int, float64, float64)) {
	thrust, turn := 0.0, 0.0

	for tick := 0; tick < ticks; tick++ {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = controls(float64(tick) / 30)
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

		flyPilot(ship, 30*20, func(now float64) (float64, float64) {
			return pilot.Steer(ship, Movement{Position: targetAt(now), Waiting: true})
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

/*
Repeated pickup approaches need prompt heading changes at the ordinary decision
rate. Exercise both hulls and adverse initial spin through their real engines,
then keep observing so a fast turn cannot pass by continually overshooting.
*/
func TestCollectionTurnInputTurnsPromptlyAndSettles(t *testing.T) {
	for _, definition := range []string{"courser", "finch"} {
		for _, heading := range []float64{-.15, -math.Pi + .01, -math.Pi / 2, math.Pi / 2, math.Pi - .01} {
			for _, spin := range []float64{-.3, .3} {
				t.Run(fmt.Sprintf("%s/heading%g/spin%g", definition, heading, spin), func(t *testing.T) {
					ship := arrivalShip(t, definition)
					ship.Face(heading)
					ship.Spin = spin
					maximum := ship.TurnRate * ship.RotationalThrust() / ship.Rules.Flight.SpinDivisor
					deadline := math.Abs(heading)/maximum + .9
					reversals, previous := 0, 0.0

					flyPilot(ship, 30*5, func(float64) (float64, float64) {
						return 0, collectionTurnInput(ship, math.Remainder(-ship.Rotation, 2*math.Pi))
					}, func(tick int, thrust, turn float64) {
						if thrust != 0 || math.Abs(turn) > 1 {
							t.Fatalf("heading change used invalid flight controls: thrust=%g turn=%g", thrust, turn)
						}

						if tick%steeringIntervalTicks(ship) == 0 && math.Abs(turn) > .1 {
							if previous*turn < 0 {
								reversals++
							}

							previous = turn
						}

						if float64(tick+1)/30 >= deadline {
							angle := math.Remainder(ship.Rotation, 2*math.Pi)

							if math.Abs(angle) > .035 || math.Abs(ship.Spin) > .08 {
								t.Fatalf("turn did not settle promptly: deadline=%g time=%g error=%g spin=%g", deadline, float64(tick+1)/30, angle, ship.Spin)
							}
						}
					})

					if reversals > 1 {
						t.Fatalf("heading change kept reversing its turn: reversals=%d", reversals)
					}
				})
			}
		}
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

		flyPilot(ship, 30*25, func(float64) (float64, float64) { return pilot.Steer(ship, Movement{Position: target}) }, func(tick int, thrust, turn float64) {
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

	flyPilot(ship, 30*60, func(now float64) (float64, float64) {
		return pilot.Steer(ship, Movement{Position: Vec.Create(350+120*math.Cos(now*.18), 120*math.Sin(now*.18)), PassDistance: 70, TargetID: 2})
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

	// Allow small tuning changes to shift turn boundaries without permitting
	// sustained coasting or weakening the powered-flight and speed checks.
	if powered < 1100 || turnOnly > 250 || totalSpeed/1499 < speedLimit*.6 {
		t.Fatalf("combat still stalls: powered=%d turning without thrust=%d average speed=%g", powered, turnOnly, totalSpeed/1499)
	}

	if closest < 80 {
		t.Fatalf("attack runs rammed the target: closest distance=%g", closest)
	}

	if ship.MaxSpeed() != speedLimit || ship.ForwardThrust() != engineThrust {
		t.Fatal("AI changed engine performance instead of using normal controls")
	}
}

func TestPursuitMemoryFollowsOnlyTheCurrentCombatTarget(t *testing.T) {
	ship := flightShip(t)
	pilot := Pilot{}
	ship.World.Tick = 100
	target := Movement{Position: Vec.Create(1000, 0), Velocity: Vec.Create(ship.MaxSpeed()*.5, 0), PassDistance: 70, TargetID: 90}

	steer := func(movement Movement, pursuing bool) {
		t.Helper()
		thrust, turn := pilot.Steer(ship, movement)

		if (pilot.chaseUntil != 0) != pursuing || math.IsNaN(thrust) || math.IsNaN(turn) {
			t.Fatalf("unexpected pursuit state: target=%d tick=%d deadline=%d controls=(%g,%g)", movement.TargetID, ship.World.Tick, pilot.chaseUntil, thrust, turn)
		}
	}

	steer(target, true)
	deadline := pilot.chaseUntil
	steer(Movement{Position: target.Position, Waiting: true}, true)
	ship.World.Tick = deadline + 1
	target.Velocity.X = ship.MaxSpeed() * .15
	// A continuing target refreshes pursuit before expiry after a dialogue pause.
	steer(target, true)

	target.Velocity = Vec.Vector{}
	ship.World.Tick++
	steer(target, true)
	ship.World.Tick = pilot.chaseUntil + 1
	steer(target, false)

	target.Velocity.X = ship.MaxSpeed() * .5
	steer(target, true)
	target.TargetID++
	target.Velocity.X = ship.MaxSpeed() * .15
	steer(target, false)

	target.Velocity.X = ship.MaxSpeed() * .5
	steer(target, true)
	steer(Movement{Position: target.Position, TargetID: target.TargetID, FollowDistance: 70}, false)
	target.Velocity.X = ship.MaxSpeed() * .15
	steer(target, false)
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

					flyPilot(ship, 30*120, func(now float64) (float64, float64) {
						return pilot.Steer(ship, Movement{Position: targetAt(now), Velocity: velocity, PassDistance: 70, TargetID: 2})
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

	flyPilot(ship, 30*100, func(float64) (float64, float64) { return pilot.Search(ship, search) }, func(tick int, thrust, turn float64) {
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

	flyPilot(ship, 30*20, func(float64) (float64, float64) { return pilot.Steer(ship, Movement{Position: target}) }, func(int, float64, float64) {
		closest = min(closest, Vec.Distance(ship.Position, target))
	})

	if closest > 10 {
		t.Fatalf("pilot stopped short of the reported location: %g", closest)
	}
}

/*
Match network decisions to the first simulation tick after the configured delay.
For example, a 0.25-second delay at 30 Hz holds each input for eight ticks.
*/
func steeringIntervalTicks(ship *objects.Ship) int {
	return max(1, int(math.Ceil((ship.Catalog.NPCMovement.DecisionInterval-1e-9)/ship.Catalog.Simulation.SimulationStep)))
}

func TestMovementAcceleratesThroughBroadTurns(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)

	for _, angle := range []float64{-1, -0.6, 0, 0.6, 1} {
		thrust, turn := new(Pilot).Steer(ship, Movement{Position: Vec.Create(1000*math.Cos(angle), 1000*math.Sin(angle))})

		if thrust < 0.6 || angle*turn < 0 {
			t.Fatalf("broad turn %g stopped forward movement: thrust=%g turn=%g", angle, thrust, turn)
		}
	}
}

func TestCombatPassKeepsMovingAtCloseRange(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)
	thrust, turn := new(Pilot).Steer(ship, Movement{Position: Vec.Create(180, 0), PassDistance: 70})

	if thrust < 0.6 || turn <= 0 {
		t.Fatalf("combat ship parked instead of making a passing attack: thrust=%g turn=%g", thrust, turn)
	}
}

func TestNearestEnemySwitchesBetweenHostilePlayers(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	first := objects.CreatePlayerShip(world, objects.Properties{PlayerID: new(int64(2)), Position: Vec.Create(100, 0)})
	second := objects.CreatePlayerShip(world, objects.Properties{PlayerID: new(int64(3)), Position: Vec.Create(200, 0)})

	for _, other := range []*objects.Ship{ship, first, second} {
		simulation.AddEntity(world, other)
		simulation.AddPlayer(world, simulation.Player{ID: *other.PlayerID, ShipID: other.ID})
	}

	hostile := map[int64]bool{2: true, 3: true}

	if NearestEnemy(ship, hostile) != first {
		t.Fatal("did not choose the nearer hostile player")
	}

	second.Position.X = 50

	if NearestEnemy(ship, hostile) != second {
		t.Fatal("did not switch to a closer attacker")
	}

	first.Position.X = 25

	if NearestEnemy(ship, hostile) != first {
		t.Fatal("original victim was not compared with the attacker")
	}

	first.DockedTo = new(int64(99))

	if NearestEnemy(ship, hostile) != second {
		t.Fatal("docked player remained a combat target")
	}

	second.Position.X = 2000

	if NearestEnemy(ship, hostile) != nil || !hostile[3] {
		t.Fatal("an unseen enemy must retain hostility without revealing its position")
	}
}

func TestMovementAvoidsUncollectableCargo(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)

	for range ship.CargoSpace {
		ship.CargoContents = append(ship.CargoContents, objects.NewItem("gold", simulation.ObjectProperties{World: world}, catalog))
	}

	item := objects.NewItem("gold", simulation.ObjectProperties{World: world, Position: Vec.Create(150, 0)}, catalog)
	simulation.AddEntity(world, item)
	_, turn := new(Pilot).Steer(ship, Movement{Position: Vec.Create(1000, 0)})

	if math.Abs(turn) < 0.1 {
		t.Fatal("full ship would drive through loose cargo")
	}
}

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

func TestCollectorBrakesForPickupNearOperatingBoundary(t *testing.T) {
	ship := arrivalShip(t, "finch")
	collectionThroat(t, ship)
	center := Vec.Create(500, -200)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Add(center, Vec.Create(2903, -9433))}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	ship.Position = Vec.Add(center, Vec.Create(2970.6, -9192.4))
	ship.Velocity = Vec.Create(165.1, -20.7)
	ship.Face(-.02)

	// Reproduce the outward turn after the previous pickup, with normal ship
	// physics and the real side hatches. Nearby scenery is not needed here.
	radius := 10000.0
	step := ship.Catalog.Simulation.SimulationStep
	deadline := int(math.Ceil(60 / step))
	pilot := &Pilot{}
	thrust, turn := 0.0, 0.0

	for tick := range deadline {
		if tick%steeringIntervalTicks(ship) == 0 {
			movement := Movement{Position: item.Position, Velocity: item.Velocity, IgnoreID: item.ID, Collect: true}
			thrust, turn = pilot.SteerWithin(ship, movement, center, radius)
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

		if Vec.DistanceSquared(ship.Position, center) > radius*radius {
			t.Fatalf("collector flew out of its work area before pickup: position=%v", ship.Position)
		}

		if slices.Contains(ship.CargoContents, simulation.Entity(item)) {
			return
		}
	}

	t.Fatalf("collector did not finish the boundary pickup: position=%v item=%v", ship.Position, item.Position)
}

/*
Both NPC hulls must enter an ordinary rotating station without striking its
walls. Keep real thrust, turning, local movement, contacts and the 5 Hz pilot.
*/
func TestDockingDifferentShipsAcrossApproaches(t *testing.T) {
	for _, stationDefinition := range []string{"corral-5", "corral-6"} {
		for _, definition := range []string{"finch", "courser"} {
			for _, spin := range []float64{-.03, 0, .03} {
				for _, scenario := range []struct {
					name               string
					position, velocity Vec.Vector
					heading, rotation  float64
				}{
					{"inherited", Vec.Create(500, -200), Vec.Create(-75, -67), -1.63, -.5},
					{"inbound", Vec.Create(1000, -250), Vec.Create(-180, 70), math.Pi, .3},
					{"crossing", Vec.Create(650, 0), Vec.Create(-60, 140), math.Pi / 2, 0},
					{"far-side", Vec.Create(-1000, 150), Vec.Create(160, -70), -.4, .6},
				} {
					t.Run(fmt.Sprintf("%s/%s/spin%g/%s", stationDefinition, definition, spin, scenario.name), func(t *testing.T) {
						ship := arrivalShip(t, definition)
						ship.Position, ship.Velocity = scenario.position, scenario.velocity
						ship.Face(scenario.heading)
						station := objects.CreateStation(objects.Properties{DefinitionID: stationDefinition, ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Radius: new(400.), Spin: spin, Rotation: scenario.rotation}}, ship.Catalog)
						simulation.AddEntity(ship.World, station)
						contacts := &stationWallContacts{GameCollisions: gameplay.NewGameCollisions(ship.Catalog), ship: ship.ID, station: station.ID}
						ship.World.Collisions = contacts

						if station.Holds(ship) {
							ship.LocalMovementParent, ship.LocalMovementRate = station, 1
						}

						pilot := Pilot{}
						health := ship.HullHealthTotal()
						modules := map[*simulation.Mount]float64{}

						for _, segment := range ship.Segments {
							for _, mount := range segment.Mounts {
								if mount.Module != nil {
									modules[mount] = mount.Health
								}
							}
						}

						thrust, turn := 0., 0.
						var events []protocol.SimulationEvent

						for tick := range 30 * 25 {
							if tick%steeringIntervalTicks(ship) == 0 {
								thrust, turn = pilot.Steer(ship, pilot.ReturnMovement(ship, Movement{Position: station.Position, TargetID: station.ID}))
							}

							ship.Control(protocol.Input{Thrust: thrust, Turn: turn}, &events)
							events = events[:0]
							simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

							if ship.DockedTo != nil {
								t.Logf("docked in %.2fs", float64(tick+1)/30)
								break
							}
						}

						if contacts.touches > 0 {
							t.Errorf("docking touched station wall %d times, first point=%v", contacts.touches, contacts.first.Point)
						}

						if ship.DockedTo == nil || *ship.DockedTo != station.ID || ship.HullHealthTotal() != health {
							t.Fatalf("unsafe or incomplete docking: docked=%v hull=%g/%g position=%v velocity=%v", ship.DockedTo, ship.HullHealthTotal(), health, ship.Position, ship.Velocity)
						}

						for mount, health := range modules {
							if mount.Module == nil || mount.Health != health {
								t.Fatalf("docking damaged an installed module: %g/%g", mount.Health, health)
							}
						}
					})
				}
			}
		}
	}
}

/*
A nearby ship can make general waiting avoidance choose an escape burn. During
the committed docking turn, station walls are omitted from circular navigation,
so that override must not turn a safe coast into powered sideways entry.
*/
func TestDockingAlignmentCoastsWhenTrafficApproaches(t *testing.T) {
	for _, definition := range []string{"finch", "courser"} {
		t.Run(definition, func(t *testing.T) {
			ship := arrivalShip(t, definition)
			ship.Position = Vec.Create(500, 0)
			ship.Face(math.Pi / 2)
			station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Radius: new(400.)}}, ship.Catalog)
			simulation.AddEntity(ship.World, station)
			ship.LocalMovementParent, ship.LocalMovementRate = station, 1
			traffic := objects.CreatePlayerShip(ship.World, objects.Properties{DefinitionID: "courser", ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(680, 0), Velocity: Vec.Create(-160, 0), Rotation: math.Pi, PlayerID: new(int64(2))}})
			simulation.AddEntity(ship.World, traffic)
			pilot := Pilot{}
			thrust, turn := pilot.Steer(ship, pilot.ReturnMovement(ship, Movement{Position: station.Position, TargetID: station.ID}))

			if thrust != 0 || turn <= 0 {
				t.Fatalf("docking alignment did not coast while facing inward: thrust=%g turn=%g", thrust, turn)
			}
		})
	}
}

/*
Docking completes on physical contact with the core, so a centered approach can
keep its engine powered through the bay instead of coasting toward a full stop.
*/
func TestDockingPowersThroughAlignedCorridor(t *testing.T) {
	for _, definition := range []string{"courser", "finch"} {
		t.Run(definition, func(t *testing.T) {
			ship := arrivalShip(t, definition)
			ship.Position, ship.Velocity = Vec.Create(500, 0), Vec.Create(-180, 0)
			ship.Face(math.Pi)
			station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Radius: new(400.)}}, ship.Catalog)
			simulation.AddEntity(ship.World, station)
			contacts := &stationWallContacts{GameCollisions: gameplay.NewGameCollisions(ship.Catalog), ship: ship.ID, station: station.ID}
			ship.World.Collisions = contacts
			ship.LocalMovementParent, ship.LocalMovementRate = station, 1
			primeContactForecast(ship)
			pilot := Pilot{}
			health := ship.HullHealthTotal()
			modules := map[*simulation.Mount]float64{}

			for _, segment := range ship.Segments {
				for _, mount := range segment.Mounts {
					if mount.Module != nil {
						modules[mount] = mount.Health
					}
				}
			}

			thrust, turn := 0., 0.
			poweredNearCore := false
			var events []protocol.SimulationEvent

			for tick := range 30 * 4 {
				if tick%steeringIntervalTicks(ship) == 0 {
					movement := pilot.DockingMovement(ship, station)
					thrust, turn = pilot.Steer(ship, movement)

					if movement.controls == nil || thrust < .999 {
						t.Fatalf("aligned docking entry reduced thrust: position=%v flyThrough=%v thrust=%g", ship.Position, movement.controls != nil, thrust)
					}

					poweredNearCore = poweredNearCore || ship.Position.X < 300
				}

				ship.Control(protocol.Input{Thrust: thrust, Turn: turn}, &events)
				events = events[:0]
				simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

				if ship.DockedTo != nil {
					break
				}
			}

			if contacts.touches > 0 {
				t.Errorf("docking touched station wall %d times, first point=%v", contacts.touches, contacts.first.Point)
			}

			if !poweredNearCore || ship.DockedTo == nil || *ship.DockedTo != station.ID || ship.HullHealthTotal() != health {
				t.Fatalf("powered entry did not dock safely: powered=%v docked=%v hull=%g/%g", poweredNearCore, ship.DockedTo, ship.HullHealthTotal(), health)
			}

			for mount, health := range modules {
				if mount.Module == nil || mount.Health != health {
					t.Fatalf("powered docking damaged an installed module: %g/%g", mount.Health, health)
				}
			}
		})
	}
}

func TestDockingKeepsLateralApproachesInsidePhysicalWalls(t *testing.T) {
	for _, definition := range []string{"courser", "finch"} {
		for _, scenario := range []struct {
			name          string
			offset, drift float64
			heading       float64
		}{
			{"centered", 0, 0, math.Pi},
			{"inward-drift", 30, -10, math.Pi},
			{"mirrored-inward-drift", -30, 10, math.Pi},
			{"drifting", 20, 12, math.Pi},
			{"angled-burn", 20, 0, math.Pi - .3},
			{"facing-across", 0, 0, math.Pi / 2},
		} {
			t.Run(definition+"/"+scenario.name, func(t *testing.T) {
				ship := arrivalShip(t, definition)
				ship.Position, ship.Velocity = Vec.Create(300, scenario.offset), Vec.Create(-180, scenario.drift)
				ship.Face(scenario.heading)
				station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Radius: new(400.)}}, ship.Catalog)
				simulation.AddEntity(ship.World, station)
				contacts := &stationWallContacts{GameCollisions: gameplay.NewGameCollisions(ship.Catalog), ship: ship.ID, station: station.ID}
				ship.World.Collisions = contacts
				ship.LocalMovementParent, ship.LocalMovementRate = station, 1
				pilot := Pilot{}
				health := ship.HullHealthTotal()
				thrust, turn := 0., 0.
				var events []protocol.SimulationEvent

				for tick := range 30 * 20 {
					if tick%steeringIntervalTicks(ship) == 0 {
						thrust, turn = pilot.Steer(ship, pilot.DockingMovement(ship, station))
					}

					ship.Control(protocol.Input{Thrust: thrust, Turn: turn}, &events)
					events = events[:0]
					simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

					if ship.DockedTo != nil {
						break
					}
				}

				if contacts.touches > 0 {
					t.Errorf("docking touched station wall %d times, first point=%v", contacts.touches, contacts.first.Point)
				}

				if ship.DockedTo == nil || *ship.DockedTo != station.ID || ship.HullHealthTotal() != health {
					t.Fatalf("unsafe lateral docking: docked=%v health=%g/%g", ship.DockedTo, ship.HullHealthTotal(), health)
				}
			})
		}
	}
}

/*
Approach with lateral momentum while the station already carries the ship around
its center. Applying that rotation again in guidance used to scrape the hull.
*/
func TestDockingAccountsForInheritedStationRotation(t *testing.T) {
	for _, spin := range []float64{-.0252, 0, .0252} {
		for _, side := range []float64{-1, 1} {
			t.Run(fmt.Sprintf("spin%g/side%g", spin, side), func(t *testing.T) {
				ship := flightShip(t)
				ship.Position = Vec.Create(500, -200*side)
				ship.Velocity = Vec.Create(-75, -67*side)
				ship.Face(-1.63 * side)
				ship.Spin = .4 * side
				station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Radius: new(400.), Spin: spin, Rotation: -.5 * side}}, ship.Catalog)
				simulation.AddEntity(ship.World, station)
				ship.LocalMovementParent, ship.LocalMovementRate = station, 1
				ship.World.Collisions = gameplay.NewGameCollisions(ship.Catalog)
				pilot := Pilot{}
				health := ship.HullHealthTotal()
				var events []protocol.SimulationEvent
				thrust, turn := 0., 0.
				dockedAt := math.Inf(1)

				for tick := range 30 * 30 {
					if tick%steeringIntervalTicks(ship) == 0 {
						thrust, turn = pilot.Steer(ship, pilot.DockingMovement(ship, station))
					}

					ship.Control(protocol.Input{Thrust: thrust, Turn: turn, CargoHatch: true}, &events)
					events = events[:0]
					simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

					if ship.DockedTo != nil {
						dockedAt = float64(tick) / 30
						break
					}
				}

				if math.IsInf(dockedAt, 1) || *ship.DockedTo != station.ID || ship.HullHealthTotal() != health {
					t.Fatalf("ship failed safe docking: time=%g health=%g/%g position=%v velocity=%v", dockedAt, ship.HullHealthTotal(), health, ship.Position, ship.Velocity)
				}
			})
		}
	}
}

func TestInterceptionLeadStopsBeforeTargetCrossesAnAsteroid(t *testing.T) {
	ship := flightShip(t)
	target := Movement{Position: Vec.Create(400, 0), Velocity: Vec.Create(180, 0), TargetID: 2}
	rock := obstacle{position: Vec.Create(600, 0), radius: 80}
	predicted := interceptPosition(ship, target, ship.Radius, []obstacle{rock})

	if predicted.X <= target.Position.X || predicted.X > rock.position.X-rock.radius-ship.Radius || predicted.Y != 0 {
		t.Fatalf("lead left the target's reachable corridor: target=%v lead=%v", target.Position, predicted)
	}

	for i := 0; i <= 100; i++ {
		point := Vec.AddScaled(target.Position, Vec.Subtract(predicted, target.Position), float64(i)/100)

		if Vec.Distance(point, rock.position) < rock.radius+ship.Radius {
			t.Fatalf("lead crossed asteroid at %v", point)
		}
	}
}

func TestInterceptionLeadUpdatesImmediatelyWhenTargetTurns(t *testing.T) {
	ship := flightShip(t)
	target := Movement{Position: Vec.Create(500, 0), Velocity: Vec.Create(0, 170), TargetID: 2}
	first := interceptPosition(ship, target, ship.Radius, nil)
	target.Position = Vec.Create(500, 20)
	target.Velocity = Vec.Create(0, -170)
	second := interceptPosition(ship, target, ship.Radius, nil)

	if first.Y <= 0 || second.Y >= target.Position.Y || second.X != target.Position.X {
		t.Fatalf("interception retained a stale turn: first=%v second=%v actual=%v", first, second, target.Position)
	}
}

func TestInterceptionReturnsToActualPlayerSpacingAfterBraking(t *testing.T) {
	ship := arrivalShip(t, "courser")
	target := objects.CreatePlayerShip(ship.World, objects.Properties{DefinitionID: "courser", ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(1000, 0), Velocity: Vec.Create(150, 0), PlayerID: new(int64(2))}})
	simulation.AddEntity(ship.World, target)
	rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(750, 100), Radius: new(90.0)}, PointCount: 8})
	simulation.AddEntity(ship.World, rock.LockGeometry())
	pilot := Pilot{}
	thrust, turn := 0., 0.
	closest := math.Inf(1)
	spacing := ship.Catalog.PirateSpec.FollowDistance
	health := ship.HullHealthTotal() + target.HullHealthTotal()

	for tick := range 30 * 35 {
		if tick%steeringIntervalTicks(ship) == 0 {
			destination := Movement{Position: target.Position, Velocity: target.Velocity, TargetID: target.ID, FollowDistance: spacing}

			if tick < 30*6 {
				destination.PassDistance = 70
			}

			thrust, turn = pilot.Steer(ship, destination)
		}

		if tick < 30*6 {
			target.Fly(targetFlight(target, 150, 0))
		} else {
			target.Fly(0, 0)
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
		closest = min(closest, Vec.Distance(ship.Position, target.Position))
	}

	distance := Vec.Distance(ship.Position, target.Position)

	if closest < spacing-30 || math.Abs(distance-spacing) > 20 || Vec.Length(ship.Velocity) > 3 || ship.HullHealthTotal()+target.HullHealthTotal() != health {
		t.Fatalf("interception overran the actual braking player: closest=%g final=%g speed=%g", closest, distance, Vec.Length(ship.Velocity))
	}
}

type stationWallContacts struct {
	*gameplay.GameCollisions
	ship, station int64
	touches       int
	first         collision.Contact
}

func (c *stationWallContacts) Step(entities *utilities.OrderedMap[int64, simulation.Entity], dt float64, events *[]protocol.SimulationEvent) []collision.Contact {
	contacts := c.GameCollisions.Step(entities, dt, events)

	for _, contact := range contacts {
		a, b := contact.Collider, contact.Other
		first, second := a.Owner.(simulation.Entity).Base().ID, b.Owner.(simulation.Entity).Base().ID

		if (first == c.ship && second == c.station || first == c.station && second == c.ship) && !a.DockSegment && !b.DockSegment && (a.Physics == nil || *a.Physics) && (b.Physics == nil || *b.Physics) {
			if c.touches == 0 {
				c.first = contact
			}

			c.touches++
		}
	}

	return contacts
}
