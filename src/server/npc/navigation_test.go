package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

/*
Sample the route independently of its visibility checks, including every shortcut.
*/
func assertCircleRouteClear(t *testing.T, from, to Vec.Vector, radius float64, obstacles []obstacle) {
	t.Helper()
	steps := max(1, int(math.Ceil(Vec.Distance(from, to)/5)))

	for step := 0; step <= steps; step++ {
		point := Vec.AddScaled(from, Vec.Subtract(to, from), float64(step)/float64(steps))

		for _, object := range obstacles {
			if Vec.Distance(point, object.position) < object.radius+radius-.001 {
				t.Fatalf("route crossed a neighboring obstacle: from=%v to=%v point=%v obstacle=%v", from, to, point, object.position)
			}
		}
	}
}

func TestRouteNavigatesNeighboringAsteroidClusters(t *testing.T) {
	for _, mirror := range []float64{-1, 1} {
		ship := flightShip(t)
		plan := routePlan{}
		target := Vec.Create(1600, 0)

		obstacles := []obstacle{
			{position: Vec.Create(450, 0), radius: 170},
			{position: Vec.Create(650, mirror*200), radius: 170},
			{position: Vec.Create(900, mirror*-180), radius: 170},
			{position: Vec.Create(1200, mirror*40), radius: 170},
		}

		radius := navigationRadius(ship) + ship.Catalog.NPCMovement.ClearanceDistance

		for decision := 0; decision < 100 && Vec.Distance(ship.Position, target) > 10; decision++ {
			waypoint, _ := plan.waypoint(ship, target, obstacles)

			if Vec.Distance(waypoint, ship.Position) < 1 {
				t.Fatalf("route stalled among neighboring asteroids at %v", ship.Position)
			}

			assertCircleRouteClear(t, ship.Position, waypoint, radius, obstacles)
			offset := Vec.Subtract(waypoint, ship.Position)
			ship.Position = Vec.AddScaled(ship.Position, Vec.Normalize(offset), min(80, Vec.Length(offset)))
			ship.World.Tick += 6
		}

		if Vec.Distance(ship.Position, target) > 10 {
			t.Fatalf("route never exited neighboring asteroid cluster: position=%v target=%v", ship.Position, target)
		}
	}
}

func TestObstaclesKeepCircleBoundsWithRotatedOutlineFallback(t *testing.T) {
	ship := flightShip(t)
	rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(500, 0), Radius: new(200.), ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{-180, -45}, {180, -45}, {180, 45}, {-180, 45}}}}}).LockGeometry()
	simulation.AddEntity(ship.World, rock)
	from, to := Vec.Create(200, 150), Vec.Create(800, 150)

	for _, rotation := range []float64{0, math.Pi / 2} {
		rock.Rotation = rotation
		obstacles := obstaclesFor(ship, 0)

		if len(obstacles) != 1 || obstacles[0].radius < rock.Radius {
			t.Fatal("outline weakened the circle broad-phase bound")
		}

		clear := clearSegment(from, to, 10, obstacles, false)

		if clear != (rotation == 0) {
			t.Fatal("precise fallback did not follow the rotated physical outline")
		}

		contact := false

		for x := from.X; x <= to.X; x += 2 {
			contact = contact || diskTouchesAsteroid(rock, Vec.Create(x, from.Y), 10)
		}

		if clear == contact {
			t.Fatal("outline clearance disagreed with independent asteroid colliders")
		}
	}

	circles := []obstacle{{position: rock.Position, radius: rock.Radius}}

	if clearSegment(from, to, 10, circles, false) {
		t.Fatal("fixture did not require geometry after a circle rejection")
	}
}

func TestCachedRouteTracksSubstantialTargetMotion(t *testing.T) {
	ship := flightShip(t)
	plan := routePlan{}
	obstacles := []obstacle{{position: Vec.Create(500, 0), radius: 160}}
	target := Vec.Create(1000, 0)
	waypoint, detour := plan.waypoint(ship, target, obstacles)

	if !detour || len(plan.points) == 0 {
		t.Fatal("fixture did not require a cached route")
	}

	radius := navigationRadius(ship) + ship.Catalog.NPCMovement.ClearanceDistance
	assertCircleRouteClear(t, ship.Position, waypoint, radius, obstacles)
	ship.World.Tick = 6
	plan.waypoint(ship, Vec.Create(1000, 20), obstacles)

	if plan.target != target || plan.tick != 0 {
		t.Fatal("small target movements discarded the committed route")
	}

	ship.World.Tick = 12
	target = Vec.Create(1000, -350)
	waypoint, detour = plan.waypoint(ship, target, obstacles)

	if !detour || plan.target != target || plan.tick != ship.World.Tick {
		t.Fatal("cached route continued toward the target's old position")
	}

	assertCircleRouteClear(t, ship.Position, waypoint, radius, obstacles)

	if Vec.Distance(plan.points[len(plan.points)-1], target) > 1 {
		t.Fatal("replanned route did not reach the moving target's new position")
	}
}

func TestRouteEscapesAnExistingSafetyOverlap(t *testing.T) {
	from := Vec.Create(295, 0)
	obstacles := []obstacle{{position: Vec.Create(500, 0), radius: 160}}
	radius := 75.0

	if clearSegment(from, Vec.Create(295, 300), radius, obstacles, false) {
		t.Fatal("ordinary routing ignored its starting safety overlap")
	}

	if !clearSegment(from, Vec.Create(295, 300), radius, obstacles, true) {
		t.Fatal("routing prevented an escape that steadily increases clearance")
	}

	if clearSegment(from, Vec.Create(1000, 0), radius, obstacles, true) {
		t.Fatal("escape allowed a shortcut deeper through the asteroid")
	}

	path := planRoute(from, Vec.Create(1000, 0), radius, obstacles)

	if len(path) == 0 {
		t.Fatal("route was permanently trapped by its starting safety margin")
	}

	previous := from

	for index, next := range path {
		clearance := radius

		if index == 0 {
			clearance = Vec.Distance(from, obstacles[0].position) - obstacles[0].radius
		}

		assertCircleRouteClear(t, previous, next, clearance, obstacles)
		previous = next
	}

	if Vec.Distance(previous, Vec.Create(1000, 0)) > 1 {
		t.Fatal("escape route did not continue to the destination")
	}
}

func TestRouteDoesNotSkipAnEscapeCorner(t *testing.T) {
	ship := flightShip(t)
	radius := navigationRadius(ship) + ship.Catalog.NPCMovement.ClearanceDistance
	reach := 160 + radius
	ship.Position = Vec.Create(480, -reach+13)
	corner := Vec.Create(500, -reach-1)
	target := Vec.Create(1000, -reach-1)
	plan := routePlan{points: []Vec.Vector{corner, Vec.Create(800, -reach-1)}, target: target}
	obstacles := []obstacle{{position: Vec.Create(500, 0), radius: 160}}
	waypoint, detour := plan.waypoint(ship, target, obstacles)

	if !detour || waypoint != corner {
		t.Fatalf("route skipped its nearby escape corner: waypoint=%v corner=%v", waypoint, corner)
	}

	if !clearSegment(ship.Position, waypoint, radius, obstacles, true) {
		t.Fatal("returned escape waypoint crosses the route's own safety margin")
	}

	initial := Vec.Distance(ship.Position, obstacles[0].position) - obstacles[0].radius
	assertCircleRouteClear(t, ship.Position, waypoint, initial, obstacles)
}

func TestRouteContinuesPastItsLocalPlanningLimit(t *testing.T) {
	ship := flightShip(t)
	plan := routePlan{}
	target := Vec.Create(4000, 0)
	obstacles := []obstacle{{position: Vec.Create(500, 0), radius: 160}, {position: Vec.Create(2800, 0), radius: 160}}
	plan.waypoint(ship, target, obstacles)

	if len(plan.points) == 0 {
		t.Fatal("fixture did not produce a route")
	}

	// Reach the capped endpoint before the timed cache expiry, with another rock ahead.
	ship.Position = plan.points[len(plan.points)-1]
	ship.World.Tick = 6
	waypoint, _ := plan.waypoint(ship, target, obstacles)

	if Vec.Distance(ship.Position, waypoint) < 25 || plan.tick != ship.World.Tick {
		t.Fatal("pilot waited at its local planning limit instead of continuing the route")
	}

	if Vec.Distance(ship.Position, plan.points[len(plan.points)-1]) < 500 {
		t.Fatal("new local route did not advance toward the distant destination")
	}

	radius := navigationRadius(ship) + ship.Catalog.NPCMovement.ClearanceDistance
	assertCircleRouteClear(t, ship.Position, waypoint, radius, obstacles)
}

func TestRouteUsesPhysicalClearanceInsideGeneratedAsteroidBounds(t *testing.T) {
	for _, test := range []struct {
		seed     uint32
		from, to Vec.Vector
	}{
		{25, Vec.Create(-650.05, -2243.84), Vec.Create(-1353.15, -2625.47)},
		{67, Vec.Create(-27.83, -67.27), Vec.Create(-827.14, -100.5)},
		{501, Vec.Create(-1560.1, 2047.87), Vec.Create(-1904.61, 1325.86)},
	} {
		ship, rocks, center := generatedCourse(t, courseField{seed: test.seed, resource: 2})
		ship.Position = Vec.Add(center, test.from)
		target := Vec.Add(center, test.to)
		radius := navigationRadius(ship) + ship.Catalog.NPCMovement.ClearanceDistance
		steps := int(math.Ceil(Vec.Distance(ship.Position, target) / 5))
		circleClear := true

		for step := 0; step <= steps; step++ {
			point := Vec.AddScaled(ship.Position, Vec.Subtract(target, ship.Position), float64(step)/float64(steps))

			for _, rock := range rocks {
				if Vec.Distance(point, rock.Position) < rock.Radius+radius+ship.Catalog.NPCMovement.ClearanceDistance {
					circleClear = false
				}

				if Vec.DistanceSquared(point, rock.Position) < (rock.Radius+radius+70)*(rock.Radius+radius+70) && diskTouchesAsteroid(rock, point, radius-.001) {
					t.Fatalf("seed %d fixture does not fit the physical ship at %v", test.seed, point)
				}
			}
		}

		plan := routePlan{}
		waypoint, detour := plan.waypoint(ship, target, obstaclesFor(ship, 0))

		if circleClear {
			t.Fatal("fixture no longer needs outline clearance inside a circle bound")
		}

		if detour || waypoint != target {
			t.Fatalf("seed %d detoured around a physically usable generated corridor", test.seed)
		}
	}
}

func TestRouteUsesAnOffsetNarrowOpening(t *testing.T) {
	for _, mirror := range []float64{-1, 1} {
		ship := flightShip(t)
		radius := navigationRadius(ship) + ship.Catalog.NPCMovement.ClearanceDistance
		halfGap := radius + 10

		obstacles := []obstacle{
			{position: Vec.Create(500, -180-halfGap), radius: 180},
			{position: Vec.Create(500, 180+halfGap), radius: 180},
		}

		from, target := Vec.Create(0, mirror*-160), Vec.Create(1000, mirror*160)
		path := planRoute(from, target, radius, obstacles)
		previous := from

		if len(path) == 0 {
			t.Fatal("route missed a narrow opening offset from its starting grid")
		}

		for _, next := range path {
			assertCircleRouteClear(t, previous, next, radius, obstacles)
			steps := max(1, int(math.Ceil(Vec.Distance(previous, next)/5)))

			for step := 0; step <= steps; step++ {
				point := Vec.AddScaled(previous, Vec.Subtract(next, previous), float64(step)/float64(steps))

				if math.Abs(point.X-500) < 3 && math.Abs(point.Y) > halfGap-radius+1 {
					t.Fatalf("route detoured around the usable opening or clipped its edge: %v", point)
				}
			}

			previous = next
		}

		if Vec.Distance(previous, target) > 1 {
			t.Fatal("route stopped before the far side of the narrow opening")
		}
	}
}

func TestRoutePlansAroundDriftingAsteroidOutlines(t *testing.T) {
	ship := flightShip(t)
	rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(400, 0), Velocity: Vec.Create(0, 5), Radius: new(190.), ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{-60, -180}, {60, -180}, {60, 180}, {-60, 180}}}}}).LockGeometry()
	simulation.AddEntity(ship.World, rock)
	target := Vec.Create(800, 0)
	plan := routePlan{}
	waypoint, detour := plan.waypoint(ship, target, obstaclesFor(ship, 0))

	if !detour || waypoint == ship.Position {
		t.Fatal("drifting fragment did not receive a usable route around its outline")
	}

	from := ship.Position

	for _, to := range append([]Vec.Vector{waypoint}, plan.points...) {
		steps := max(1, int(math.Ceil(Vec.Distance(from, to)/2)))

		for step := 0; step <= steps; step++ {
			point := Vec.AddScaled(from, Vec.Subtract(to, from), float64(step)/float64(steps))

			if diskTouchesAsteroid(rock, point, navigationRadius(ship)) {
				t.Fatalf("route enters drifting fragment: point=%v", point)
			}
		}

		from = to
	}

	if Vec.Distance(from, target) > 1 {
		t.Fatal("route did not continue past the drifting fragment")
	}
}

func TestSearchExpandsThroughRealShipPhysics(t *testing.T) {
	for _, velocity := range []Vec.Vector{Vec.Create(0, 0), Vec.Create(100, 0), Vec.Create(200, 0), Vec.Create(0, 100)} {
		t.Run(fmt.Sprint(velocity), func(t *testing.T) {
			ship := arrivalShip(t, "courser")
			ship.Velocity = velocity
			ship.SetModuleActive("cargoHatch", true)
			ship.SetModuleActive("cannonSm", true)
			search := Search{Origin: ship.Position, Heading: ship.Rotation}
			pilot := Pilot{}
			thrust, turn := 0.0, 0.0
			traveled, previousAngle, earlyRadius := 0.0, 0.0, 0.0

			for tick := range 30 * 100 {
				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Search(ship, &search)
				}

				ship.Fly(thrust, turn)
				simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
				offset := Vec.Subtract(ship.Position, search.Origin)
				angle := math.Atan2(offset.Y, offset.X)

				if tick > 30*5 {
					traveled += math.Remainder(angle-previousAngle, 2*math.Pi)
				}

				previousAngle = angle

				if tick == 30*25 {
					earlyRadius = Vec.Length(offset)
				}
			}

			radius := Vec.Distance(ship.Position, search.Origin)

			if traveled < 2*math.Pi || radius < 700 || radius < earlyRadius+250 {
				t.Fatalf("search stayed in small circles: turns=%g final radius=%g early radius=%g spiral angle=%g", traveled/(2*math.Pi), radius, earlyRadius, search.Angle)
			}
		})
	}
}

func TestSearchExpandsPastAnObstructedSpiralWaypoint(t *testing.T) {
	ship := arrivalShip(t, "courser")
	rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(150, 0), Radius: new(90.0)}, PointCount: 8})
	simulation.AddEntity(ship.World, rock.LockGeometry())
	search := Search{Origin: ship.Position, Heading: ship.Rotation}
	pilot := Pilot{}
	thrust, turn := 0.0, 0.0

	for tick := range 30 * 100 {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Search(ship, &search)
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
	}

	if radius := Vec.Distance(ship.Position, search.Origin); radius < 700 {
		t.Fatalf("obstructed search circled one waypoint: radius=%g spiral angle=%g", radius, search.Angle)
	}

	if ship.Dead || ship.Stranded() {
		t.Fatal("search forced the ship through an obstacle")
	}
}
