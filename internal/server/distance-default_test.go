//go:build !goexperiment.simd || !amd64

package server

func packedDistances(x, y, radius, distances []float64, masks []uint8, px, py float64) {
	packedDistancesScalar(x, y, radius, distances, masks, px, py)
}
