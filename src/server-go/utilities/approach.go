// Port of src/client/utilities/approach.ts.
package utilities

import "math"

func Approach(value, target, step float64) float64 {
	return value + math.Max(-step, math.Min(step, target-value))
}
