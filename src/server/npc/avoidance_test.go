package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

/*
predict exercises a standalone forecast without the pilot's route selection.
*/
func predict(ship *objects.Ship, heading, thrust, turn, radius float64, obstacles []obstacle) prediction {
	return new(predictor).reset(ship, radius, obstacles).predict(heading, thrust, turn)
}

func obstaclesFor(ship *objects.Ship, ignore int64) []obstacle {
	return new(obstacleSnapshot).capture(ship, ignore)
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
		forecast := (&predictor{}).reset(ship, navigationRadius(ship), obstaclesFor(ship, 0))
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
