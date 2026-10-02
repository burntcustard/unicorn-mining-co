// Port of src/shared/items/amethyst.ts.
package items

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type Amethyst struct{ *Item }

func NewAmethyst(props simulation.ObjectProperties, spec specification.Catalog) *Amethyst {
	item := &Amethyst{NewItem(props, spec)}
	item.Self = item
	item.define(spec.ItemSpecifications["amethyst"], spec)
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
