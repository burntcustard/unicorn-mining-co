// Port of src/client/objects/station.ts.
package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"slices"
)

type Station struct {
	*Craft
	LocalMovementRadius float64
	DockingBays         []float64
	moduleSellers       map[int64]int64
}

func (s *Station) Holds(child simulation.Entity) bool {
	return Vec.DistanceSquared(child.Base().Position, s.Position) <= s.LocalMovementRadius*s.LocalMovementRadius
}

func (s *Station) MovementRadius() float64 { return s.LocalMovementRadius }

func NewStation(id string, props Properties, catalog specs.Catalog) *Station {
	d, ok := catalog.StationSpecs[id]

	if !ok {
		panic("Unknown station spec: " + id)
	}

	plans := make([]*simulation.SegmentPlan, len(d.HullSegments))

	for i, segment := range d.HullSegments {
		outline := &simulation.ShapeOutline{Points: make([]simulation.Point, len(segment.Points))}

		for j, point := range segment.Points {
			outline.Points[j] = simulation.Point(point)
		}

		plans[i] = &simulation.SegmentPlan{Health: segment.Health, Points: outline, DisablePhysics: segment.DisablePhysics, DockSegment: segment.DockSegment, Shades: segment.Shades, ZIndex: segment.ZIndex}

		for _, mount := range segment.Mounts {
			plans[i].Mounts = append(plans[i].Mounts, simulation.NewMount(mount))
		}
	}

	if props.Mass == nil {
		props.Mass = &d.Mass
	}

	// The inherited zIndex is available while makeSegment builds the hull.
	for _, plan := range plans {
		if plan.ZIndex == nil {
			plan.ZIndex = &d.ZIndex
		}
	}

	station := &Station{Craft: NewCraft(props, plans, catalog)}
	station.Self = station
	station.Kind = "station"
	station.Name = d.Name
	station.ApplyProperties(props.ObjectProperties)

	if id != "corral-5" {
		station.DefinitionID = id
	}

	station.DockingBays = d.DockingBays
	station.ZIndex = d.ZIndex
	station.LocalMovementRadius = d.LocalMovementRadius

	if props.CargoContents == nil && station.World != nil {
		station.World.NextEntityID = max(station.World.NextEntityID, station.ID+1)

		for _, entry := range d.InitialCargoContents {
			for range entry.Count {
				id := simulation.EntityID(station.World)
				station.CargoContents = append(station.CargoContents, NewItem(entry.Item, simulation.ObjectProperties{World: station.World, ID: &id}, catalog))
			}
		}
	}

	return station
}

func CreateStation(props Properties, catalog specs.Catalog) *Station {
	if props.DefinitionID == "" {
		props.DefinitionID = "corral-5"
	}

	return NewStation(props.DefinitionID, props, catalog)
}

// Sold modules are available only until their seller ends the docking visit.
func (s *Station) EndTradeVisit(shipID int64) {
	s.CargoContents = slices.DeleteFunc(s.CargoContents, func(e simulation.Entity) bool {
		if s.moduleSellers[e.Base().ID] != shipID {
			return false
		}

		delete(s.moduleSellers, e.Base().ID)
		return true
	})
}

func (c *Craft) TradeStation() *Station {
	if c.DockedTo != nil && c.World != nil {
		if entity, ok := c.World.Entities.Get(*c.DockedTo); ok {
			station, _ := entity.(*Station)
			return station
		}
	}

	return nil
}

func (c *Craft) EndTradeVisit() {
	if station := c.TradeStation(); station != nil {
		station.EndTradeVisit(c.ID)
	}
}
