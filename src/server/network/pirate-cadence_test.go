package network

import "math"

/*
Advance direct encounter checks to the same decision boundary as the session.
*/
func pirateDecisionTicks(s *GameSession) uint64 {
	return uint64(max(1, int(math.Ceil((s.World.Specification.NPCMovement.DecisionInterval-1e-9)/s.World.Specification.Simulation.SimulationStep))))
}
