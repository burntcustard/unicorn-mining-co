package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func (s *Ship) ResolveLasers(dt float64, events *[]protocol.SimulationEvent) {
	if s.World == nil || s.PlayerID == nil || !s.Firing || s.Dead || s.DockedTo != nil && *s.DockedTo != 0 || s.Launching != 0 {
		return
	}
	var modules [16]simulation.Module
	for _, module := range s.AppendModules(modules[:0]) {
		m := module.ModuleBase()
		if m.Spec.Behavior != "beam" || m.Mount == nil || m.Mount.Health <= 0 {
			continue
		}
		active := false
		for _, segment := range s.Segments {
			if segment.Module == module && segment.Active == 1 && segment.ActivationProgress == 1 {
				active = true
				break
			}
		}
		if !active {
			continue
		}
		s.resolveLaser(module, dt, events)
	}
}

func (s *Ship) resolveLaser(module simulation.Module, dt float64, events *[]protocol.SimulationEvent) {
	m := module.ModuleBase()
	spec, world := m.Spec, s.World
	start := Vec.Add(s.Position, simulation.RotatePoint(Vec.Add(m.Mount.LocalPosition, Vec.Create(spec.BarrelLength, 0)), s.Rotation))
	end := Vec.Add(start, simulation.RotatePoint(Vec.Create(spec.Reach, 0), s.Rotation))
	var first *collision.Collider
	fraction := 1.0
	shot := shape.NewCircle(Vec.Vector{}, 0.5)
	sweepA := collision.NewSweep()
	sweepA.C0, sweepA.C = start, end
	travel := spec.Reach

	world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		o := entity.Base()

		if o == s.GameObject || o.Dead || o.Buried || o.Kind == "projectile" || s.PlayerID != nil && o.PlayerID != nil && *o.PlayerID == *s.PlayerID {
			return
		}

		reach := o.Radius + 0.5 + travel

		if Vec.DistanceSquared(o.Position, end) > reach*reach {
			return
		}

		for _, c := range entity.Hitbox() {
			segment, _ := c.Segment.(*simulation.Segment)

			if c.Physics != nil && !*c.Physics && !(o.Kind == "station" && segment != nil && segment.Hull) || c.PickupPoint {
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
			sweepB.C, sweepB.C0 = position, position
			sweepB.A, sweepB.A0 = rotation, rotation
			result := collision.TOIOutput{T: fraction}
			collision.FindTimeOfImpact(&result, collision.TOIInput{ProxyA: shot.Base(), ProxyB: proxy, SweepA: &sweepA, SweepB: &sweepB, TMax: fraction}, world.Specification.Simulation.LinearSlop)

			if (result.Touching || result.T == 0) && (first == nil || result.T < fraction) {
				first = c
				fraction = result.T
			}
		}
	})

	if first == nil || first.Physics != nil && !*first.Physics {
		return
	}
	var target any = first.Owner
	segment, _ := first.AsteroidSegment.(*simulation.AsteroidSegment)
	if segment != nil {
		target = segment
	} else if first.Segment != nil {
		target = first.Segment
	}
	Damage(target, spec.Damage*spec.DamageStepsPerSecond*dt)
	if asteroid, ok := first.Owner.(*simulation.Asteroid); ok {
		asteroid.Fracture(segment, *s.PlayerID, events, world)
	}
}
