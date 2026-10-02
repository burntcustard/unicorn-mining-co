// Port of src/shared/craft/create-wreckage.ts.
package craft

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

func CreateWreckage(props Properties, segments []WreckageSegment, catalog specification.Catalog) *Craft {
	plans := make([]*simulation.SegmentPlan, len(segments))
	for i, s := range segments {
		health := s.Health
		radius := s.Radius
		plan := &simulation.SegmentPlan{Radius: func(*simulation.Segment) float64 { return radius }, LocalPosition: s.Offset, Health: &health, FillShade: s.FillShade, Stroke: s.Stroke}
		if s.ShapeOutline != nil {
			plan.Points = &simulation.ShapeOutline{Points: s.ShapeOutline}
		}
		plans[i] = plan
	}
	return NewCraft(props, plans, catalog)
}
