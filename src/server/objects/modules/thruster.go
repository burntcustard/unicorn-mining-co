// Port of src/client/objects/modules/thruster.ts; rendering-only flare size is omitted.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

type Thruster struct{ *Module }

func NewThruster(id string, props simulation.ObjectProperties, catalog definitions.Catalog) *Thruster {
	m := &Thruster{NewModule(id, props, catalog)}
	m.Self = m

	for i := range m.Definition.FlareSizes {
		m.Model = append(m.Model, &simulation.SegmentPlan{ThrusterNozzleSide: m.Definition.NozzleSides[i]})
	}

	return m
}
