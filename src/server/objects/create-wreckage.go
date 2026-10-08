// Port of src/client/objects/create-wreckage.ts.
package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func CreateWreckage(props Properties, segments []WreckageSegment, catalog specs.Catalog) *Craft {
	plans := make([]*simulation.SegmentPlan, len(segments))

	for i, s := range segments {
		health := s.Health
		radius := s.Radius

		plan := &simulation.SegmentPlan{Radius: func(*simulation.Segment) float64 { return radius }, LocalPosition: s.Offset, Health: &health, FillShade: s.FillShade, Color: s.Color, Stroke: s.Stroke}

		if s.ShapeOutline != nil {
			plan.Points = &simulation.ShapeOutline{Points: s.ShapeOutline}
		}

		plans[i] = plan
	}

	return NewCraft(props, plans, catalog)
}
