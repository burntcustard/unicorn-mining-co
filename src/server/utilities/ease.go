// Port of src/client/utilities/ease.ts.
package utilities

import "math"

func EaseProgress(progress float64) float64 {
	return (1 - math.Cos(math.Pi*progress)) / 2
}
