// Port of src/shared/craft/stations/corral.ts. Geometry comes from the generated
// TypeScript catalog, including nonphysical bay pieces retained in the hull.
package stations

import (
	"github.com/burntcustard/unicorn-mining-co/internal/craft"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type Corral struct{ *craft.Station }

func NewCorral(props craft.Properties, catalog specification.Catalog) *Corral {
	d := catalog.StationSpecifications["corral"]
	g := d.Geometry
	outline := func(points []specification.Point) *simulation.ShapeOutline {
		out := &simulation.ShapeOutline{Points: make([]simulation.Point, len(points))}
		for i, p := range points {
			out.Points[i] = simulation.Point(p)
		}
		return out
	}
	plans := []*simulation.SegmentPlan{}
	for _, side := range g.Sides {
		plans = append(plans, &simulation.SegmentPlan{DisablePhysics: side.Opening, Points: outline(side.ShapeOutline)})
	}
	plans = append(plans, &simulation.SegmentPlan{DisablePhysics: true, DockSegment: true, Points: outline(g.Core)})
	for _, panel := range g.Panels {
		plans = append(plans, &simulation.SegmentPlan{Points: outline(panel)})
	}
	bay, corner, lip, nose, seam := g.Bay.Back, g.Bay.Corner, g.Bay.Lip, g.Bay.Nose, g.Bay.Seam
	plans = append(plans, &simulation.SegmentPlan{DisablePhysics: true, Shades: d.BayGlowShades, ZIndex: d.BayFloorZIndex, Points: &simulation.ShapeOutline{Points: []simulation.Point{{seam, -lip}, {nose - corner, -lip}, {nose, corner - lip}, {nose, lip - corner}, {nose - corner, lip}, {seam, lip}}}})
	plans = append(plans, &simulation.SegmentPlan{DisablePhysics: true, Shades: d.BayGlowShades, ZIndex: d.BayCeilingZIndex, Points: &simulation.ShapeOutline{Points: []simulation.Point{{seam, lip}, {bay + corner, lip}, {bay, lip - corner}, {bay, corner - lip}, {bay + corner, -lip}, {seam, -lip}}}})
	if props.Mass == nil {
		props.Mass = &d.Mass
	}
	// The inherited zIndex is available while makeSegment builds the hull.
	for _, plan := range plans {
		if plan.ZIndex == 0 {
			plan.ZIndex = d.ZIndex
		}
	}
	station := &Corral{craft.NewStation(props, plans, catalog)}
	station.Self = station
	station.ZIndex = d.ZIndex
	station.LocalMovementRadius = d.LocalMovementRadius
	return station
}
