package simulation

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func asteroidRecord(a *Asteroid) map[string]any {
	damaged, extent := a.Damaged(), a.Extent()
	outline := ShapeOutlineOf(a).Points
	segments := []any{}

	for _, s := range a.Segments() {
		segments = append(segments, map[string]any{"contents": s.Contents, "health": s.Health, "mass": s.Mass, "maxHealth": s.MaxHealth, "shapeOutline": s.ShapeOutline.Points})
	}

	boundaries := [][]Point{}

	if a.Segments() != nil {
		for _, b := range ShapeOutlinesFrom(a.Segments()) {
			boundaries = append(boundaries, b.Points)
		}
	}

	hitbox := []any{}

	for _, c := range a.Hitbox() {
		hitbox = append(hitbox, map[string]any{"position": c.GetPosition(), "rotation": c.GetRotation(), "radius": c.GetRadius(), "friction": c.GetFriction(), "outline": c.ShapeOutline})
	}

	return map[string]any{"id": a.ID, "position": a.Position, "velocity": a.Velocity, "rotation": a.Rotation, "spin": a.Spin, "radius": a.Radius, "mass": a.Mass, "health": a.Health, "maxHealth": a.MaxHealth, "decay": a.Decay, "contents": a.Contents, "damaged": damaged, "extent": extent, "outline": outline, "segments": segments, "boundaries": boundaries, "hitbox": hitbox}
}

func compareRecordedJSON(t *testing.T, path string, actual any, want json.RawMessage) {
	t.Helper()
	encoded, err := json.Marshal(actual)

	if err != nil {
		t.Fatal(err)
	}

	var a, b any

	if err = json.Unmarshal(encoded, &a); err != nil {
		t.Fatal(err)
	}

	if err = json.Unmarshal(want, &b); err != nil {
		t.Fatal(err)
	}

	var compare func(string, any, any)

	compare = func(path string, a, b any) {
		switch b := b.(type) {
		case float64:
			n, ok := a.(float64)

			if !ok || math.Abs(n-b) > 2e-8 {
				t.Fatalf("%s: got %v, want %v", path, a, b)
			}
		case []any:
			values, ok := a.([]any)

			if !ok || len(values) != len(b) {
				t.Fatalf("%s: array lengths differ: got %v, want %v", path, a, b)
			}

			for i, v := range b {
				compare(fmt.Sprintf("%s[%d]", path, i), values[i], v)
			}
		case map[string]any:
			values, ok := a.(map[string]any)

			if !ok || len(values) != len(b) {
				t.Fatalf("%s: object keys differ: got %v, want %v", path, a, b)
			}

			for k, v := range b {
				compare(path+"."+k, values[k], v)
			}
		default:
			if !reflect.DeepEqual(a, b) {
				t.Fatalf("%s: got %v, want %v", path, a, b)
			}
		}
	}

	compare(path, a, b)
}

func TestAsteroidDebrisLifecycle(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, contents := range [][]int{{}, {0}} {
		world := CreateWorld(1, catalog)

		world.ItemTypes = []func(ObjectProperties) Entity{func(props ObjectProperties) Entity {
			item := NewGameObject(props, catalog.Simulation)
			item.Kind = "item"
			return item
		}}

		parent := CreateAsteroid(world, AsteroidProperties{ID: new(int64(73)), Radius: new(57.0), Contents: contents, Position: Vec.Create(17, -23), Velocity: Vec.Create(2, -3), Rotation: 0.71, Spin: 0.18})
		AddEntity(world, parent)
		target := parent.Segments()[0]

		for _, segment := range parent.Segments() {
			if (len(segment.Contents) > 0) == (len(contents) > 0) {
				target = segment
				break
			}
		}

		detached := parent.Detach(target, world)[0]
		health := detached.Health
		detached.Update(10)

		if detached.Decay != 0 || detached.Health != health || detached.Dead {
			t.Fatal("empty and item-bearing detached segments must persist without decay")
		}

		events := []protocol.SimulationEvent{}
		detached.Health = 0
		detached.Fracture(nil, 1, &events, world)
		debris := []*Asteroid{}
		items := []Entity{}

		for _, entity := range world.Entities.Values() {
			if asteroid, ok := entity.(*Asteroid); ok && asteroid.Decay != 0 {
				debris = append(debris, asteroid)
			} else if entity.Base().Kind == "item" {
				items = append(items, entity)
			}
		}

		retained := 0

		for _, part := range debris {
			retained += len(part.Contents)
		}

		expected := 4

		if len(items) > 0 {
			expected = 3
		}

		if len(debris) != expected || len(items)+retained != len(contents) {
			t.Fatal("destruction must leave a central hole for released items and retain or release every item once")
		}

		area := func(outline *ShapeOutline) float64 {
			sum := 0.0

			for i, p := range outline.Points {
				next := outline.Points[(i+1)%len(outline.Points)]
				sum += p[0]*next[1] - next[0]*p[1]
			}

			return math.Abs(sum) / 2
		}

		healths := map[float64]bool{}
		durations := map[int]bool{}

		for i, part := range debris {
			healths[part.Health] = true
			lifetime := part.Health / part.Decay

			if len(part.ShapeOutline.Points) != 3 || part.Segments() != nil || part.Mass != detached.Mass/8 || math.Abs(area(part.ShapeOutline)-area(detached.ShapeOutline)/4) > 1e-6 {
				t.Fatal("debris must have half the normal mass and quarter the original triangular area")
			}

			if lifetime < 1.5 || lifetime > 3 || part.Health != part.MaxHealth {
				t.Fatal("debris must start at seeded full health for 1.5-3 seconds of decay")
			}

			for _, item := range items {
				if !collision.CollidersCanContact(part.Hitbox()[0], &collision.Collider{Owner: item}) {
					t.Fatal("debris must collide normally with released items")
				}
			}

			count := world.Entities.Len()

			if len(part.Contents) > 0 {
				health := part.Health
				part.Update(60)

				if part.Dead || part.Decaying() || part.Health != health {
					t.Fatal("item-bearing debris must not decay")
				}

				part.Health -= health
				part.Fracture(nil, 1, &events, world)

				if !part.Dead || world.Entities.Len() != count-1+len(part.Contents) {
					t.Fatal("mining retained loot must release it without further subdivision")
				}

				continue
			}

			if i == 0 {
				part.Health = 0
				part.Fracture(nil, 1, &events, world)

				if world.Entities.Len() != count-1 {
					t.Fatal("destroying debris must remove it without further subdivision")
				}
			} else {
				ticks := 0

				for !part.Dead && ticks < 120 {
					part.Update(catalog.Simulation.SimulationStep)
					ticks++
				}

				elapsed := float64(ticks) * catalog.Simulation.SimulationStep

				if !part.Dead || elapsed < 1.5 || elapsed > 3+catalog.Simulation.SimulationStep || world.Entities.Len() != count-1 {
					t.Fatal("debris must disappear after 1.5-3 seconds without further subdivision")
				}

				durations[ticks] = true
			}
		}

		if len(healths) != expected || len(durations) == 0 || len(contents) == 0 && len(durations) < 2 {
			t.Fatal("debris health and expiration times must be staggered")
		}
	}
}

func TestAsteroidDebrisFitsRoundItems(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := CreateWorld(1, catalog)
	outline := &ShapeOutline{Points: []Point{{0, 0}, {24, 0}, {0, 24}}}
	asteroid := CreateAsteroid(world, AsteroidProperties{ShapeOutline: outline})
	spec := catalog.ItemSpecs[catalog.ItemIDs[0]]
	spec.Points = nil

	for _, radius := range []float64{2.6, 2.7, 5.6} {
		spec.Radius = radius
		world.Specification.ItemSpecs[catalog.ItemIDs[0]] = spec

		if got := asteroid.itemFits(outline, 0, 0); got != (radius == 2.6) {
			t.Fatalf("round item radius %v fit: got %v", radius, got)
		}

		for _, size := range []float64{1.8, 2, 4} {
			spec.Points = []specs.Point{{-size, -size}, {size, -size}, {size, size}, {-size, size}}
			world.Specification.ItemSpecs[catalog.ItemIDs[0]] = spec

			if got := asteroid.itemFits(outline, 0, 0); got != (size == 1.8) {
				t.Fatalf("polygon item half-width %v fit: got %v", size, got)
			}
		}
	}
}

func TestMiningShortensAsteroidDebrisDecay(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := CreateWorld(1, catalog)
	debris := CreateAsteroid(world, AsteroidProperties{Decay: new(6.0), Health: new(12.0), ShapeOutline: &ShapeOutline{Points: []Point{{-3, -2}, {3, -2}, {0, 4}}}})
	AddEntity(world, debris)
	debris.Health -= 6
	debris.Update(1 + catalog.Simulation.SimulationStep)

	if !debris.Dead || world.Entities.Len() != 0 {
		t.Fatal("damage must shorten health-based decay, not leave an independent lifetime timer running")
	}
}

func TestTypeScriptAsteroidFractures(t *testing.T) {
	data, err := os.ReadFile("../../../tests/fixtures/asteroids.json")

	if err != nil {
		t.Fatal(err)
	}

	var samples []struct {
		Properties AsteroidProperties
		Initial    json.RawMessage
		Drops      json.RawMessage
		Debris     json.RawMessage
		Contacts   []struct {
			Position Vec.Vector
			Radius   float64
			Contact  json.RawMessage
		}
		Steps []struct {
			ID           int64
			SegmentIndex int
			Changed      bool
			Events       json.RawMessage
			Entities     json.RawMessage
		}
	}

	if err = json.Unmarshal(data, &samples); err != nil {
		t.Fatal(err)
	}

	spec, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for i, sample := range samples {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			world := CreateWorld(1, spec)
			a := CreateAsteroid(world, sample.Properties).LockGeometry()
			AddEntity(world, a)
			source := a.GeometrySource()
			compareRecordedJSON(t, "initial", asteroidRecord(a), sample.Initial)

			if source != a.GeometrySource() {
				t.Fatal("cutting changed locked geometry identity")
			}

			colliders := a.Hitbox()
			original := a.Position
			a.Position.X += 10

			if colliders[0].GetPosition() != a.Position {
				t.Fatal("cached collider pose is stale")
			}

			a.Position = original

			if colliders[0] != a.Hitbox()[0] {
				t.Fatal("locked collider identity changed")
			}

			for _, contact := range sample.Contacts {
				normal, overlap, ok := AsteroidContact(a, contact.Position, contact.Radius)
				var actual any

				if ok {
					actual = map[string]any{"normal": normal, "overlap": overlap}
				}

				compareRecordedJSON(t, "contact", actual, contact.Contact)
			}

			for j, step := range sample.Steps {
				target, ok := world.Entities.Get(step.ID)

				if !ok {
					t.Fatal("missing target", step.ID)
				}

				asteroid := target.(*Asteroid)
				segment := asteroid.Segments()[step.SegmentIndex]
				segment.Health = 0
				events := []protocol.SimulationEvent{}

				if got := asteroid.Fracture(segment, 1, &events, world); got != step.Changed {
					t.Fatal("fracture result differs")
				}

				eventRecords := []any{}

				for _, e := range events {
					event := e.(protocol.AsteroidSplit)
					eventRecords = append(eventRecords, map[string]any{"type": "asteroidSplit", "asteroidId": event.AsteroidID, "childIds": event.ChildIDs})
				}

				compareRecordedJSON(t, fmt.Sprintf("step%d.events", j), eventRecords, step.Events)
				entities := []any{}

				world.Entities.ForEach(func(e Entity, _ int64) { entities = append(entities, asteroidRecord(e.(*Asteroid))) })

				compareRecordedJSON(t, fmt.Sprintf("step%d.entities", j), entities, step.Entities)
			}

			for resource := range len(spec.ItemIDs) {
				world.ItemTypes = append(world.ItemTypes, func(props ObjectProperties) Entity {
					props.Resource = &resource
					return NewGameObject(props, spec.Simulation)
				})
			}

			for _, entity := range world.Entities.Values() {
				asteroid := entity.(*Asteroid)
				asteroid.Health = 0
				events := []protocol.SimulationEvent{}
				asteroid.Fracture(nil, 1, &events, world)
			}

			drops := []any{}
			debris := []any{}

			for _, entity := range world.Entities.Values() {
				if asteroid, ok := entity.(*Asteroid); ok {
					debris = append(debris, asteroidRecord(asteroid))
					continue
				}

				item := entity.Base()
				drops = append(drops, map[string]any{"id": item.ID, "position": item.Position, "velocity": item.Velocity, "rotation": item.Rotation, "spin": item.Spin, "resource": item.Resource})
			}

			compareRecordedJSON(t, "drops", drops, sample.Drops)
			compareRecordedJSON(t, "debris", debris, sample.Debris)
		})
	}
}
