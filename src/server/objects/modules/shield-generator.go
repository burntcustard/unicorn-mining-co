// Port of src/client/objects/modules/shield-generator.ts.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

type ShieldGenerator struct{ *Module }

func NewShieldGenerator(props simulation.ObjectProperties, catalog specs.Catalog) *ShieldGenerator {
	return newShieldGenerator("shieldGeneratorSm", props, catalog)
}

func newShieldGenerator(id string, props simulation.ObjectProperties, catalog specs.Catalog) *ShieldGenerator {
	m := &ShieldGenerator{NewModule(id, props, catalog)}
	m.Self = m
	spec := m.Spec

	m.Model = []*simulation.SegmentPlan{
		{Radius: func(*simulation.Segment) float64 { return spec.GeneratorRadius }},
		{ActivationDuration: spec.CoverDuration, Covers: true, Radius: func(s *simulation.Segment) float64 { return spec.ShieldRadius * s.ActivationProgress }},
	}

	return m
}
