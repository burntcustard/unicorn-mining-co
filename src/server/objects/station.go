// Port of src/client/objects/station.ts.
package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type Station struct {
	*Craft
	LocalMovementRadius float64
}

func newStation(props Properties, plans []*simulation.SegmentPlan, catalog definitions.Catalog) *Station {
	s := &Station{Craft: NewCraft(props, plans, catalog)}
	s.Self = s
	s.Kind = "station"
	return s
}
func (s *Station) Holds(child simulation.Entity) bool {
	return Vec.DistanceSquared(child.Base().Position, s.Position) <= s.LocalMovementRadius*s.LocalMovementRadius
}
func (s *Station) MovementRadius() float64 { return s.LocalMovementRadius }
func (s *Station) HandleContacts(contacts []collision.Contact, events *[]protocol.SimulationEvent, _ *simulation.World, _ float64) {
	for _, contact := range contacts {
		var bay *collision.Collider
		if contact.Collider.Owner == s.Self {
			bay = contact.Collider
		} else if contact.Other.Owner == s.Self {
			bay = contact.Other
		}
		if bay == nil || !bay.DockSegment {
			continue
		}
		other := contact.Collider
		if other == bay {
			other = contact.Other
		}
		owner, ok := other.Owner.(interface{ ShipBase() *Ship })
		if !ok {
			continue
		}
		ship := owner.ShipBase()
		if ship.Cockpit == nil || ship.DockedTo != nil && *ship.DockedTo != 0 || ship.Launching != 0 {
			continue
		}
		id := s.ID
		ship.DockedTo = &id
		ship.Position = s.Position
		ship.Rotation = s.Rotation
		ship.Velocity = Vec.Vector{}
		ship.Spin = 0
		if ship.PlayerID != nil {
			*events = append(*events, protocol.Docked{PlayerID: *ship.PlayerID, StationID: s.ID})
		}
	}
}

func NewStation(id string, props Properties, catalog definitions.Catalog) *Station {
	d, ok := catalog.StationDefinitions[id]
	if !ok {
		panic("Unknown station definition: " + id)
	}
	plans := make([]*simulation.SegmentPlan, len(d.HullSegments))
	for i, segment := range d.HullSegments {
		outline := &simulation.ShapeOutline{Points: make([]simulation.Point, len(segment.Points))}
		for j, point := range segment.Points {
			outline.Points[j] = simulation.Point(point)
		}
		plans[i] = &simulation.SegmentPlan{Health: segment.Health, Points: outline, DisablePhysics: segment.DisablePhysics, DockSegment: segment.DockSegment, Shades: segment.Shades, ZIndex: segment.ZIndex}
	}
	if props.Mass == nil {
		props.Mass = &d.Mass
	}
	// The inherited zIndex is available while makeSegment builds the hull.
	for _, plan := range plans {
		if plan.ZIndex == 0 {
			plan.ZIndex = d.ZIndex
		}
	}
	station := newStation(props, plans, catalog)
	station.Self = station
	if id != "corral" {
		station.DefinitionID = id
	}
	station.ZIndex = d.ZIndex
	station.LocalMovementRadius = d.LocalMovementRadius
	return station
}

func CreateStation(props Properties, catalog definitions.Catalog) *Station {
	if props.DefinitionID == "" {
		props.DefinitionID = "corral"
	}
	return NewStation(props.DefinitionID, props, catalog)
}
