package physics

import (
	"encoding/json"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"os"
	"reflect"
	"testing"
)

type recordedBody struct {
	Position Vec.Vector
	Rotation float64
	Velocity Vec.Vector
	Spin     float64
}

type recordedContact struct {
	A, B        int
	Type        string
	Count       int
	Normal      Vec.Vector
	Points      [2]Vec.Vector
	Separations [2]float64
}

func TestCollisionNeighborsCountBodiesAndKeepTies(t *testing.T) {
	spec, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := NewWorld(spec.Simulation)
	world.LimitCollisionNeighbors = true
	center := world.CreateBody()
	center.CreateFixture(shape.NewCircle(Vec.Create(0, 0), 20), FixtureOpt{Physics: new(false)})
	neighbors := make([]*Body, 9)

	for i := range neighbors {
		neighbors[i] = world.CreateBody()
		neighbors[i].SetTransform(Vec.Create(float64(i+1), 0), 0)

		if i == 8 {
			break
		}

		for _, radius := range []float64{0.5, 0.6} {
			neighbors[i].CreateFixture(shape.NewCircle(Vec.Create(0, 0), radius), FixtureOpt{Physics: new(false)})
		}
	}

	world.Step(0, 8, 3)

	if center.Neighborhood != nil {
		t.Fatal("sixteen fixtures belonging to eight neighbors incorrectly triggered the cap")
	}

	neighbors[8].CreateFixture(shape.NewCircle(Vec.Create(0, 0), 0.5), FixtureOpt{Physics: new(false)})
	world.Step(0, 8, 3)

	if center.Neighborhood == nil || center.Neighborhood.Count != 8 || center.AllowsCollision(neighbors[8]) {
		t.Fatal("ninth body was not deferred")
	}

	neighbors[0].SetTransform(Vec.Create(100, 0), 0)
	world.Step(0, 8, 3)

	if !center.AllowsCollision(neighbors[8]) {
		t.Fatal("deferred body was not reconsidered after a closer body moved away")
	}

	center.Neighborhood = &CollisionNeighborhood{}

	for _, body := range neighbors {
		center.AddCollisionNeighbor(body, 1)
	}

	for i, body := range center.Neighborhood.Bodies {
		if body != neighbors[i] {
			t.Fatal("equal-distance neighbors changed their first-index order")
		}
	}
}

func TestTypeScriptPhysicsWorld(t *testing.T) {
	data, err := os.ReadFile("../../../tests/fixtures/physics-world.json")

	if err != nil {
		t.Fatal(err)
	}

	var scenarios []struct {
		Count int
		Poses []struct {
			Bodies   []recordedBody
			Contacts [][2]int
			Events   []recordedContact
		}
	}

	if err = json.Unmarshal(data, &scenarios); err != nil {
		t.Fatal(err)
	}

	spec, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, scenario := range scenarios {
		t.Run(fmt.Sprint(scenario.Count), func(t *testing.T) {
			count := scenario.Count
			world := NewWorld(spec.Simulation)
			bodies := make([]*Body, count)
			fixtures := make([]*Fixture, count)

			makeShape := func(i int) shape.Shape {
				if i%3 == 0 {
					return shape.NewCircle(Vec.Create(1, -1), 8)
				}

				return shape.NewPolygon([]Vec.Vector{Vec.Create(-8, -6), Vec.Create(8, -6), Vec.Create(8, 6), Vec.Create(-8, 6)}, nil, spec.Simulation.LinearSlop)
			}

			for i := range bodies {
				bodies[i] = world.CreateBody()
				bodies[i].SetMass(float64(10+i), float64(300+i*30))
			}

			for i, b := range bodies {
				physical := i%7 != 6
				fixtures[i] = b.CreateFixture(makeShape(i), FixtureOpt{UserData: i + 1, Physics: &physical})
			}

			events := []recordedContact{}

			world.OnPreSolve(func(c *Contact) {
				c.Friction = 0.2
				c.Restitution = 0.15
				c.SurfaceSpeed = 0

				if c.FixtureA.UserData == 2 {
					c.SurfaceSpeed = 0.3
				}

				wm := c.GetWorldManifold(nil)
				events = append(events, recordedContact{A: c.FixtureA.UserData.(int), B: c.FixtureB.UserData.(int), Type: c.Manifold.Type, Count: c.Manifold.PointCount, Normal: wm.Normal, Points: wm.Points, Separations: wm.Separations})
			})

			closeNumber := func(got, want float64) bool { return !math.IsNaN(got) && math.Abs(got-want) <= 2e-8 }

			closeVector := func(got, want Vec.Vector) bool { return closeNumber(got.X, want.X) && closeNumber(got.Y, want.Y) }

			for tick, want := range scenario.Poses {
				if tick%40 == 0 {
					for i, b := range bodies {
						if b.Destroyed {
							continue
						}

						angle := float64(i) / float64(count) * math.Pi * 2
						radius := 60.0

						if tick%80 == 0 {
							radius = 12
						}

						b.SetTransform(Vec.Create(math.Cos(angle)*radius, math.Sin(angle)*radius), angle*0.1)
						b.LinearVelocity = Vec.Create(-math.Cos(angle)*180, -math.Sin(angle)*180)
						b.AngularVelocity = -0.3

						if i%2 != 0 {
							b.AngularVelocity = 0.2
						}
					}
				}

				if tick == 75 {
					bodies[2].DestroyFixture(fixtures[2])
					fixtures[2] = bodies[2].CreateFixture(makeShape(2), FixtureOpt{UserData: 103})
				}

				if tick == 200 {
					world.DestroyBody(bodies[count-1])
				}

				events = events[:0]
				world.Step(spec.Simulation.SimulationStep, 8, 3)
				contacts := [][2]int{}

				for c := world.ContactList; c != nil; c = c.Next {
					contacts = append(contacts, [2]int{c.FixtureA.UserData.(int), c.FixtureB.UserData.(int)})
				}

				if !reflect.DeepEqual(contacts, want.Contacts) {
					t.Fatalf("tick %d contact list %v want %v", tick, contacts, want.Contacts)
				}

				if len(events) != len(want.Events) {
					t.Fatalf("tick %d events %d want %d", tick, len(events), len(want.Events))
				}

				for i, e := range events {
					w := want.Events[i]

					if e.A != w.A || e.B != w.B || e.Type != w.Type || e.Count != w.Count || !closeVector(e.Normal, w.Normal) {
						t.Fatalf("tick %d event %d: %+v want %+v", tick, i, e, w)
					}

					for j := range 2 {
						if !closeVector(e.Points[j], w.Points[j]) || !closeNumber(e.Separations[j], w.Separations[j]) {
							t.Fatalf("tick %d event %d point %d: %+v want %+v", tick, i, j, e, w)
						}
					}
				}

				for i, b := range bodies {
					w := want.Bodies[i]

					if !closeVector(b.GetPosition(), w.Position) || !closeNumber(b.GetAngle(), w.Rotation) || !closeVector(b.LinearVelocity, w.Velocity) || !closeNumber(b.AngularVelocity, w.Spin) {
						t.Fatalf("tick %d body %d: position %+v angle %.17g velocity %+v spin %.17g; want %+v", tick, i, b.GetPosition(), b.GetAngle(), b.LinearVelocity, b.AngularVelocity, w)
					}
				}
			}
		})
	}
}
