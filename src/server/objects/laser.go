package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func (s *Ship) ResolveLasers(dt float64, events *[]protocol.SimulationEvent) {
	if s.World == nil || !s.Firing || s.Dead || s.DockedTo != nil && *s.DockedTo != 0 || s.Launching != 0 {
		return
	}

	s.resolveCrystalBeams(dt, events)

	if s.PlayerID == nil {
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
	spec := &m.Spec
	start := s.weaponPosition(m, spec.BarrelLength)
	end := Vec.Add(start, simulation.RotatePoint(Vec.Create(spec.Reach, 0), s.Rotation+m.AimRotation))
	first, length := s.traceLaser(start, end)
	s.laserHit(first, start, end, length, spec.Damage*30*dt, events)
}

func (s *Ship) traceLaser(start, end Vec.Vector) (*collision.Collider, float64) {
	world := s.World
	var first *collision.Collider
	fraction := 1.0
	shot := shape.NewCircle(Vec.Vector{}, 0.5)
	sweepA := collision.NewSweep()
	sweepA.C0, sweepA.C = start, end
	travel := Vec.Distance(start, end)

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

	return first, travel * fraction
}

func (s *Ship) laserHit(first *collision.Collider, start, end Vec.Vector, length, amount float64, events *[]protocol.SimulationEvent) {
	world := s.World
	by := int64(0)

	if s.PlayerID != nil {
		by = *s.PlayerID
	}

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

	applied := Damage(target, amount)

	if applied <= 0 {
		return
	}

	*events = append(*events, protocol.LaserDamage{
		TargetID: first.Owner.(simulation.Entity).Base().ID,
		By:       by,
		Damage:   applied,
		Color:    collision.OutlineColorOf(first, s.Catalog.Colors),
		Position: Vec.Add(start, Vec.Scale(Vec.Subtract(end, start), length/Vec.Distance(start, end))),
	})

	if asteroid, ok := first.Owner.(*simulation.Asteroid); ok {
		asteroid.Fracture(segment, by, events, world)
	}
}
