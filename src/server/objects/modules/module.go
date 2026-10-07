// Port of src/client/objects/modules/module.ts.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

type Module struct {
	*simulation.GameObject
	simulation.ModuleData
	Name string
}

func (m *Module) ModuleBase() *simulation.ModuleData { return &m.ModuleData }

func NewModule(id string, props simulation.ObjectProperties, catalog specs.Catalog) *Module {
	spec := catalog.ModuleSpecs[id]

	m := &Module{
		GameObject: simulation.NewGameObject(props, catalog.Simulation),
		Type:       id,
		Spec:       spec,
	}

	m.ChargeCooldown = spec.ChargeDuration
	m.Self = m
	m.Health, m.Name, m.Price, m.Shades = spec.Health, spec.Name, spec.Price, spec.Shades
	m.GameObject.Bounciness = spec.Bounciness

	if spec.Friction != nil {
		m.Friction = *spec.Friction
	}

	m.ApplyProperties(props)

	for _, part := range spec.Model {
		plan := &simulation.SegmentPlan{
			FillShade:          part.Color,
			Covers:             part.Covers,
			Catches:            part.Catches,
			ThrusterNozzleSide: part.ThrusterNozzleSide,
		}

		if part.Outline != nil && !*part.Outline {
			plan.Stroke = [][][]float64{}
		}

		if part.Radius != 0 {
			plan.Radius = func(*simulation.Segment) float64 { return part.Radius }
		}

		if len(part.Points) > 0 {
			plan.Points = points(part.Points)
		}

		if spec.Behavior == "weapon" {
			radius := max(
				simulation.RadiusOf(plan.Points.Points, simulation.Point{}),
				simulation.RadiusOf(plan.Points.Points, simulation.Point{spec.RetractionDistance, 0}),
			)
			plan.Points = nil

			plan.Radius = func(*simulation.Segment) float64 { return radius }

			plan.DynamicPoints = func(segment *simulation.Segment) *simulation.ShapeOutline {
				side := 1.0

				if segment.Mount.LocalPosition.Y < 0 {
					side = -1
				}

				outline := points(part.Points)

				for i := range outline.Points {
					outline.Points[i][0] -= spec.RetractionDistance * (1 - segment.ActivationProgress)
					outline.Points[i][1] *= side
				}

				return outline
			}
		}

		m.Model = append(m.Model, plan)
	}

	return m
}

func points(values []specs.Point) *simulation.ShapeOutline {
	p := make([]simulation.Point, len(values))

	for i, v := range values {
		p[i] = simulation.Point(v)
	}

	return &simulation.ShapeOutline{Points: p}
}
