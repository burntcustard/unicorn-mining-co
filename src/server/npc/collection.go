package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type collectionApproach struct {
	itemID        int64
	checkedAt     uint64
	distance      float64
	reposition    Vec.Vector
	repositioning bool
}

/*
Back away and approach from another angle when cargo stops entering the scoop.
Items still have to turn and pass through the ship's physical gap themselves.
*/
func (c *collectionApproach) movement(ship *objects.Ship, destination Movement) Movement {
	if !destination.Collect {
		*c = collectionApproach{}
		return destination
	}

	distance := Vec.Distance(ship.Position, destination.Position)

	if c.itemID != destination.IgnoreID {
		*c = collectionApproach{itemID: destination.IgnoreID, checkedAt: ship.World.Tick, distance: distance}
	}

	if c.repositioning && Vec.Distance(ship.Position, c.reposition) <= 20 {
		c.repositioning = false
		c.checkedAt, c.distance = ship.World.Tick, distance
	}

	if !c.repositioning {
		if distance < c.distance-2 || distance > 2*navigationRadius(ship) {
			c.checkedAt, c.distance = ship.World.Tick, distance
		}

		if float64(ship.World.Tick-c.checkedAt)*ship.Catalog.Simulation.SimulationStep >= 2 {
			c.reposition = simulation.RotatePoint(Vec.Create(-100, 80), ship.Rotation)

			if item, ok := ship.World.Entities.Get(destination.IgnoreID); ok {
				// A lengthwise approach lets broadside ore fit through the channel.
				c.reposition = simulation.RotatePoint(Vec.Create(120, 0), item.Base().Rotation)

				if Vec.Dot(c.reposition, Vec.Subtract(ship.Position, destination.Position)) < 0 {
					c.reposition = Vec.Scale(c.reposition, -1)
				}
			}

			// Keep the escape point fixed. Following a waypoint attached to a
			// wedged, moving item keeps pushing the ship and item together.
			c.reposition = Vec.Add(destination.Position, c.reposition)
			c.repositioning = true
		}
	}

	if c.repositioning {
		destination.Position = c.reposition
		destination.Collect = false
		destination.Velocity = Vec.Vector{}
		destination.FollowDistance = 1
	}

	return destination
}

/*
collectionCenter locates the working pickup throat in ship-local coordinates.
Use its current outline because animated geometry can differ from cached centers.
*/
func collectionCenter(ship *objects.Ship) (Vec.Vector, bool) {
	for _, segment := range ship.Segments {
		if !segment.Catches || segment.Module == nil || *segment.TargetHealth() < 1 {
			continue
		}

		center := segment.LocalPosition

		if outline := segment.Outline(); outline != nil && len(outline.Points) > 0 {
			middle, _ := simulation.ShapeOutlineExtent(outline.Points)
			center = Vec.Add(center, Vec.Create(middle[0], middle[1]))
		}

		return center, true
	}

	return Vec.Vector{}, false
}
