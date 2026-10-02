// Port of src/shared/modules/module.ts.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type Module struct {
	*simulation.GameObject
	simulation.ModuleData
}

func (m *Module) ModuleBase() *simulation.ModuleData { return &m.ModuleData }
func NewModule(id string, props simulation.ObjectProperties, catalog specification.Catalog) *Module {
	definition := catalog.ModuleSpecifications[id]
	m := &Module{GameObject: simulation.NewGameObject(props, catalog.Simulation), Type: id, Definition: definition}
	m.Self = m
	m.Health, m.Label, m.Price, m.Shades = definition.Health, definition.Label, definition.Price, definition.Shades
	m.GameObject.Bounciness = definition.Bounciness
	if definition.Friction != nil {
		m.Friction = *definition.Friction
	}
	m.ApplyProperties(props)
	return m
}
func points(values []specification.Point) *simulation.ShapeOutline {
	p := make([]simulation.Point, len(values))
	for i, v := range values {
		p[i] = simulation.Point(v)
	}
	return &simulation.ShapeOutline{Points: p}
}
