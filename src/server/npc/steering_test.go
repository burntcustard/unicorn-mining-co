package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

func arrivalShip(t *testing.T, definition string) *objects.Ship {
	t.Helper()
	ship := flightShip(t)
	world := ship.World

	if definition != ship.DefinitionID {
		world.Entities.Delete(ship.ID)
		ship = objects.CreatePlayerShip(world, objects.Properties{DefinitionID: definition, PlayerID: new(int64(1))})
		simulation.AddEntity(world, ship)
	}

	world.ItemTypes = objects.ItemTypes(world.Specification)
	world.Collisions = gameplay.NewGameCollisions(world.Specification)
	return ship
}

/*
Measure passive stopping through real movement substeps and the velocity cutoff.
Arrival tests use this independent behavior instead of repeating controller math.
*/
func measuredCoastDistance(t *testing.T, definition string, drag, speed float64) float64 {
	t.Helper()
	ship := arrivalShip(t, definition)
	ship.Drag, ship.Velocity = drag, Vec.Create(speed, 0)

	for range 30 * 40 {
		ship.Fly(0, 0)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

		if Vec.LengthSquared(ship.Velocity) == 0 {
			return ship.Position.X
		}
	}

	t.Fatal("coasting fixture never stopped")
	return 0
}

func TestArrivalCoastDependsOnActualMomentumAndDrag(t *testing.T) {
	for _, test := range []struct {
		ship        string
		drag, speed float64
	}{
		{"courser", .35, 120},
		{"courser", .9, 180},
		{"arrow", 5.0 / 9, 300},
	} {
		t.Run(fmt.Sprintf("%s/drag%g/speed%g", test.ship, test.drag, test.speed), func(t *testing.T) {
			coast := measuredCoastDistance(t, test.ship, test.drag, test.speed)
			ship := arrivalShip(t, test.ship)
			ship.Drag, ship.Velocity = test.drag, Vec.Create(test.speed, 0)
			spacing := ship.Catalog.PirateSpec.FollowDistance
			near := Movement{Position: Vec.Create(spacing+coast+2, 0), FollowDistance: spacing}
			thrust, _ := new(Pilot).Steer(ship, near)

			if thrust > .001 {
				t.Fatalf("ship kept powering inside its measured coasting approach: coast=%g thrust=%g", coast, thrust)
			}

			far := Movement{Position: Vec.Create(spacing+coast*2+test.speed, 0), FollowDistance: spacing}
			thrust, _ = new(Pilot).Steer(ship, far)

			if thrust < .999 {
				t.Fatalf("ship limited thrust far beyond its coasting approach: coast=%g thrust=%g", coast, thrust)
			}
		})
	}
}

func TestArrivalUsesFullEngineThenCoastsToPreferredSpacing(t *testing.T) {
	for _, definition := range []string{"courser", "arrow"} {
		t.Run(definition, func(t *testing.T) {
			ship := arrivalShip(t, definition)
			pilot := Pilot{}
			target := Vec.Create(2400, 0)
			spacing := ship.Catalog.PirateSpec.FollowDistance
			coast := measuredCoastDistance(t, definition, ship.Drag, ship.MaxSpeed())
			thrust, turn := 0.0, 0.0
			coasted, reachedSpeed := false, false
			closest, finalDistance := math.Inf(1), math.Inf(1)

			for tick := range 30 * 45 {
				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Steer(ship, Movement{Position: target, FollowDistance: spacing})
					remaining := Vec.Distance(ship.Position, target) - spacing

					if remaining > coast+2*ship.MaxSpeed()*ship.Catalog.NPCMovement.DecisionInterval && thrust < .999 {
						t.Fatalf("far approach reduced thrust: distance=%g thrust=%g", remaining, thrust)
					}
				}

				coasted = coasted || thrust == 0 && Vec.Length(ship.Velocity) > ship.MaxSpeed()*.2
				reachedSpeed = reachedSpeed || Vec.Length(ship.Velocity) >= ship.MaxSpeed()*.98
				ship.Fly(thrust, turn)
				simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
				finalDistance = Vec.Distance(ship.Position, target)
				closest = min(closest, finalDistance)

				if tick > 30*30 && (math.Abs(finalDistance-spacing) > 15 || Vec.Length(ship.Velocity) > 3) {
					t.Fatalf("arrival did not settle: distance=%g speed=%g", finalDistance, Vec.Length(ship.Velocity))
				}
			}

			if !coasted || !reachedSpeed || closest < spacing-20 || math.Abs(finalDistance-spacing) > 15 {
				t.Fatalf("arrival failed full-speed approach and coast: coasted=%v full speed=%v closest=%g final=%g", coasted, reachedSpeed, closest, finalDistance)
			}
		})
	}
}

func TestArrivalMatchesMovingTargetWithoutRepeatedFullThrottleBursts(t *testing.T) {
	for _, speed := range []float64{90, 170} {
		t.Run(fmt.Sprint(speed), func(t *testing.T) {
			ship := arrivalShip(t, "courser")
			world := ship.World
			target := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(700, 0), Velocity: Vec.Create(speed, 0), PlayerID: new(int64(2))}})
			simulation.AddEntity(world, target)
			pilot := Pilot{}
			spacing := ship.Catalog.PirateSpec.FollowDistance
			thrust, turn := 0.0, 0.0
			fullBursts, samples, totalError, totalVelocityError := 0, 0, 0.0, 0.0
			wasFull := false

			for tick := range 30 * 70 {
				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Steer(ship, Movement{Position: target.Position, Velocity: target.Velocity, FollowDistance: spacing, TargetID: target.ID})

					if tick >= 30*30 && thrust > .99 && !wasFull {
						fullBursts++
					}

					wasFull = thrust > .99
				}

				target.Fly(targetFlight(target, speed, 0))
				ship.Fly(thrust, turn)
				simulation.UpdateWorld(world, simulation.UpdateWorldOptions{})

				if tick >= 30*30 {
					samples++
					totalError += math.Abs(Vec.Distance(ship.Position, target.Position) - spacing)
					totalVelocityError += Vec.Length(Vec.Subtract(ship.Velocity, target.Velocity))
				}
			}

			if totalError/float64(samples) > 20 || totalVelocityError/float64(samples) > 5 || fullBursts > 8 {
				t.Fatalf("moving arrival kept oscillating: mean spacing error=%g mean velocity error=%g full bursts=%d", totalError/float64(samples), totalVelocityError/float64(samples), fullBursts)
			}
		})
	}
}

func TestCargoArrivalUsesFullThrustFarAwayAndCollectsThroughItsHatch(t *testing.T) {
	ship := arrivalShip(t, "courser")
	ship.SetModuleActive("cargoHatch", true)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(1500, 0)}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	pilot := Pilot{}
	thrust, turn := 0.0, 0.0
	farFull := false

	for tick := range 30 * 40 {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: item.Position, Velocity: item.Velocity, IgnoreID: item.ID, Collect: true})

			if Vec.Distance(ship.Position, item.Position) > 1000 {
				if thrust < .999 {
					t.Fatalf("distant cargo approach limited throttle: thrust=%g", thrust)
				}

				farFull = true
			}
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

		if slices.Contains(ship.CargoContents, simulation.Entity(item)) {
			if !farFull {
				t.Fatal("cargo fixture did not exercise distant full-thrust approach")
			}

			return
		}
	}

	t.Fatal("coasting arrival never collected cargo through its open hatch")
}

func TestCargoArrivalCollectsBroadsideGold(t *testing.T) {
	ship := arrivalShip(t, "courser")
	ship.SetModuleActive("cargoHatch", true)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(100, 0), Rotation: math.Pi / 2}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	pilot := Pilot{}
	thrust, turn := 0.0, 0.0

	for tick := range 30 * 15 {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: item.Position, Velocity: item.Velocity, IgnoreID: item.ID, Collect: true})
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

		if slices.Contains(ship.CargoContents, simulation.Entity(item)) {
			return
		}
	}

	t.Fatal("ship kept pushing blocked gold instead of collecting it from another angle")
}

func TestFollowArrivalKeepsSpaceAfterAnAsteroidDetour(t *testing.T) {
	for _, x := range []float64{750, 900} {
		for _, side := range []float64{-1, 1} {
			t.Run(fmt.Sprintf("rock%g/side%g", x, side), func(t *testing.T) {
				ship := arrivalShip(t, "courser")
				target := objects.CreatePlayerShip(ship.World, objects.Properties{DefinitionID: "courser", ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(1000, 0), PlayerID: new(int64(2))}})
				simulation.AddEntity(ship.World, target)
				rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(x, side*100), Radius: new(90.0)}, PointCount: 8})
				simulation.AddEntity(ship.World, rock.LockGeometry())
				pilot := Pilot{}
				thrust, turn := 0.0, 0.0
				closest := math.Inf(1)
				spacing := ship.Catalog.PirateSpec.FollowDistance
				health := ship.HullHealthTotal() + target.HullHealthTotal()

				for tick := range 30 * 35 {
					if tick%steeringIntervalTicks(ship) == 0 {
						thrust, turn = pilot.Steer(ship, Movement{Position: target.Position, Velocity: target.Velocity, FollowDistance: spacing, TargetID: target.ID})
					}

					ship.Fly(thrust, turn)
					simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
					closest = min(closest, Vec.Distance(ship.Position, target.Position))
				}

				distance := Vec.Distance(ship.Position, target.Position)

				if closest < spacing-30 || math.Abs(distance-spacing) > 20 || Vec.Length(ship.Velocity) > 3 || ship.HullHealthTotal()+target.HullHealthTotal() != health {
					t.Fatalf("detour discarded the player's arrival space: closest=%g final=%g speed=%g", closest, distance, Vec.Length(ship.Velocity))
				}
			})
		}
	}
}

func TestArrivalUsesOpposingEngineToCancelExcessMomentum(t *testing.T) {
	for _, heading := range []float64{0, math.Pi / 2, math.Pi} {
		t.Run(fmt.Sprintf("heading%g", heading), func(t *testing.T) {
			ship := arrivalShip(t, "courser")
			ship.Velocity = Vec.Create(180, 0)
			ship.Face(heading)
			target := objects.CreatePlayerShip(ship.World, objects.Properties{DefinitionID: "courser", ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(450, 0), PlayerID: new(int64(2))}})
			simulation.AddEntity(ship.World, target)
			pilot := Pilot{}
			thrust, turn := 0.0, 0.0
			closest := math.Inf(1)
			braked := false
			spacing := ship.Catalog.PirateSpec.FollowDistance

			for tick := range 30 * 35 {
				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Steer(ship, Movement{Position: target.Position, FollowDistance: spacing, TargetID: target.ID})
				}

				forward := Vec.Create(math.Cos(ship.Rotation), math.Sin(ship.Rotation))
				braked = braked || thrust > .05 && Vec.Dot(forward, ship.Velocity) < -30
				ship.Fly(thrust, turn)
				simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
				closest = min(closest, Vec.Distance(ship.Position, target.Position))
			}

			distance := Vec.Distance(ship.Position, target.Position)

			if !braked || closest < spacing-30 || math.Abs(distance-spacing) > 20 || Vec.Length(ship.Velocity) > 3 {
				t.Fatalf("arrival did not cancel momentum with the opposing engine: braked=%v closest=%g final=%g speed=%g", braked, closest, distance, Vec.Length(ship.Velocity))
			}

		})
	}
}

/*
predict exercises a standalone forecast without the pilot's route selection.
*/
func predict(ship *objects.Ship, heading, thrust, turn, radius float64, obstacles []obstacle) prediction {
	return new(predictor).reset(ship, predictionOptions{radius: radius, obstacles: obstacles}).predict(heading, thrust, turn)
}

func obstaclesFor(ship *objects.Ship, ignore int64) []obstacle {
	return new(obstacleSnapshot).capture(ship, Movement{IgnoreID: ignore})
}

func avoid(ship *objects.Ship, heading Vec.Vector, thrust, turn float64, obstacles []obstacle) (float64, float64) {
	return new(Pilot).avoid(ship, heading, thrust, turn, obstacles)
}

/*
A slight drift correction should use a narrow passage without braking or taking
a detour. Exercise the ordinary five-Hz steering loop and physical rock contacts.
*/
func TestPilotPowersThroughANarrowGapWhileCorrectingDrift(t *testing.T) {
	for _, side := range []float64{-1, 1} {
		ship := flightShip(t)
		ship.Velocity = Vec.Create(180, side*20)
		ship.Face(-side * .3)
		world := ship.World
		contacts := &courseCollisions{GameCollisions: gameplay.NewGameCollisions(world.Specification), shipID: ship.ID}
		world.Collisions = contacts

		for _, y := range []float64{-135, 135} {
			outline := simulation.CreatePolygon(simulation.PolygonOptions{PointCount: 16, Radius: 90})

			rock := simulation.CreateAsteroid(world, simulation.AsteroidProperties{
				ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(350, y), Radius: new(90.0), ShapeOutline: outline},
				PointCount:       16,
			})

			simulation.AddEntity(world, rock.LockGeometry())
		}

		pilot := Pilot{}
		thrust, turn := 0.0, 0.0
		minimumSpeed := math.Inf(1)

		for tick := range 30 * 3 {
			if tick%steeringIntervalTicks(ship) == 0 {
				thrust, turn = pilot.Steer(ship, Movement{Position: Vec.Create(1500, 0)})
			}

			ship.Fly(thrust, turn)
			contacts.touching = false
			simulation.UpdateWorld(world, simulation.UpdateWorldOptions{})

			if contacts.touching {
				t.Fatal("drift correction hit an asteroid in the passage")
			}

			if ship.Position.X > 100 && ship.Position.X < 450 {
				minimumSpeed = min(minimumSpeed, Vec.Length(ship.Velocity))
			}
		}

		if minimumSpeed < ship.MaxSpeed()*.75 || ship.Position.X < 550 || math.Abs(ship.Position.Y) > 45 {
			t.Fatalf("pilot slowed or detoured around a usable gap: speed=%.1f position=%v", minimumSpeed, ship.Position)
		}
	}
}

func TestPilotRestartsAcrossVisibleMovementSubsteps(t *testing.T) {
	ship := flightShip(t)
	pilot := Pilot{}
	thrust, turn := 0.0, 0.0

	for tick := range 30 * 3 {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: Vec.Create(30, 0)})
		}

		ship.Fly(thrust, turn)
		// Use the real visible movement tier, which updates twice per server tick.
		simulation.UpdateEntities(ship.World, simulation.UpdateEntitiesOptions{})
		ship.World.Tick++
	}

	if ship.Position.X < 1 {
		t.Fatalf("pilot could not restart near its destination: position=%v thrust=%g", ship.Position, thrust)
	}
}

func TestPredictTracksRotatingPhysicalOutlinesInsideCircleBounds(t *testing.T) {
	ship := flightShip(t)
	rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Radius: new(200.), ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{-180, -45}, {180, -45}, {180, 45}, {-180, 45}}}}}).LockGeometry()
	simulation.AddEntity(ship.World, rock)
	ship.Position = Vec.Create(0, 125)

	for _, spin := range []float64{-.5, 0, .5} {
		rock.Rotation, rock.Spin = 0, spin
		forecast := (&predictor{}).reset(ship, predictionOptions{radius: navigationRadius(ship), obstacles: obstaclesFor(ship, 0)})
		result := forecast.predict(0, 0, 0)

		if result.safe != (spin == 0) {
			t.Fatalf("rotating outline forecast did not match its physical clearance: spin=%g safe=%v", spin, result.safe)
		}

		contact := false

		for seconds := 0.; seconds <= ship.Catalog.NPCMovement.PredictionTime; seconds += .01 {
			rock.Rotation = spin * seconds
			contact = contact || diskTouchesAsteroid(rock, ship.Position, forecast.clearance-.001)
		}

		if result.safe == contact {
			t.Fatal("outline forecast disagreed with independent rotating asteroid colliders")
		}
	}
}

func TestPredictCatchesAnObstacleCrossingBetweenSamples(t *testing.T) {
	ship := flightShip(t)
	object := obstacle{position: Vec.Create(-150, 0), velocity: Vec.Create(3000, 0), radius: 1}
	result := predict(ship, 0, 0, 0, navigationRadius(ship), []obstacle{object})

	if result.safe {
		t.Fatal("moving obstacle crossed through the ship between prediction endpoints")
	}

	// The same relative pass must remain possible when it is safely offset.
	object.position.Y = ship.Radius + ship.Catalog.NPCMovement.ClearanceDistance + 10
	result = predict(ship, 0, 0, 0, navigationRadius(ship), []obstacle{object})

	if !result.safe {
		t.Fatal("moving obstacle was blocked despite passing safely beside the ship")
	}
}

func TestObstaclePositionAtMatchesIntegratedTurningAndBraking(t *testing.T) {
	for _, test := range []struct {
		name                         string
		speed, heading, turn, change float64
	}{
		{"counterclockwise braking", 150, .7, .4, -35},
		{"clockwise stop", 90, -1.2, -.3, -40},
		{"accelerating turn", 100, .4, .2, 20},
	} {
		t.Run(test.name, func(t *testing.T) {
			direction := Vec.Create(math.Cos(test.heading), math.Sin(test.heading))
			side := Vec.Create(-direction.Y, direction.X)
			object := obstacle{position: Vec.Create(42, -71), velocity: Vec.Scale(direction, test.speed), acceleration: Vec.Add(Vec.Scale(direction, test.change), Vec.Scale(side, test.speed*test.turn))}

			for _, duration := range []float64{.2, 1.7, 2.5, 6} {
				position := object.position

				// Independently integrate forward speed and heading at midpoint times.
				for now := 0.0; now < duration; {
					step := min(.0001, duration-now)
					middle := now + step*.5
					speed := max(0, test.speed+test.change*middle)
					angle := test.heading + test.turn*middle
					position = Vec.AddScaled(position, Vec.Create(math.Cos(angle), math.Sin(angle)), speed*step)
					now += step
				}

				if predicted := object.positionAt(duration); Vec.Distance(predicted, position) > .0001 {
					t.Fatalf("turning prediction disagrees with integrated motion at %gs: predicted=%v integrated=%v", duration, predicted, position)
				}
			}
		})
	}
}

func TestObstaclePositionAtStraightAndStoppedLimits(t *testing.T) {
	for _, test := range []struct {
		name     string
		object   obstacle
		duration float64
		position Vec.Vector
	}{
		{"stationary", obstacle{position: Vec.Create(42, -71)}, 4, Vec.Create(42, -71)},
		{"already stopped after braking", obstacle{position: Vec.Create(42, -71), acceleration: Vec.Create(-50, 0)}, 4, Vec.Create(42, -71)},
		{"constant velocity", obstacle{position: Vec.Create(10, 20), velocity: Vec.Create(120, -50)}, 3, Vec.Create(370, -130)},
		{"straight acceleration", obstacle{velocity: Vec.Create(20, 0), acceleration: Vec.Create(10, 0)}, 2, Vec.Create(60, 0)},
		{"stops without reversing", obstacle{velocity: Vec.Create(100, 0), acceleration: Vec.Create(-50, 0)}, 4, Vec.Create(100, 0)},
	} {
		t.Run(test.name, func(t *testing.T) {
			if position := test.object.positionAt(test.duration); Vec.Distance(position, test.position) > .0001 {
				t.Fatalf("unexpected position: got=%v want=%v", position, test.position)
			}
		})
	}
}

func TestAvoidIncludesAcceleratingObstaclesBeyondLinearReach(t *testing.T) {
	ship := flightShip(t)
	object := obstacle{position: Vec.Create(800, 0), velocity: Vec.Create(-50, 0), acceleration: Vec.Create(-200, 0), radius: navigationRadius(ship)}

	if predict(ship, 0, 1, 0, navigationRadius(ship), []obstacle{object}).safe {
		t.Fatal("fixture does not intersect the accelerating obstacle")
	}

	thrust, turn := avoid(ship, Vec.Create(1, 0), 1, 0, []obstacle{object})

	if thrust == 1 && turn == 0 {
		t.Fatal("broad phase excluded an accelerating obstacle that reaches the ship's course")
	}
}

func TestStoppingPositionTracksHeldInputAndCoast(t *testing.T) {
	for _, velocity := range []Vec.Vector{{}, {X: 165}, {X: -80, Y: 120}} {
		for _, turn := range []float64{-1, 0, 1} {
			t.Run(fmt.Sprintf("velocity%v/turn%g", velocity, turn), func(t *testing.T) {
				ship := arrivalShip(t, "finch")
				ship.Position = Vec.Create(9600, 1000)
				ship.Velocity = velocity
				ship.Face(math.Pi / 5)
				predicted := new(Pilot).StoppingPosition(ship, 1, turn)
				step := ship.Catalog.Simulation.SimulationStep

				for tick := range int(30 / step) {
					if tick < steeringIntervalTicks(ship) {
						ship.Fly(1, turn)
					} else {
						ship.Fly(0, 0)
					}

					simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
				}

				if distance := Vec.Distance(predicted, ship.Position); distance > 5 {
					t.Fatalf("stopping prediction missed held input and coast by %.3fm: predicted=%v actual=%v", distance, predicted, ship.Position)
				}
			})
		}
	}
}
