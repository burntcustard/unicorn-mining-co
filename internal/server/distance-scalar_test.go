package server

func packedDistancesScalar(x, y, radius, distances []float64, masks []uint8, px, py float64) {
	clear(masks)
	for i := range x {
		dx, dy := x[i]-px, y[i]-py
		distance := dx*dx + dy*dy
		distances[i] = distance
		if distance <= radius[i] {
			masks[i/4] |= 1 << (i % 4)
		}
	}
}
