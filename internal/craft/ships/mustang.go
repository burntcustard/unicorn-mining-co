// Port of src/shared/craft/ships/mustang.ts.
package ships

import (
	"github.com/burntcustard/unicorn-mining-co/internal/craft"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type Mustang struct{ *craft.Ship }

func NewMustang(props craft.Properties, catalog specification.Catalog) *Mustang {
	d := catalog.ShipSpecifications["mustang"]
	if props.Drag == nil {
		props.Drag = &d.Drag
	}
	if props.Mass == nil {
		props.Mass = &d.Mass
	}
	if props.Radius == nil {
		props.Radius = &d.Radius
	}
	plans := make([]*simulation.SegmentPlan, len(d.HullSegments))
	for i, segment := range d.HullSegments {
		health := segment.Health
		p := make([]simulation.Point, len(segment.Points))
		for j, point := range segment.Points {
			p[j] = simulation.Point(point)
		}
		plan := &simulation.SegmentPlan{Health: &health, Points: &simulation.ShapeOutline{Points: p}, Core: segment.Core}
		for _, mount := range segment.Mounts {
			plan.Mounts = append(plan.Mounts, simulation.NewMount(mount.LocalPosition, mount.Fits))
		}
		plans[i] = plan
	}
	ship := &Mustang{craft.NewShip(props, plans, catalog)}
	ship.Self = ship
	ship.CargoSpace = d.CargoSpace
	ship.TurnRate = d.TurnRate
	return ship
}
