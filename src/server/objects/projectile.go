package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type Projectile struct {
	*simulation.GameObject
	Spec       specs.Module
	SweepStart Vec.Vector
}

func NewProjectile(id string, props simulation.ObjectProperties, catalog specs.Catalog) *Projectile {
	spec := catalog.ModuleSpecs[id]
	p := &Projectile{GameObject: simulation.NewGameObject(props, catalog.Simulation), Spec: spec}
	p.Self = p
	p.Kind = "projectile"
	p.DefinitionID = id
	p.Physics = false
	p.Radius = spec.Projectile.Radius
	p.Health = spec.Damage

	if props.Health != nil {
		p.Health = *props.Health
	}

	p.SweepStart = p.Position
	return p
}

func (p *Projectile) Hitbox() []*collision.Collider { return nil }

func (p *Projectile) CaptureSweep() { p.SweepStart = p.Position }

func (p *Projectile) Update(dt float64) {
	p.Health -= (p.Spec.Damage / p.Spec.Projectile.Lifetime) * dt

	if p.Health <= 0 {
		p.Remove()
		return
	}

	p.Position = Vec.AddScaled(p.Position, p.Velocity, dt)
	p.RoundMotion()
}

func (p *Projectile) OnDeath(events *[]protocol.SimulationEvent) {
	p.explode(events, nil)
}

func (p *Projectile) explode(events *[]protocol.SimulationEvent, exclude *collision.Collider) {
	explosion := p.Spec.Projectile.Explosion

	if explosion != nil {
		Explode(ExplosionOptions{Object: p.GameObject, Radius: explosion.Radius, Impulse: explosion.Impulse, MaxSpeed: explosion.MaxSpeed, Damage: explosion.Damage, Events: events, Exclude: exclude})
	}
}

func (p *Projectile) DeathEvent() protocol.SimulationEvent {
	return protocol.ObjectDestroyed{ObjectID: p.ID, Color: p.Spec.Projectile.Color, Damage: p.Spec.Damage, Position: p.Position}
}

func (p *Projectile) ResolveHits(events *[]protocol.SimulationEvent, world *simulation.World, dt float64) {
	if p.Dead {
		return
	}

	var first *collision.Collider
	fraction := 1.0
	shot := shape.NewCircle(Vec.Vector{}, p.Radius)
	sweepA := collision.NewSweep()
	sweepA.C0, sweepA.C = p.SweepStart, p.Position
	travel := Vec.Distance(p.SweepStart, p.Position)

	world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		o := entity.Base()

		if o == p.GameObject || o.Dead || o.Buried || o.Kind == "projectile" || p.PlayerID != nil && o.PlayerID != nil && *o.PlayerID == *p.PlayerID {
			return
		}

		reach := o.Radius + p.Radius + travel + Vec.Length(o.Velocity)*dt

		if Vec.DistanceSquared(o.Position, p.Position) > reach*reach {
			return
		}

		for _, c := range entity.Hitbox() {
			if c.Physics != nil && !*c.Physics || c.PickupPoint {
				continue
			}

			proxy := shape.NewCircle(Vec.Vector{}, c.GetRadius()).Base()

			if len(c.ShapeOutline) > 0 {
				vertices := make([]Vec.Vector, len(c.ShapeOutline))

				for i, point := range c.ShapeOutline {
					vertices[i] = Vec.Create(point[0], point[1])
				}

				proxy = shape.NewPolygon(vertices, c.CollisionMargin, world.Specification.Simulation.LinearSlop).Base()
			}

			sweepB := collision.NewSweep()
			position, rotation := c.GetPosition(), c.GetRotation()
			sweepB.C, sweepB.C0 = position, Vec.AddScaled(position, o.Velocity, -dt)
			sweepB.A, sweepB.A0 = rotation, rotation-o.Spin*dt
			result := collision.TOIOutput{T: fraction}
			collision.FindTimeOfImpact(&result, collision.TOIInput{ProxyA: shot.Base(), ProxyB: proxy, SweepA: &sweepA, SweepB: &sweepB, TMax: fraction}, world.Specification.Simulation.LinearSlop)

			if (result.Touching || result.T == 0) && (first == nil || result.T < fraction) {
				first = c
				fraction = result.T
			}
		}
	})

	if first == nil {
		return
	}

	var target any = first.Owner

	segment, _ := first.AsteroidSegment.(*simulation.AsteroidSegment)

	if segment != nil {
		target = segment
	} else if first.Segment != nil {
		target = first.Segment
	}

	applied := Damage(target, p.Spec.Damage)
	selfApplied := Damage(p, p.Spec.Damage)
	p.Position = Vec.AddScaled(p.SweepStart, Vec.Subtract(p.Position, p.SweepStart), fraction)

	*events = append(*events, protocol.CollisionEvent{
		A: p.ID, B: first.Owner.(simulation.Entity).Base().ID,
		Impact:   Vec.Distance(p.Velocity, first.Owner.(simulation.Entity).Base().Velocity),
		Colors:   [2]string{p.Spec.Projectile.Color, collision.OutlineColorOf(first, world.Specification.Colors)},
		Damage:   [2]float64{selfApplied, applied},
		Position: p.Position,
	})

	if p.Health <= 0 {
		p.Remove()
		p.explode(events, first)
	}

	if asteroid, ok := first.Owner.(*simulation.Asteroid); ok {
		by := int64(0)

		if p.PlayerID != nil {
			by = *p.PlayerID
		}

		asteroid.Fracture(segment, by, events, world)
	}
}
