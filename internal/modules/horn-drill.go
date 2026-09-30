// Port of src/shared/modules/horn-drill.ts.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
)

type HornDrill struct{ *Module }

func NewHornDrill(props simulation.ObjectProperties, catalog specification.Catalog) *HornDrill {
	m := &HornDrill{NewModule("hornDrill", props, catalog)}
	m.Self = m
	m.ModuleData.Bounciness = func(s *simulation.Segment) *float64 {
		if s.ActivationProgress > m.Definition.ActivationThreshold {
			v := -0.4
			return &v
		}
		return nil
	}
	m.Model = []*simulation.SegmentPlan{{Points: points(m.Definition.Points)}}
	return m
}

// Damage and color are the craft/collision operations supplied by the caller,
// breaking their circular TypeScript imports without changing rule ownership.
func (m *HornDrill) Drill(ship simulation.Entity, segment *simulation.Segment, target *collision.Collider, position Vec.Vector, events *[]protocol.SimulationEvent, world *simulation.World, dt float64, damage func(any, float64), color func(*collision.Collider) string) {
	owner := target.Owner.(simulation.Entity)
	var part any = owner
	health := &owner.Base().Health
	if s, ok := target.AsteroidSegment.(*simulation.AsteroidSegment); ok && s != nil {
		part = s
		health = &s.Health
	}
	if s, ok := target.Segment.(*simulation.Segment); ok && s != nil {
		part = s
		health = s.TargetHealth()
	}
	before := *health
	object := ship.Base()
	d := m.Definition
	if segment.ActivationProgress <= d.ActivationThreshold || object.PlayerID == nil || !world.Entities.Has(owner.Base().ID) || !(before > 0) {
		return
	}
	steps := dt * d.DamageStepsPerSecond
	amount := d.Damage * steps
	damage(part, amount)
	if !(*health < before) {
		return
	}
	segment.Biting = true
	asteroid, _ := owner.(*simulation.Asteroid)
	if asteroid != nil {
		pull := Vec.Normalize(Vec.Subtract(asteroid.Position, object.Position))
		factor := 1 - math.Pow(d.GripDecay, steps)
		grip := Vec.Add(Vec.Scale(Vec.Subtract(asteroid.Velocity, object.Velocity), factor), Vec.Scale(pull, factor/d.GripScale))
		object.Velocity = Vec.Add(object.Velocity, grip)
	}
	event := protocol.DrillDamage{TargetID: owner.Base().ID, By: *object.PlayerID, Damage: amount, Color: color(target), Position: position}
	if asteroid != nil && asteroid.HasResource {
		resource := asteroid.Resource
		event.Resource = &resource
	}
	*events = append(*events, event)
	if asteroid != nil {
		part, _ := target.AsteroidSegment.(*simulation.AsteroidSegment)
		if asteroid.Fracture(part, *object.PlayerID, events, world) {
			object.Velocity = asteroid.Velocity
		}
	}
}
