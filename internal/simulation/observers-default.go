//go:build !goexperiment.simd || !amd64

package simulation

import Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"

func (s *movementSchedule) withinObservers(p Vec.Vector, radiusSquared float64) bool {
	return s.withinObserversScalar(p, radiusSquared)
}
