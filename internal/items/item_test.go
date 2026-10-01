package items

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
)

func recordItem(entity simulation.Entity) map[string]any {
	item := entity.Base()
	var label, price, unlock any
	if item.Label != "" {
		label = item.Label
	}
	if !math.IsNaN(item.Price) {
		price = item.Price
	}
	if item.Unlock != "" {
		unlock = item.Unlock
	}
	hitbox := []any{}
	for _, c := range entity.Hitbox() {
		var points any
		if c.ShapeOutline != nil {
			points = c.ShapeOutline
		}
		hitbox = append(hitbox, map[string]any{"position": c.Position, "radius": c.Radius, "rotation": c.Rotation, "physics": *c.Physics, "friction": c.Friction, "bounciness": c.Bounciness, "points": points, "pickupPoint": c.PickupPoint})
	}
	return map[string]any{"id": item.ID, "position": item.Position, "velocity": item.Velocity, "mass": item.Mass, "angularDrag": item.AngularDrag, "radius": item.Radius, "health": item.Health, "friction": item.Friction, "resource": item.Resource, "label": label, "price": price, "unlock": unlock, "hitbox": hitbox}
}
func compareItemJSON(t *testing.T, actual any, expected json.RawMessage) {
	t.Helper()
	encoded, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	if err = json.Unmarshal(encoded, &a); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(expected, &b); err != nil {
		t.Fatal(err)
	}
	var same func(any, any) bool
	same = func(a, b any) bool {
		switch b := b.(type) {
		case float64:
			n, ok := a.(float64)
			return ok && math.Abs(n-b) <= 2e-8
		case []any:
			v, ok := a.([]any)
			if !ok || len(v) != len(b) {
				return false
			}
			for i, x := range b {
				if !same(v[i], x) {
					return false
				}
			}
			return true
		case map[string]any:
			v, ok := a.(map[string]any)
			if !ok || len(v) != len(b) {
				return false
			}
			for k, x := range b {
				if !same(v[k], x) {
					return false
				}
			}
			return true
		default:
			return reflect.DeepEqual(a, b)
		}
	}
	if !same(a, b) {
		t.Fatalf("got %s\nwant %s", encoded, expected)
	}
}
func TestTypeScriptItemsAndRelease(t *testing.T) {
	data, err := os.ReadFile("../../tests/go-fixtures/items.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Samples []struct {
			Resource   int
			Properties simulation.ObjectProperties
			Result     json.RawMessage
		}
		Changed          bool
		Events, Released json.RawMessage
	}
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	spec, err := specification.Load()
	if err != nil {
		t.Fatal(err)
	}
	types := Types(spec)
	for _, sample := range fixture.Samples {
		item := types[sample.Resource](sample.Properties)
		compareItemJSON(t, recordItem(item), sample.Result)
		colliders := item.Hitbox()
		if colliders[1].ContactFilter(colliders[1], colliders[0]) {
			t.Fatal("pickup point contacted body")
		}
		other := *colliders[0]
		other.Role = "cargoHatch"
		if !colliders[1].ContactFilter(colliders[1], &other) {
			t.Fatal("pickup point rejected hatch")
		}
	}
	world := simulation.CreateWorld(1, spec)
	world.ItemTypes = types
	id := int64(1)
	health := 0.0
	asteroid := simulation.CreateAsteroid(world, simulation.AsteroidProperties{ID: &id, Health: &health, Position: Vec.Create(4, 5), Velocity: Vec.Create(-2, 9), Contents: []int{0, 1, 2, 3, 4}})
	simulation.AddEntity(world, asteroid)
	events := []protocol.SimulationEvent{}
	if asteroid.Fracture(nil, 7, &events, world) != fixture.Changed {
		t.Fatal("fracture result differs")
	}
	actual := []any{}
	world.Entities.ForEach(func(e simulation.Entity, _ int64) { actual = append(actual, recordItem(e)) })
	compareItemJSON(t, actual, fixture.Released)
	event := events[0].(protocol.AsteroidDestroyed)
	compareItemJSON(t, []any{map[string]any{"type": "asteroidDestroyed", "asteroidId": event.AsteroidID, "by": event.By, "contents": event.Contents}}, fixture.Events)
}
