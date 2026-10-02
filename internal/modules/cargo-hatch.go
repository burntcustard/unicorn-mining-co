// Contact helpers from src/shared/modules/cargo-hatch.ts.
package modules

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	"math"
)

func CargoContactAllowed(self, other *collision.Collider) bool {
	return self.PickupPoint && other.Role == "cargoHatch" || self.Role == "cargoHatch" && other.PickupPoint
}
func CargoPickupPoint(item simulation.Entity) *collision.Collider {
	point := &collision.Collider{}
	SetCargoPickupPoint(point, item)
	return point
}
func SetCargoPickupPoint(point *collision.Collider, item simulation.Entity) {
	object := item.Base()
	physics := point.Physics
	if physics == nil {
		physics = new(false)
	}
	*physics = false
	*point = collision.Collider{Owner: item, Position: object.Position, Radius: 0, Rotation: object.Rotation, Physics: physics, Friction: object.Friction, PickupPoint: true, ContactFilter: CargoContactAllowed}
}
func CargoHatchDoorShapeOutline(spec specification.Module, progress, side float64) *simulation.ShapeOutline {
	geometry := spec.CargoGeometry
	angle := progress * geometry.OpenAngle
	sine, cosine := math.Sincos(angle)
	fromY := side * geometry.Length
	toX := geometry.Length * sine
	toY := side * geometry.Length * (1 - cosine)
	outX := -side * cosine * geometry.DoorWidth
	outY := -sine * geometry.DoorWidth
	return &simulation.ShapeOutline{Points: []simulation.Point{{outX, fromY + outY}, {toX + outX, toY + outY}, {toX - outX, toY - outY}, {-outX, fromY - outY}}}
}

type CargoHatch struct{ *Module }

func NewCargoHatch(props simulation.ObjectProperties, catalog specification.Catalog) *CargoHatch {
	m := &CargoHatch{NewModule("cargoHatch", props, catalog)}
	m.Self = m
	d := m.Definition
	fill := 2.0
	m.Model = []*simulation.SegmentPlan{
		{DynamicPoints: func(s *simulation.Segment) *simulation.ShapeOutline {
			side := 0.0
			if s.Mount.LocalPosition.Y < 0 {
				side = -1
			} else if s.Mount.LocalPosition.Y > 0 {
				side = 1
			}
			return s.CachedOutline([2]float64{s.ActivationProgress, side}, func() *simulation.ShapeOutline { return CargoHatchDoorShapeOutline(d, s.ActivationProgress, side) })
		}, Radius: func(*simulation.Segment) float64 { return d.CargoGeometry.DoorRadius }, FillShade: &fill, Wreckage: &simulation.SegmentPlan{FillShade: &fill}, Stroke: [][][]float64{}},
		{Catches: true, NoWreckage: true, Radius: func(*simulation.Segment) float64 { return d.CargoGeometry.ThroatRadius }},
	}
	return m
}

// Ship exposes the actual craft state, without a modules -> craft import cycle.
type CargoShip interface {
	simulation.Entity
	ModuleActive(string) bool
	Cargo() *[]simulation.Entity
	CargoCapacity() int
}

func (m *CargoHatch) Collect(ship CargoShip, contact collision.Contact, events *[]protocol.SimulationEvent, world *simulation.World) {
	var throat *collision.Collider
	for _, candidate := range []*collision.Collider{contact.Collider, contact.Other} {
		if segment, ok := candidate.Segment.(*simulation.Segment); ok && segment.Module == m && candidate.Role == "cargoHatch" {
			throat = candidate
			break
		}
	}
	if throat == nil {
		return
	}
	pickup := contact.Collider
	if throat == pickup {
		pickup = contact.Other
	}
	entity := pickup.Owner.(simulation.Entity)
	item := entity.Base()
	object := ship.Base()
	contents := ship.Cargo()
	if !item.Item || !CargoContactAllowed(throat, pickup) || object.PlayerID == nil || !ship.ModuleActive("cargoHatch") || !world.Entities.Has(item.ID) || item.Message == nil && len(*contents) >= ship.CargoCapacity() {
		return
	}
	if item.Message == nil {
		*contents = append(*contents, entity)
	}
	item.Remove()
	event := protocol.ItemCollected{By: *object.PlayerID, ItemID: item.ID, Resource: item.Resource, Message: item.Message}
	if item.Message != nil {
		unlock := item.Unlock
		event.Unlock = &unlock
	}
	*events = append(*events, event)
}
