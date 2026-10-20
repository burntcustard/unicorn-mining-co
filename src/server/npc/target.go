package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

/*
NearestEnemy chooses the closest visible player the controller is hostile to.
*/
func NearestEnemy(ship *objects.Ship, hostile map[int64]bool) *objects.Ship {
	var nearest *objects.Ship
	distance := math.Inf(1)

	if ship.DockedTo != nil {
		return nil
	}

	for id := range hostile {
		player, ok := ship.World.Players.Get(id)

		if !ok {
			delete(hostile, id)
			continue
		}

		entity, ok := ship.World.Entities.Get(player.ShipID)

		if !ok {
			continue
		}

		other, ok := entity.(*objects.Ship)

		if !ok || !CanSee(ship, other) {
			continue
		}

		d := Vec.DistanceSquared(ship.Position, other.Position)

		if d < distance || d == distance && nearest != nil && other.ID < nearest.ID {
			nearest, distance = other, d
		}
	}

	return nearest
}
