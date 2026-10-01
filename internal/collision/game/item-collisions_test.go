package game

import (
	"github.com/burntcustard/unicorn-mining-co/internal/items"
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"testing"
)

func TestItemCollisionsWithoutContactHandlers(t *testing.T) {
	catalog, err := specification.Load()
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"gold", "amethyst"} {
		for _, otherKind := range []string{"asteroid", "item", "object"} {
			t.Run(kind+"/"+otherKind, func(t *testing.T) {
				world := simulation.CreateWorld(25, catalog)
				collisions := NewGameCollisions(catalog)
				world.Collisions = collisions
				props := simulation.ObjectProperties{ID: new(int64(1)), Velocity: Vec.Create(400, 0), Drag: new(0.0), Health: new(10000.0)}
				var item simulation.Entity
				if kind == "gold" {
					item = items.NewGold(props, catalog)
				} else {
					item = items.NewAmethyst(props, catalog)
				}
				props.ID = new(int64(2))
				props.Position = Vec.Create(item.Base().Radius+19, 0)
				props.Velocity = Vec.Vector{}
				props.Radius = new(20.0)
				props.Mass = new(100.0)
				var other simulation.Entity
				switch otherKind {
				case "asteroid":
					props.ShapeOutline = &simulation.ShapeOutline{Points: []simulation.Point{{-20, -20}, {20, -20}, {20, 20}, {-20, 20}}}
					other = simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: props}, world)
				case "item":
					other = items.NewItem(props, catalog)
				default:
					other = simulation.NewGameObject(props, catalog.Simulation)
				}
				simulation.AddEntity(world, item)
				simulation.AddEntity(world, other)
				events := simulation.UpdateWorld(world, simulation.UpdateWorldOptions{})
				physicalContact := false
				for _, contact := range collisions.contacts {
					if (contact.Collider.Physics == nil || *contact.Collider.Physics) && (contact.Other.Physics == nil || *contact.Other.Physics) {
						physicalContact = true
					}
				}
				if !physicalContact {
					t.Fatal("missing physical contact between item and other object")
				}
				if item.Base().Velocity.X >= 400 || other.Base().Velocity.X <= 0 {
					t.Fatalf("collision did not transfer momentum: item=%v other=%v", item.Base().Velocity, other.Base().Velocity)
				}
				if item.Base().Ballistic || other.Base().Ballistic {
					t.Fatal("colliding objects were treated as free motion")
				}
				if item.Base().Health >= 10000 || other.Base().Health >= 10000 {
					t.Fatalf("collision damage was skipped: item=%v other=%v", item.Base().Health, other.Base().Health)
				}
				found := false
				for _, event := range events {
					if collision, ok := event.(protocol.CollisionEvent); ok && collision.Impact > 0 && (collision.A == 1 && collision.B == 2 || collision.A == 2 && collision.B == 1) {
						found = true
					}
				}
				if !found {
					t.Fatal("missing collision event")
				}
			})
		}
	}
}
