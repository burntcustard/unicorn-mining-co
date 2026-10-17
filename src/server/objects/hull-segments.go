package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
)

func hullPlans(segments []specs.HullSegment) []*simulation.SegmentPlan {
	plans := make([]*simulation.SegmentPlan, len(segments))

	for i, segment := range segments {
		outline := &simulation.ShapeOutline{Points: make([]simulation.Point, len(segment.Points))}

		for j, point := range segment.Points {
			outline.Points[j] = simulation.Point(point)
		}

		plans[i] = &simulation.SegmentPlan{Health: segment.Health, Points: outline, DisablePhysics: segment.DisablePhysics, DockSegment: segment.DockSegment, Shades: segment.Shades, ZIndex: segment.ZIndex}

		for _, mount := range segment.Mounts {
			plans[i].Mounts = append(plans[i].Mounts, simulation.NewMount(mount))
		}
	}

	return plans
}

func makeSegment(object *simulation.GameObject, zIndex int, module simulation.Module, plan *simulation.SegmentPlan, mount *simulation.Mount) *simulation.Segment {
	s := &simulation.Segment{SegmentPlan: *plan, Hull: mount == nil, Module: module, Mount: mount, Health: math.NaN()}

	if module == nil {
		s.HullPlan = plan
	}

	if plan.Health != nil {
		s.Health = *plan.Health
	}

	duration := plan.ActivationDuration
	spec := s.ModuleSpec()

	if duration == 0 {
		duration = spec.ActivationDuration
	}

	if duration == 0 {
		duration = specs.DefaultActivationDuration
	}

	s.Rate = 1 / duration

	if plan.Points != nil {
		if plan.Points.Edges == nil {
			plan.Points.Edges = make([]bool, len(plan.Points.Points))

			for i := range plan.Points.Edges {
				plan.Points.Edges[i] = true
			}
		}

		if len(plan.Points.Points) > 0 {
			middle, reach := simulation.ShapeOutlineExtent(plan.Points.Points)
			s.Middle = &middle

			if s.Radius == nil {
				s.Radius = func(*simulation.Segment) float64 { return reach }
			}
		}
	}

	s.Shades = object.Shades

	if module != nil && module.Base().Shades != nil {
		s.Shades = module.Base().Shades
	} else if module == nil && plan.Shades != nil {
		s.Shades = plan.Shades
	}

	s.LocalPosition = plan.LocalPosition

	if mount != nil {
		s.LocalPosition = mount.LocalPosition
	}

	side := plan.ThrusterNozzleSide

	if spec.CollectsCargo && mount != nil {
		if mount.LocalPosition.Y < 0 {
			side = 1
		} else if mount.LocalPosition.Y > 0 {
			side = -1
		}
	}

	offset := spec.Offset

	if plan.ThrusterNozzleSide != 0 && mount != nil && module != nil {
		for _, point := range mount.MountPoints {
			if slices.Contains(point.Fits, module.ModuleBase().Type) {
				offset += point.ThrusterOffset
				break
			}
		}
	}

	s.LocalPosition = Vec.Add(s.LocalPosition, Vec.Create(0, side*offset))
	s.ZIndex = zIndex

	if module != nil {
		s.ZIndex = spec.ZIndex
	}

	if plan.ZIndex != nil {
		s.ZIndex = *plan.ZIndex
	}

	return s
}
