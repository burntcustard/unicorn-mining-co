// Port of src/shared/craft/station.ts.
package craft

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
)

type Station struct {
	*Craft
	LocalMovementRadius float64
}

func NewStation(props Properties, plans []*simulation.SegmentPlan, catalog specification.Catalog) *Station {
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
