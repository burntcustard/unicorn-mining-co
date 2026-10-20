package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

/*
interceptPosition leads current target movement by at most two response times.
Clip that forecast before the target's footprint would cross an obstacle.
Recompute from each observation so a turn cannot leave a stale destination.
*/
func interceptPosition(ship *objects.Ship, target Movement, obstacles []obstacle) Vec.Vector {
	lead := min(ship.Catalog.NPCMovement.ResponseTime*2, Vec.Distance(ship.Position, target.Position)/max(1, ship.MaxSpeed()))
	radius := ship.Radius

	if entity, ok := ship.World.Entities.Get(target.TargetID); ok {
		radius = entity.Base().Radius
	}

	position := target.Position
	interval := ship.Catalog.NPCMovement.DecisionInterval

	for elapsed := min(interval, lead); elapsed > 0; elapsed = min(elapsed+interval, lead) {
		next := Vec.AddScaled(target.Position, target.Velocity, elapsed)

		if !clearSegment(position, next, radius, obstacles, false) {
			break
		}

		position = next

		if elapsed == lead {
			break
		}
	}

	return position
}
