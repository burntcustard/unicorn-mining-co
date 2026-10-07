package objects

import (
	"math"
	"reflect"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestItems(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, id := range catalog.ItemIDs {
		t.Run(id, func(t *testing.T) {
			spec := catalog.ItemSpecs[id]
			item := NewItem(id, simulation.ObjectProperties{ID: new(int64(1))}, catalog)

			if item.Kind != "item" || !item.Item || !item.HasResource || item.Resource != spec.Resource || item.Name != spec.Name || item.Unlock != spec.Unlock || !reflect.DeepEqual(item.Shades, spec.Shades) {
				t.Fatal("item did not consume its spec")
			}

			if spec.Price == nil && !math.IsNaN(item.Price) || spec.Price != nil && item.Price != *spec.Price {
				t.Fatal("item price differs from its spec")
			}

			for name, actual := range map[string]float64{"mass": item.Mass, "angularDrag": item.AngularDrag, "health": item.Health, "bounciness": *item.Bounciness} {
				if actual != catalog.ItemDefaults[name] {
					t.Errorf("%s: got %g, want %g", name, actual, catalog.ItemDefaults[name])
				}
			}

			radius := catalog.ItemDefaults["radius"]

			if spec.Radius != 0 {
				radius = spec.Radius
			}

			if spec.Points != nil {
				radius = 0

				for i, point := range spec.Points {
					radius = math.Max(radius, math.Hypot(point[0], point[1]))

					if item.ShapeOutline == nil || len(item.ShapeOutline.Points) != len(spec.Points) || item.ShapeOutline.Points[i] != simulation.Point(point) {
						t.Fatal("item outline differs from its spec")
					}
				}
			} else if item.ShapeOutline != nil {
				t.Fatal("circular item acquired a polygon outline")
			}

			if math.Abs(item.Radius-radius) > 2e-8 || item.Friction != specs.GameObjectFriction {
				t.Fatal("item geometry or friction differs from its spec")
			}

			props := simulation.ObjectProperties{ID: new(int64(100 + spec.Resource)), Position: Vec.Create(-2, 9), Velocity: Vec.Create(1, 2), Mass: new(12.0), Health: new(0.5), AngularDrag: new(0.25), Radius: new(8.0)}
			item = NewItem(id, props, catalog)

			if item.ID != *props.ID || item.Position != props.Position || item.Velocity != props.Velocity || item.Mass != *props.Mass || item.Health != *props.Health || item.AngularDrag != *props.AngularDrag {
				t.Fatal("instance properties did not override item defaults")
			}

			if spec.Points == nil {
				radius = *props.Radius
			}

			if math.Abs(item.Radius-radius) > 2e-8 {
				t.Fatal("polygon bounds must override radius; circles must use the instance radius")
			}

			colliders := item.Hitbox()

			if len(colliders) != 2 {
				t.Fatalf("got %d colliders, want body and pickup point", len(colliders))
			}

			body, pickup := colliders[0], colliders[1]

			if body.Position != item.Position || body.Radius != item.Radius || !*body.Physics || body.Friction != item.Friction || body.Bounciness == nil || *body.Bounciness != *item.Bounciness {
				t.Fatal("body collider differs from item mechanics")
			}

			if pickup.Position != item.Position || pickup.Radius != 0 || *pickup.Physics || !pickup.PickupPoint || pickup.ContactFilter(pickup, body) {
				t.Fatal("pickup point must be nonphysical and reject the body")
			}

			other := *body
			other.Role = "cargoHatch"

			if !pickup.ContactFilter(pickup, &other) {
				t.Fatal("pickup point rejected hatch")
			}
		})
	}
}

func TestAsteroidDropsItems(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(1, catalog)
	world.ItemTypes = ItemTypes(catalog)
	contents := []int{0, 1, 2, 3, 4}
	outline := &simulation.ShapeOutline{Points: []simulation.Point{{-3, -1}, {3, -1}, {0, 2}}}
	asteroid := simulation.CreateAsteroid(world, simulation.AsteroidProperties{ID: new(int64(1)), Health: new(0.0), Position: Vec.Create(4, 5), Velocity: Vec.Create(-2, 9), Rotation: 0.7, Spin: 0.2, ShapeOutline: outline, Contents: contents})
	simulation.AddEntity(world, asteroid)
	events := []protocol.SimulationEvent{}

	if !asteroid.Fracture(nil, 7, &events, world) || world.Entities.Has(asteroid.ID) {
		t.Fatal("destroyed asteroid was not removed")
	}

	drops := world.Entities.Values()

	if len(drops) != len(contents) {
		t.Fatalf("got %d drops, want %d", len(drops), len(contents))
	}

	for i, entity := range drops {
		item, ok := entity.(*Item)

		if !ok || item.ID != int64(i+2) || item.Resource != contents[i] || item.Position != asteroid.Position || item.Velocity != asteroid.Velocity || item.Mass != catalog.ItemDefaults["mass"] || item.Health != catalog.ItemDefaults["health"] {
			t.Fatalf("drop %d did not inherit its resource, motion, and defaults", i)
		}

		if item.Rotation != asteroid.Rotation+float64(i) || item.Spin == asteroid.Spin || math.Abs(item.Spin-asteroid.Spin) > 0.25 {
			t.Fatal("released items must keep their buried angle and gain a small spin")
		}
	}

	want := []protocol.SimulationEvent{protocol.AsteroidDestroyed{AsteroidID: asteroid.ID, By: 7, Contents: contents}}

	if !reflect.DeepEqual(events, want) {
		t.Fatalf("got events %#v, want %#v", events, want)
	}

	if asteroid.Fracture(nil, 7, &events, world) || len(world.Entities.Values()) != len(drops) || !reflect.DeepEqual(events, want) {
		t.Fatal("repeated fracture duplicated drops or events")
	}
}
