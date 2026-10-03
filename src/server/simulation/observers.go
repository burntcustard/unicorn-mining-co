package simulation

import Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"

func (s *movementSchedule) withinObserversScalar(p Vec.Vector, radiusSquared float64) bool {
	for _, q := range s.positions {
		if Vec.DistanceSquared(p, q) <= radiusSquared {
			return true
		}
	}

	return false
}
