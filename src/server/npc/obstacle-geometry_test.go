package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

func TestSelectiveGeometryCacheTracksOutlineAndPose(t *testing.T) {
	ship := flightShip(t)
	outline := &simulation.ShapeOutline{Points: []simulation.Point{{-120, -20}, {120, -20}, {120, 20}, {-120, 20}}}
	rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(500, 0), Radius: new(130.), ShapeOutline: outline}}).LockGeometry()
	simulation.AddEntity(ship.World, rock)
	snapshot := obstacleSnapshot{}
	first := snapshot.capture(ship, 0)[0]

	if first.distance(Vec.Create(500, 90)) < 69 {
		t.Fatal("long thin outline was treated as its outer circle")
	}

	rock.Rotation = math.Pi / 2
	second := snapshot.capture(ship, 0)[0]

	if first.polygon != second.polygon || second.distance(Vec.Create(500, 90)) >= 0 {
		t.Fatal("pose changes did not reuse and rotate immutable geometry")
	}

	rock.ShapeOutline = &simulation.ShapeOutline{Points: []simulation.Point{{-120, -45}, {120, -45}, {120, 45}, {-120, 45}}}
	rock.Rotation = 0
	third := snapshot.capture(ship, 0)[0]

	if third.polygon == first.polygon || math.Abs(third.distance(Vec.Create(500, 90))-45) > .001 {
		t.Fatal("replaced unlocked outline reused stale geometry")
	}

	rock.ShapeOutline.Points[2][1] = 65
	rock.ShapeOutline.Points[3][1] = 65
	fourth := snapshot.capture(ship, 0)[0]

	if fourth.polygon == third.polygon || math.Abs(fourth.distance(Vec.Create(500, 90))-25) > .001 {
		t.Fatal("mutable outline bypass did not update local bounds")
	}
}

func TestSelectiveGeometrySweepsMatchIndependentAsteroidContact(t *testing.T) {
	ship := flightShip(t)
	rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Radius: new(180.)}, PointCount: 9, RadiusEven: new(70.)}).LockGeometry()
	simulation.AddEntity(ship.World, rock)
	snapshot := obstacleSnapshot{}
	radius := navigationRadius(ship) + ship.Catalog.NPCMovement.ClearanceDistance

	for angle := 0.; angle < 2*math.Pi; angle += .31 {
		rock.Rotation = angle
		obstacles := snapshot.capture(ship, 0)

		for y := -250.; y <= 250; y += 5 {
			from, to := Vec.Create(-250, y), Vec.Create(250, y)

			if !clearSegment(from, to, radius, obstacles, false) {
				continue
			}

			for x := -250.; x <= 250; x += 1 {
				if _, _, contact := simulation.AsteroidContact(rock, Vec.Create(x, y), radius-.001); contact {
					t.Fatalf("swept outline accepted contact at rotation=%g x=%g y=%g", angle, x, y)
				}
			}
		}
	}
}

/*
Four thin rectangular asteroid hulls form a circle-only ring around the start.
The actual hulls leave diagonal exits, but the direct goal still needs a dogleg.
*/
func TestRouteUsesDetailedGridFallbackWhenCirclesCloseAnOpening(t *testing.T) {
	ship := flightShip(t)
	rocks := []*simulation.Asteroid{}

	for _, pose := range []struct {
		position Vec.Vector
		rotation float64
	}{{Vec.Create(300, 0), 0}, {Vec.Create(-300, 0), 0}, {Vec.Create(0, 300), math.Pi / 2}, {Vec.Create(0, -300), math.Pi / 2}} {
		rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: pose.position, Rotation: pose.rotation, Radius: new(260.), ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{-200, -30}, {200, -30}, {200, 30}, {-200, 30}}}}}).LockGeometry()
		simulation.AddEntity(ship.World, rock)
		rocks = append(rocks, rock)
	}

	from, target := Vec.Vector{}, Vec.Create(800, 0)
	radius := navigationRadius(ship) + ship.Catalog.NPCMovement.ClearanceDistance
	obstacles := obstaclesFor(ship, 0)

	if clearSegment(from, target, radius, obstacles, false) {
		t.Fatal("fixture bypasses grid planning with a clear direct segment")
	}

	circles := make([]obstacle, len(obstacles))

	for index, object := range obstacles {
		circles[index] = obstacle{position: object.position, radius: object.radius}
	}

	if path := planRoute(from, target, radius, circles); len(path) > 0 {
		t.Fatal("fixture did not disconnect the circle-only grid")
	}

	path := planRoute(from, target, radius, obstacles)

	if len(path) == 0 || Vec.Distance(path[len(path)-1], target) > 1 {
		t.Fatal("detailed grid did not escape the circle-only ring and reach its goal")
	}

	previous := from
	length := 0.

	for _, point := range path {
		distance := Vec.Distance(previous, point)
		leg := pursuitPath{origin: previous, direction: Vec.Normalize(Vec.Subtract(point, previous)), speed: 80, duration: distance / 80}

		if !pursuitPathClear(ship, rocks, leg) {
			t.Fatalf("detailed grid crossed an actual hull between %v and %v", previous, point)
		}

		steps := max(1, int(math.Ceil(distance/2)))

		for step := 0; step <= steps; step++ {
			position := Vec.AddScaled(previous, Vec.Subtract(point, previous), float64(step)/float64(steps))

			for _, rock := range rocks {
				for _, collider := range rock.Hitbox() {
					if _, contact := query.ContactBetween(query.ShapeData{Position: position, Radius: radius - .001}, query.ShapeData{Position: collider.GetPosition(), Rotation: collider.GetRotation(), Radius: collider.GetRadius(), Outline: collider.ShapeOutline, CollisionMargin: collider.CollisionMargin}, ship.Catalog.Simulation.LinearSlop); contact {
						t.Fatal("detailed grid clipped an actual asteroid collider with its navigation disk")
					}
				}
			}
		}

		previous = point
		length += distance
	}

	if length > 1200 {
		t.Fatalf("detailed route detoured around the usable exits: length=%g", length)
	}
}

func diskTouchesAsteroid(rock *simulation.Asteroid, position Vec.Vector, radius float64) bool {
	for _, collider := range rock.Hitbox() {
		if _, touch := query.ContactBetween(query.ShapeData{Position: position, Radius: radius}, query.ShapeData{Position: collider.GetPosition(), Rotation: collider.GetRotation(), Radius: collider.GetRadius(), Outline: collider.ShapeOutline, CollisionMargin: collider.CollisionMargin}, rock.World.Specification.Simulation.LinearSlop); touch {
			return true
		}
	}

	return false
}

func TestDegenerateOutlineKeepsCircleSafety(t *testing.T) {
	for _, points := range [][]simulation.Point{nil, {{0, 0}}, {{-20, 0}, {0, 0}, {20, 0}}} {
		ship := flightShip(t)
		rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(400, 0), Radius: new(180.), ShapeOutline: &simulation.ShapeOutline{Points: points}}})
		simulation.AddEntity(ship.World, rock)
		obstacles := obstaclesFor(ship, 0)

		if obstacles[0].polygon != nil || clearSegment(Vec.Create(100, 0), Vec.Create(700, 0), navigationRadius(ship), obstacles, false) {
			t.Fatal("degenerate outline removed the conservative circle obstacle")
		}
	}
}
