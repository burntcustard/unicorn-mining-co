// Port of src/shared/modules/thruster-triple.ts; rendering-only flare size is omitted.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type ThrusterTriple struct{ *Module }

func NewThrusterTriple(props simulation.ObjectProperties, catalog specification.Catalog) *ThrusterTriple {
	m := &ThrusterTriple{NewModule("thrusterTriple", props, catalog)}
	m.Self = m
	for i := range m.Definition.FlareSizes {
		m.Model = append(m.Model, &simulation.SegmentPlan{ThrusterNozzleSide: m.Definition.NozzleSides[i]})
	}
	return m
}
