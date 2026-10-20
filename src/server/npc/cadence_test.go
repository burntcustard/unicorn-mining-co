package npc

import (
	"math"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
)

/*
Match network decisions to the first simulation tick after the configured delay.
For example, a 0.25-second delay at 30 Hz holds each input for eight ticks.
*/
func steeringIntervalTicks(ship *objects.Ship) int {
	return max(1, int(math.Ceil((ship.Catalog.NPCMovement.DecisionInterval-1e-9)/ship.Catalog.Simulation.SimulationStep)))
}
