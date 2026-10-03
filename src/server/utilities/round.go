// Port of src/client/utilities/round.ts.
package utilities

import "math"

// Round matches Math.round(value * 1e8) / 1e8: ties go toward +infinity.
func Round(value float64) float64 {
	return RoundTiesUp(value*1e8) / 1e8
}

// RoundTiesUp rounds to the nearest whole number with ties toward +infinity.
// Procedural geometry keeps this existing rule, including negative zero.
func RoundTiesUp(scaled float64) float64 {
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

// Motion uses a binary grid and Go's native ties-to-even rule. Power-of-two
// scaling is exact, and multiplication replaces the old decimal division.
func RoundMotion(value float64) float64 {
	return math.RoundToEven(value*0x1p24) * 0x1p-24
}
