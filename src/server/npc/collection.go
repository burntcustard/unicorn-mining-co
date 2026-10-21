package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type collectionApproach struct {
	itemID     int64
	checkedAt  uint64
	distance   float64
	reposition Vec.Vector
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

	if c.reposition != (Vec.Vector{}) && Vec.Distance(ship.Position, Vec.Add(destination.Position, c.reposition)) <= 20 {
		c.reposition = Vec.Vector{}
		c.checkedAt, c.distance = ship.World.Tick, distance
	}

	if c.reposition == (Vec.Vector{}) {
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
		}
	}

	if c.reposition != (Vec.Vector{}) {
		destination.Position = Vec.Add(destination.Position, c.reposition)
		destination.Collect = false
		destination.FollowDistance = 1
	}

	return destination
}
