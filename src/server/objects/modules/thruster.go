// Port of src/client/objects/modules/thruster.ts; rendering-only flare size is omitted.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

type Thruster struct{ *Module }

func NewThruster(id string, props simulation.ObjectProperties, catalog specs.Catalog) *Thruster {
	m := &Thruster{NewModule(id, props, catalog)}
	m.Self = m

	for i := range m.Spec.FlareSizes {
		m.Model = append(m.Model, &simulation.SegmentPlan{ThrusterNozzleSide: m.Spec.NozzleSides[i]})
	}

	return m
}
