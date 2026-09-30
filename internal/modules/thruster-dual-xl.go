// Port of src/shared/modules/thruster-dual-xl.ts; rendering-only flare size is omitted.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

type ThrusterDualXl struct{ *Module }

func NewThrusterDualXl(props simulation.ObjectProperties, catalog specification.Catalog) *ThrusterDualXl {
	m := &ThrusterDualXl{NewModule("thrusterDualXl", props, catalog)}
	m.Self = m
	for i := range m.Definition.FlareSizes {
		m.Model = append(m.Model, &simulation.SegmentPlan{ThrusterNozzleSide: m.Definition.NozzleSides[i]})
	}
	return m
}
