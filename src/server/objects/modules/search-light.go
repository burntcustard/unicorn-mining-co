// Port of src/client/objects/modules/search-light.ts. Wreckage remains mechanical state.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

type SearchLight struct{ *Module }

func NewSearchLight(props simulation.ObjectProperties, catalog definitions.Catalog) *SearchLight {
	m := &SearchLight{NewModule("searchLight", props, catalog)}
	m.Self = m
	d := m.Definition
	lens, far, mouth, spread, corner := d.Lens, d.Lens+d.Reach, d.Mouth, d.Spread, d.Corner
	fill := 2.0

	m.Model = []*simulation.SegmentPlan{{Wreckage: &simulation.SegmentPlan{Points: &simulation.ShapeOutline{Points: []simulation.Point{{lens, -1.5}, {lens + 8, -1.5}, {lens + 8, 1.5}, {lens, 1.5}}}, FillShade: &fill}, DynamicPoints: func(s *simulation.Segment) *simulation.ShapeOutline {
		active := 0.0

		if s.ActivationProgress != 0 {
			active = 1
		}

		return s.CachedOutline([2]float64{active}, func() *simulation.ShapeOutline {
			p := []simulation.Point{}

			if s.ActivationProgress != 0 {
				p = []simulation.Point{{lens, -mouth}, {far - corner, -spread}, {far, corner - spread}, {far, spread - corner}, {far - corner, spread}, {lens, mouth}}
			}

			return &simulation.ShapeOutline{Points: p}
		})
	}}}

	return m
}
