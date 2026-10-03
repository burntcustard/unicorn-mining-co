// Port of src/client/objects/modules/shield-generator.ts.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

type ShieldGenerator struct{ *Module }

func NewShieldGenerator(props simulation.ObjectProperties, catalog definitions.Catalog) *ShieldGenerator {
	m := &ShieldGenerator{NewModule("shieldGenerator", props, catalog)}
	m.Self = m
	definition := m.Definition

	m.Model = []*simulation.SegmentPlan{
		{Radius: func(*simulation.Segment) float64 { return definition.GeneratorRadius }},
		{ActivationDuration: definition.CoverDuration, Covers: true, Radius: func(s *simulation.Segment) float64 { return definition.ShieldRadius * s.ActivationProgress }},
	}

	return m
}
