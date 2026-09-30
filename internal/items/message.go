// Port of src/shared/items/message.ts.
package items

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type Message struct{ *Item }

func NewMessage(props simulation.ObjectProperties, spec specification.Catalog) *Message {
	item := &Message{NewItem(props, spec)}
	item.Self = item
	item.define(spec.ItemSpecifications["message"], spec)
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
