package collision

import (
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

func TestCombinedBoundsNumericEdges(t *testing.T) {
	values := []float64{-7, 7, 0, math.Copysign(0, -1), math.Inf(-1), math.Inf(1), math.NaN()}
	for _, x := range values {
		for _, y := range values {
			a := AABB{LowerBound: Vec.Vector{X: x, Y: y}, UpperBound: Vec.Vector{X: x, Y: y}}
			b := AABB{LowerBound: Vec.Vector{X: y, Y: x}, UpperBound: Vec.Vector{X: y, Y: x}}
			var box AABB
			box.Combine(a, b)
			got := [4]float64{box.LowerBound.X, box.LowerBound.Y, box.UpperBound.X, box.UpperBound.Y}
			want := [4]float64{math.Min(x, y), math.Min(y, x), math.Max(y, x), math.Max(x, y)}
			for i := range got {
				// Like JavaScript Math.min/max, any NaN must propagate, even with infinity.
				if math.IsNaN(x) || math.IsNaN(y) {
					if !math.IsNaN(got[i]) {
						t.Fatal("NaN did not propagate through bounds")
					}
					continue
				}
				if math.Float64bits(got[i]) != math.Float64bits(want[i]) {
					t.Fatalf("bounds (%g,%g), component %d: %g != %g", x, y, i, got[i], want[i])
				}
			}
		}
	}
}
