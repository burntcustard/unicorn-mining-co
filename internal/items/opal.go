// Port of src/shared/items/opal.ts.
package items

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type Opal struct{ *Item }

func NewOpal(props simulation.ObjectProperties, spec specification.Catalog) *Opal {
	item := &Opal{NewItem(props, spec)}
	item.Self = item
	item.define(spec.ItemSpecifications["opal"], spec)
	item.Radius = spec.ItemSpecifications["opal"].Radius
	outline := item.ShapeOutline
	item.ApplyProperties(props)
	item.ShapeOutline = outline
	if props.Points != nil {
		item.ShapeOutline = &simulation.ShapeOutline{Points: *props.Points}
	}
	if item.ShapeOutline != nil {
		item.Radius = simulation.RadiusOf(item.ShapeOutline.Points, simulation.Point{})
	}
	return item
}
