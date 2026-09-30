// Port of src/shared/modules/thruster-dual-md.ts; rendering-only flare size is omitted.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type ThrusterDualMd struct{ *Module }

func NewThrusterDualMd(props simulation.ObjectProperties, catalog specification.Catalog) *ThrusterDualMd {
	m := &ThrusterDualMd{NewModule("thrusterDualMd", props, catalog)}
	m.Self = m
	for i := range m.Definition.FlareSizes {
		m.Model = append(m.Model, &simulation.SegmentPlan{ThrusterNozzleSide: m.Definition.NozzleSides[i]})
	}
	return m
}
