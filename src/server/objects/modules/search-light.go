// Port of src/client/objects/modules/search-light.ts. Wreckage remains mechanical state.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

type SearchLight struct{ *Module }

func NewSearchLight(props simulation.ObjectProperties, catalog specs.Catalog) *SearchLight {
	m := &SearchLight{NewModule("searchLight", props, catalog)}
	m.Self = m
	d := m.Spec
	reach, spread, corner := d.Reach, d.Spread, d.Corner

	housing := m.Model

	m.Model = []*simulation.SegmentPlan{
		{
			NoWreckage: true,
			DynamicPoints: func(s *simulation.Segment) *simulation.ShapeOutline {
				active := 0.0

				if s.ActivationProgress != 0 {
					active = 1
				}

				return s.CachedOutline([2]float64{active}, func() *simulation.ShapeOutline {
					p := []simulation.Point{}

					if s.ActivationProgress != 0 {
						p = []simulation.Point{
							{0, 0},
							{reach - corner, -spread},
							{reach, corner - spread},
							{reach, spread - corner},
							{reach - corner, spread},
						}
					}

					return &simulation.ShapeOutline{Points: p}
				})
			},
		},
	}

	for _, plan := range housing {
		plan.Wreckage = &simulation.SegmentPlan{FillShade: plan.FillShade}
		m.Model = append(m.Model, plan)
	}

	return m
}
