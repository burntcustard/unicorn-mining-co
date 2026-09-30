// Port of src/shared/items/item.ts. Drawing properties are omitted.
package items

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	"github.com/burntcustard/unicorn-mining-co/internal/modules"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type Item struct{ *simulation.GameObject }

func NewItem(props simulation.ObjectProperties, spec specification.Catalog) *Item {
	item := &Item{simulation.NewGameObject(props, spec.Simulation)}
	item.Self = item
	item.Kind, item.Item = "item", true
	item.Mass = spec.ItemDefaults["mass"]
	item.AngularDrag = spec.ItemDefaults["angularDrag"]
	item.Radius = spec.ItemDefaults["radius"]
	item.ApplyProperties(props)
	item.ShapeOutline = nil
	if props.Points != nil {
		item.ShapeOutline = &simulation.ShapeOutline{Points: *props.Points}
		item.Radius = simulation.RadiusOf(*props.Points, simulation.Point{})
	}
	return item
}
func (item *Item) Hitbox() []*collision.Collider {
	body := item.GameObject.Hitbox()
	if len(body) > 0 {
		body = append(body, modules.CargoPickupPoint(item.Self))
	}
	return body
}
func (item *Item) define(definition specification.Item, spec specification.Catalog) {
	item.Resource, item.Label = definition.Resource, definition.Label
	item.HasResource = true
	if definition.Price != nil {
		item.Price = *definition.Price
	}
	item.Shades, item.Unlock = definition.Shades, definition.Unlock
	item.Health = spec.ItemDefaults["health"]
	bounciness := spec.ItemDefaults["bounciness"]
	item.Bounciness = &bounciness
	if definition.Points != nil {
		outline := &simulation.ShapeOutline{Points: make([]simulation.Point, len(definition.Points))}
		for i, point := range definition.Points {
			outline.Points[i] = simulation.Point(point)
		}
		item.ShapeOutline = outline
		item.Radius = simulation.RadiusOf(outline.Points, simulation.Point{})
	}
}
