package collision

import (
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"testing"
)

func TestSweepTransformCacheHandlesZeroValueAndMutation(t *testing.T) {
	sweeps := []Sweep{{}, NewSweep(), {A0: -1, A: 1}}
	for _, sweep := range sweeps {
		for _, beta := range []float64{0, 0.5, 1, 0.5} {
			var got Vec.TransformValue
			sweep.GetTransform(&got, beta)
			want := Vec.Transform(0, 0, (1-beta)*sweep.A0+beta*sweep.A)
			if got != want {
				t.Fatalf("beta %g: got %+v want %+v", beta, got, want)
			}
		}
		sweep.A0, sweep.A = 0.3, 0.5
		sweep.C0, sweep.C = Vec.Vector{X: 1, Y: 2}, Vec.Vector{X: 3, Y: 4}
		for _, beta := range []float64{0, 0.5, 1, 0} {
			var got Vec.TransformValue
			sweep.GetTransform(&got, beta)
			want := Vec.Transform(1-beta+beta*3, (1-beta)*2+beta*4, (1-beta)*0.3+beta*0.5)
			if got != want {
				t.Fatalf("mutated beta %g: got %+v want %+v", beta, got, want)
			}
		}
	}
}
