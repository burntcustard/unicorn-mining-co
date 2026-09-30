// Port of src/shared/items/gold.ts.
package items

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type Gold struct{ *Item }

func NewGold(props simulation.ObjectProperties, spec specification.Catalog) *Gold {
	item := &Gold{NewItem(props, spec)}
	item.Self = item
	item.define(spec.ItemSpecifications["gold"], spec)
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
