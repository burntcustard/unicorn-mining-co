//go:build goexperiment.simd && amd64

package server

import "simd/archsimd"

func packedDistances(x, y, radius, distances []float64, masks []uint8, px, py float64) {
	if !archsimd.X86.AVX2() {
		packedDistancesScalar(x, y, radius, distances, masks, px, py)
		return
	}
	vx, vy := archsimd.BroadcastFloat64x4(px), archsimd.BroadcastFloat64x4(py)
	i := 0
	for ; i+4 <= len(x); i += 4 {
		dx := archsimd.LoadFloat64x4(x[i:]).Sub(vx)
		dy := archsimd.LoadFloat64x4(y[i:]).Sub(vy)
		// Separate multiply and add preserve scalar rounding at threshold boundaries.
		distance := dx.Mul(dx).Add(dy.Mul(dy))
		distance.Store(distances[i:])
		masks[i/4] = distance.LessEqual(archsimd.LoadFloat64x4(radius[i:])).ToBits()
	}
	if i < len(x) {
		masks[i/4] = 0
		for ; i < len(x); i++ {
			dx, dy := x[i]-px, y[i]-py
			distance := dx*dx + dy*dy
			distances[i] = distance
			if distance <= radius[i] {
				masks[i/4] |= 1 << (i % 4)
			}
		}
	}
}
