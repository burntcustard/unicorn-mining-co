// Port of src/shared/utilities/round.ts.
package utilities

import "math"

// Round matches Math.round(value * 1e8) / 1e8: ties go toward +infinity.
func Round(value float64) float64 {
	return RoundInteger(value*1e8) / 1e8
}

// RoundInteger implements JavaScript Math.round, including negative zero.
func RoundInteger(scaled float64) float64 {
	lower := math.Floor(scaled)
	rounded := lower
	if scaled-lower >= 0.5 {
		rounded++
	}
	if rounded == 0 && math.Signbit(scaled) {
		return math.Copysign(0, -1)
	}
	return rounded
}
