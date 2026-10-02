package random

import (
	"math"
	"testing"
)

func TestRandomMatchesFloatingRemainder(t *testing.T) {
	for _, seed := range []float64{0, 1, 25, 2147483646, 2147483647, math.MaxUint32, -1, -25, 0.5, 1e20, math.Inf(1), math.NaN()} {
		r := CreateRandom(seed)
		state := seed
		for i := 0; i < 10000; i++ {
			state = math.Mod((state+1)*48271, 2147483647)
			got := r.Next()
			want := state / 2147483647
			if got != want && !(math.IsNaN(got) && math.IsNaN(want)) {
				t.Fatalf("seed %g, step %d: %g != %g", seed, i, got, want)
			}
		}
	}
}
