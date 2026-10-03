// Port of src/client/objects/item.ts. Drawing properties are omitted.
package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

type Item struct{ *simulation.GameObject }

func NewItem(id string, props simulation.ObjectProperties, spec definitions.Catalog) *Item {
	item := &Item{simulation.NewGameObject(props, spec.Simulation)}
	item.Self = item
	item.Kind, item.Item = "item", true
	item.Mass = spec.ItemDefaults["mass"]
	item.AngularDrag = spec.ItemDefaults["angularDrag"]
	item.Radius = spec.ItemDefaults["radius"]
	if id != "" {
		definition, ok := spec.ItemDefinitions[id]
		if !ok {
			panic("Unknown item definition: " + id)
		}
		item.define(definition, spec)
	}
	outline := item.ShapeOutline
	item.ApplyProperties(props)
	item.ShapeOutline = outline
	if props.Points != nil {
		item.ShapeOutline = &simulation.ShapeOutline{Points: *props.Points}
		item.Radius = simulation.RadiusOf(*props.Points, simulation.Point{})
	}
	if item.ShapeOutline != nil {
		item.Radius = simulation.RadiusOf(item.ShapeOutline.Points, simulation.Point{})
	}
	return item
}
func (item *Item) Hitbox() []*collision.Collider {
	body := item.GameObject.Hitbox()
	if len(body) > 0 {
		body = body[:2]
		if body[1] == nil {
			body[1] = modules.CargoPickupPoint(item.Self)
		} else {
			modules.SetCargoPickupPoint(body[1], item.Self)
		}
	}
	return body
}
func (item *Item) define(definition definitions.Item, spec definitions.Catalog) {
	item.Resource, item.Label = definition.Resource, definition.Label
	if definition.Radius != 0 {
		item.Radius = definition.Radius
	}
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

func ItemTypes(spec definitions.Catalog) []func(simulation.ObjectProperties) simulation.Entity {
	types := make([]func(simulation.ObjectProperties) simulation.Entity, len(spec.ItemIDs))
	for i, id := range spec.ItemIDs {
		types[i] = func(props simulation.ObjectProperties) simulation.Entity { return NewItem(id, props, spec) }
	}
	return types
}
