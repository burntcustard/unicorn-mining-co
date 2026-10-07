package simulation

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"testing"

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

func TestTypeScriptAsteroidFractures(t *testing.T) {
	data, err := os.ReadFile("../../../tests/fixtures/asteroids.json")

	if err != nil {
		t.Fatal(err)
	}

	var samples []struct {
		Properties AsteroidProperties
		Initial    json.RawMessage
		Drops      json.RawMessage
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

			for resource := range 4 {
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

			for _, entity := range world.Entities.Values() {
				item := entity.Base()
				drops = append(drops, map[string]any{"id": item.ID, "position": item.Position, "velocity": item.Velocity, "rotation": item.Rotation, "spin": item.Spin, "resource": item.Resource})
			}

			compareRecordedJSON(t, "drops", drops, sample.Drops)
		})
	}
}
