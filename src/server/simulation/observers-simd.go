//go:build goexperiment.simd && amd64

package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"simd/archsimd"
)

var vectorObservers = archsimd.X86.AVX2() && utilities.SIMDFeature("observers")

func (s *movementSchedule) withinObservers(p Vec.Vector, radiusSquared float64) bool {
	if !vectorObservers || len(s.positions) < 8 {
		return s.withinObserversScalar(p, radiusSquared)
	}

	return s.withinObserversVector(p, radiusSquared)
}

//go:noinline
func (s *movementSchedule) withinObserversVector(p Vec.Vector, radiusSquared float64) bool {
	x, y, r := archsimd.BroadcastFloat64x4(p.X), archsimd.BroadcastFloat64x4(p.Y), archsimd.BroadcastFloat64x4(radiusSquared)
	n := len(s.observerX)
	i := 0

	for ; i+4 <= n; i += 4 {
		dx := x.Sub(archsimd.LoadFloat64x4Array((*[4]float64)(s.observerX[i : i+4])))
		dy := y.Sub(archsimd.LoadFloat64x4Array((*[4]float64)(s.observerY[i : i+4])))

		if dx.Mul(dx).Add(dy.Mul(dy)).LessEqual(r).ToBits() != 0 {
			archsimd.ClearAVXUpperBits()
			return true
		}
	}

	archsimd.ClearAVXUpperBits()

	for ; i < n; i++ {
		dx, dy := p.X-s.observerX[i], p.Y-s.observerY[i]

		if dx*dx+dy*dy <= radiusSquared {
			return true
		}
	}

	return false
}
