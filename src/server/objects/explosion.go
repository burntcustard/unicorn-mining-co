package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/physics"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/random"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

type ExplosionOptions struct {
	Object          *simulation.GameObject
	Radius, Impulse float64
	MaxSpeed        float64
	Damage          float64
	Events          *[]protocol.SimulationEvent
	Exclude         *collision.Collider
}

func explosionTarget(c *collision.Collider) any {
	if segment, ok := c.AsteroidSegment.(*simulation.AsteroidSegment); ok && segment != nil {
		return segment
	}

	if c.Segment != nil {
		return c.Segment
	}

	return c.Owner
}

func explosionHealth(c *collision.Collider) any {
	if segment, ok := c.Segment.(*simulation.Segment); ok && segment.Mount != nil {
		return segment.Mount
	}

	return explosionTarget(c)
}

func Explode(options ExplosionOptions) {
	object := options.Object

	if object.World == nil {
		return
	}

	world := object.World
	events := options.Events

	if events == nil {
		events = new([]protocol.SimulationEvent)
	}

	// Newly created fragments and resources receive force, but no second damage.
	if options.Damage > 0 {
		for _, entity := range world.Entities.Values() {
			o := entity.Base()

			if o == object || o.Dead || o.Buried || Vec.Distance(o.Position, object.Position) > options.Radius+o.Radius {
				continue
			}

			damaged := map[any]bool{}

			if options.Exclude != nil {
				damaged[explosionHealth(options.Exclude)] = true
			}

			for _, collider := range entity.Hitbox() {
				if collider.Physics != nil && !*collider.Physics || collider.PickupPoint {
					continue
				}

				contact, touching := query.ContactBetween(query.ShapeData{Position: object.Position, Radius: options.Radius}, query.ShapeData{Position: collider.GetPosition(), Rotation: collider.GetRotation(), Radius: collider.GetRadius(), Outline: collider.ShapeOutline, CollisionMargin: collider.CollisionMargin}, world.Specification.Simulation.LinearSlop)
				target := explosionHealth(collider)

				if !touching || damaged[target] {
					continue
				}

				applied := Damage(explosionTarget(collider), options.Damage)

				if applied == 0 {
					continue
				}

				damaged[target] = true
				*events = append(*events, protocol.CollisionEvent{A: object.ID, B: o.ID, Colors: [2]string{"", collision.OutlineColorOf(collider, world.Specification.Colors)}, Damage: [2]float64{0, applied}, Position: contact.Point})
			}

			if asteroid, ok := entity.(*simulation.Asteroid); ok {
				var broken *simulation.AsteroidSegment

				for _, segment := range asteroid.Segments() {
					if segment.Health < 1 {
						broken = segment
						break
					}
				}

				by := int64(0)

				if object.PlayerID != nil {
					by = *object.PlayerID
				}

				asteroid.Fracture(broken, by, events, world)
			}
		}
	}

	object.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		o := entity.Base()

		if o == object || o.Dead || o.Buried {
			return
		}

		offset := Vec.Subtract(o.Position, object.Position)
		distance := Vec.Length(offset)
		falloff := 1 - math.Max(0, distance-o.Radius)/options.Radius

		if falloff <= 0 {
			return
		}

		if distance == 0 {
			offset = object.Velocity
		}

		impulse := options.Impulse

		if options.MaxSpeed > 0 {
			impulse = min(impulse, options.MaxSpeed*o.Mass)
		}

		force := impulse * falloff
		// Cap angular impulse independently of mass and the linear speed limit;
		// ApplyForce then gives heavier bodies proportionally less spin.
		spin := (random.CreateRandom(float64(object.ID)+float64(o.ID)*48271).Next()*2 - 1) * min(options.Impulse/max(1, o.Radius), 6) * falloff
		physics.ApplyForce(o, Vec.Scale(Vec.Normalize(offset), force), spin)
	})
}
