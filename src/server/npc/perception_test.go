package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

func TestVisibilityUsesRangeAndAsteroidCover(t *testing.T) {
	ship := flightShip(t)
	other := objects.CreatePlayerShip(ship.World, objects.Properties{PlayerID: new(int64(2))})
	simulation.AddEntity(ship.World, other)
	rock := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: ship.World, Position: Vec.Create(600, 0), Radius: new(100.0), ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{-90, -30}, {90, -30}, {90, 30}, {-90, 30}}}}}, ship.World)
	simulation.AddEntity(ship.World, rock)

	for _, scenario := range []struct {
		name             string
		distance         float64
		covered, visible bool
	}{
		{"nearby through rock", 999, true, true},
		{"sensor boundary", 1000, true, true},
		{"beyond sensor behind rock", 1000.01, true, false},
		{"distant behind rock", 1490, true, false},
		{"distant clear", 1200, false, true},
		{"sight boundary", 1500, false, true},
		{"beyond sight", 1500.01, false, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			other.Position = Vec.Create(scenario.distance, 0)
			rock.Position.Y = 300

			if scenario.covered {
				rock.Position.Y = 0
			}

			rock.Rotation = math.Pi / 3

			if CanSee(ship, other) != scenario.visible {
				t.Fatal("visibility did not match range and cover")
			}
		})
	}

	other.Position = Vec.Create(1200, 0)
	rock.Remove()

	if !CanSee(ship, other) {
		t.Fatal("destroyed rock still obscured the player")
	}

	other.DockedTo = new(int64(99))

	if CanSee(ship, other) {
		t.Fatal("docked player remained visible")
	}

	other.DockedTo = nil
	other.TransitTime = 1

	if CanSee(ship, other) {
		t.Fatal("a player in transit remained visible")
	}

	other.TransitTime = 0
	other.Remove()

	if CanSee(ship, other) {
		t.Fatal("a removed player remained visible")
	}
}

func TestVisibilityUsesRemainingRockRatherThanItsRadius(t *testing.T) {
	ship := flightShip(t)
	other := objects.CreatePlayerShip(ship.World, objects.Properties{PlayerID: new(int64(2)), Position: Vec.Create(1200, 0)})
	simulation.AddEntity(ship.World, other)

	segment := func(bottom, top float64) *simulation.AsteroidSegment {
		return &simulation.AsteroidSegment{Health: 10, MaxHealth: 10, Mass: 1, ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{-100, bottom}, {100, bottom}, {100, top}, {-100, top}}}}
	}

	rock := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: ship.World, Position: Vec.Create(600, 0), Radius: new(160.0)}, Segments: []*simulation.AsteroidSegment{segment(-120, -20), segment(20, 120)}}, ship.World)
	simulation.AddEntity(ship.World, rock)

	if !CanSee(ship, other) {
		t.Fatal("the mined gap between surviving segments blocked sight")
	}

	rock.Rotation = math.Pi / 2

	if CanSee(ship, other) {
		t.Fatal("rotated surviving rock failed to obscure the player")
	}
}

type fixtureObject struct {
	*simulation.GameObject
	fixture *collision.Collider
}

func (o *fixtureObject) Hitbox() []*collision.Collider { return []*collision.Collider{o.fixture} }

func TestObstaclesFollowPhysicalFixturesAcrossObjectKinds(t *testing.T) {
	ship := arrivalShip(t, "finch")
	world := ship.World
	other := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(2)), Position: Vec.Create(300, 0)})
	station := objects.NewStation("corral-5", objects.Properties{ObjectProperties: simulation.ObjectProperties{World: world, Position: Vec.Create(2000, 0)}}, ship.Catalog)
	fragment := objects.CreateWreckage(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: world, Position: Vec.Create(600, 0)}}, []objects.WreckageSegment{{Offset: Vec.Create(20, 0), Radius: 15, Health: 10}}, ship.Catalog)
	compound := &fixtureObject{GameObject: simulation.NewGameObject(simulation.ObjectProperties{World: world, Position: Vec.Create(900, 0), Physics: new(false)}, ship.Catalog.Simulation)}
	compound.Self = compound
	compound.fixture = &collision.Collider{Owner: compound, Position: compound.Position, Radius: 25, Physics: new(true)}
	trigger := simulation.NewGameObject(simulation.ObjectProperties{World: world, Position: Vec.Create(1200, 0), Radius: new(50.0), Physics: new(false)}, ship.Catalog.Simulation)

	for _, entity := range []simulation.Entity{other, station, fragment, compound, trigger} {
		simulation.AddEntity(world, entity)
	}

	assertCount := func(want int) {
		t.Helper()

		if obstacles := obstaclesFor(ship, 0); len(obstacles) != want {
			t.Fatalf("captured %d obstacles, want %d: %+v", len(obstacles), want, obstacles)
		}
	}

	assertCount(4)
	other.DockedTo = &station.ID
	assertCount(3)
	other.DockedTo = nil
	other.TransitTime = 1
	assertCount(3)
	other.TransitTime = 0
	fragment.Dead = true
	assertCount(3)

	if obstacles := obstaclesFor(ship, station.ID); len(obstacles) != 2 {
		t.Fatal("explicit docking destination was not excluded")
	}
}

type shipContacts struct {
	*gameplay.GameCollisions
	first, second int64
	touching      bool
}

func (c *shipContacts) Step(entities *utilities.OrderedMap[int64, simulation.Entity], dt float64, events *[]protocol.SimulationEvent) []collision.Contact {
	contacts := c.GameCollisions.Step(entities, dt, events)

	for _, contact := range contacts {
		a := contact.Collider.Owner.(simulation.Entity).Base().ID
		b := contact.Other.Owner.(simulation.Entity).Base().ID

		if a == c.first && b == c.second || a == c.second && b == c.first {
			c.touching = true
		}
	}

	return contacts
}

/*
Use actual ship hulls, contacts, ordinary controls and the normal AI cadence.
Both NPC hull layouts must pass stationary, crossing and opposing traffic.
*/
func TestPilotsAvoidOtherShipsThroughRealPhysics(t *testing.T) {
	for _, definition := range []string{"finch", "courser"} {
		for _, scenario := range []string{"stationary", "crossing", "opposing", "waiting", "arrival", "pickup"} {
			t.Run(definition+"/"+scenario, func(t *testing.T) {
				ship := arrivalShip(t, definition)
				world := ship.World
				ship.Velocity = Vec.Create(150, 0)
				other := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "finch", PlayerID: new(int64(2)), Position: Vec.Create(350, 0)})
				simulation.AddEntity(world, other)
				contacts := &shipContacts{GameCollisions: gameplay.NewGameCollisions(ship.Catalog), first: ship.ID, second: other.ID}
				world.Collisions = contacts
				pilot, second := &Pilot{}, &Pilot{}
				movement := Movement{Position: Vec.Create(1100, 0)}
				var item *objects.Item

				switch scenario {
				case "crossing":
					other.Position, other.Velocity = Vec.Create(300, -160), Vec.Create(0, 120)
					other.Face(math.Pi / 2)
				case "opposing":
					other.Position, other.Velocity = Vec.Create(800, 0), Vec.Create(-150, 0)
					other.Face(math.Pi)
				case "waiting", "arrival":
					ship.Velocity = Vec.Vector{}
					movement.Waiting = scenario == "waiting"

					if scenario == "arrival" {
						movement.Position = ship.Position
					}

					other.Position, other.Velocity = Vec.Create(350, 0), Vec.Create(-120, 0)
					other.Face(math.Pi)
				case "pickup":
					ship.Velocity = Vec.Vector{}
					other.Position = Vec.Create(85, 0)
					collectionThroat(t, ship)
					item = objects.NewItem("gold", simulation.ObjectProperties{World: world, Position: Vec.Create(160, 0)}, ship.Catalog)
					simulation.AddEntity(world, item)
				}

				thrust, turn, otherThrust, otherTurn := 0.0, 0.0, 0.0, 0.0

				for tick := range 30 * 15 {
					if tick%steeringIntervalTicks(ship) == 0 {
						if item != nil {
							movement = Movement{Position: item.Position, Velocity: item.Velocity, IgnoreID: item.ID, Collect: true}
						}

						thrust, turn = pilot.Steer(ship, movement)

						if scenario == "opposing" {
							otherThrust, otherTurn = second.Steer(other, Movement{Position: Vec.Create(-400, 0)})
						} else if scenario == "crossing" || scenario == "waiting" || scenario == "arrival" {
							otherThrust, otherTurn = targetFlight(other, 120, other.Rotation)
						}
					}

					ship.Fly(thrust, turn)
					other.Fly(otherThrust, otherTurn)
					simulation.UpdateWorld(world, simulation.UpdateWorldOptions{})

					if contacts.touching {
						t.Fatalf("ship contact at %.3fs: pilot=%v other=%v", float64(tick+1)/30, ship.Position, other.Position)
					}

					if item != nil && len(ship.CargoContents) > 0 {
						break
					}
				}

				if scenario != "waiting" && scenario != "arrival" && scenario != "pickup" && ship.Position.X < 900 {
					t.Fatalf("avoiding traffic stopped progress: position=%v", ship.Position)
				}

				if item != nil && len(ship.CargoContents) == 0 {
					t.Fatal("ship never collected the item behind stationary traffic")
				}
			})
		}
	}
}

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
