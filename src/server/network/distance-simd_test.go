//go:build goexperiment.simd && amd64

package network

import (
	"simd/archsimd"
	"unsafe"
)

func packedDistances(x, y, radius, distances []float64, masks []uint8, px, py float64) {
	if !archsimd.X86.AVX2() {
		packedDistancesScalar(x, y, radius, distances, masks, px, py)
		return
	}

	n := len(x)

	if len(y) < n || len(radius) < n || len(distances) < n || len(masks) < (n+3)/4 {
		panic("short distance buffer")
	}

	end := n &^ 3

	// Finish scalar work first so no scalar floats need saving across AVX cleanup.
	if end < n {
		masks[end/4] = 0

		for i := end; i < n; i++ {
			dx, dy := x[i]-px, y[i]-py
			distance := dx*dx + dy*dy
			distances[i] = distance

			if distance <= radius[i] {
				masks[i/4] |= 1 << (i % 4)
			}
		}
	}

	vx, vy := archsimd.BroadcastFloat64x4(px), archsimd.BroadcastFloat64x4(py)

	for i := 0; i < end; i += 4 {
		load := func(values []float64) archsimd.Float64x4 {
			return archsimd.LoadFloat64x4Array((*[4]float64)(unsafe.Add(unsafe.Pointer(unsafe.SliceData(values)), i*8)))
		}

		dx, dy := load(x).Sub(vx), load(y).Sub(vy)
		// Separate multiply and add preserve scalar rounding at threshold boundaries.
		distance := dx.Mul(dx).Add(dy.Mul(dy))
		distance.StoreArray((*[4]float64)(unsafe.Add(unsafe.Pointer(unsafe.SliceData(distances)), i*8)))
		masks[i/4] = distance.LessEqual(load(radius)).ToBits()
	}

	archsimd.ClearAVXUpperBits()
}
