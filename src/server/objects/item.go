// Port of src/client/objects/item.ts. Drawing properties are omitted.
package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

type Item struct {
	*simulation.GameObject
	Name   string
	Rounds *int
}

func NewItem(id string, props simulation.ObjectProperties, catalog specs.Catalog) *Item {
	item := &Item{GameObject: simulation.NewGameObject(props, catalog.Simulation)}
	item.Self = item
	item.Kind, item.Item = "item", true
	item.Mass = catalog.ItemDefaults["mass"]
	item.AngularDrag = catalog.ItemDefaults["angularDrag"]
	item.Radius = catalog.ItemDefaults["radius"]

	if id != "" {
		spec, ok := catalog.ItemSpecs[id]

		if !ok {
			panic("Unknown item spec: " + id)
		}

		item.define(spec, catalog)
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

func (item *Item) define(spec specs.Item, catalog specs.Catalog) {
	item.Resource, item.Name = spec.Resource, spec.Name

	if spec.Rounds > 0 {
		item.Rounds = new(spec.Rounds)
	}

	if spec.Radius != 0 {
		item.Radius = spec.Radius
	}

	item.HasResource = true

	if spec.Price != nil {
		item.Price = *spec.Price
	}

	item.Shades, item.Unlock = spec.Shades, spec.Unlock
	item.Health = catalog.ItemDefaults["health"]
	bounciness := catalog.ItemDefaults["bounciness"]
	item.Bounciness = &bounciness

	if spec.Points != nil {
		outline := &simulation.ShapeOutline{Points: make([]simulation.Point, len(spec.Points))}

		for i, point := range spec.Points {
			outline.Points[i] = simulation.Point(point)
		}

		item.ShapeOutline = outline
		item.Radius = simulation.RadiusOf(outline.Points, simulation.Point{})
	}
}

func ItemTypes(catalog specs.Catalog) []func(simulation.ObjectProperties) simulation.Entity {
	types := make([]func(simulation.ObjectProperties) simulation.Entity, len(catalog.ItemIDs))

	for i, id := range catalog.ItemIDs {
		types[i] = func(props simulation.ObjectProperties) simulation.Entity { return NewItem(id, props, catalog) }
	}

	return types
}
