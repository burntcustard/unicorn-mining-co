// Port of src/shared/modules/thruster-single.ts; rendering-only flare size is omitted.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type ThrusterSingle struct{ *Module }

func NewThrusterSingle(props simulation.ObjectProperties, catalog specification.Catalog) *ThrusterSingle {
	m := &ThrusterSingle{NewModule("thrusterSingle", props, catalog)}
	m.Self = m
	for i := range m.Definition.FlareSizes {
		m.Model = append(m.Model, &simulation.SegmentPlan{ThrusterNozzleSide: m.Definition.NozzleSides[i]})
	}
	return m
}
