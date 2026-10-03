package network

import (
	"math"
	"math/rand/v2"
	"reflect"
	"testing"
)

func TestPackedDistanceThresholds(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	for n := 0; n < 129; n++ {
		x, y, radius := make([]float64, n), make([]float64, n), make([]float64, n)
		for i := range x {
			x[i], y[i] = r.Float64()*22000-11000, r.Float64()*22000-11000
			radius[i] = x[i]*x[i] + y[i]*y[i]
			if i%3 == 0 {
				radius[i] = math.Nextafter(radius[i], math.Inf(-1))
			}
			if i%3 == 1 {
				radius[i] = math.Nextafter(radius[i], math.Inf(1))
			}
		}
		if n > 0 {
			x[0] = math.NaN()
		}
		a, b := make([]float64, n), make([]float64, n)
		am, bm := make([]uint8, (n+3)/4), make([]uint8, (n+3)/4)
		packedDistancesScalar(x, y, radius, a, am, 0, 0)
		packedDistances(x, y, radius, b, bm, 0, 0)
		if !reflect.DeepEqual(am, bm) {
			t.Fatalf("n=%d masks differ", n)
		}
		for i := range a {
			if math.Float64bits(a[i]) != math.Float64bits(b[i]) {
				t.Fatalf("n=%d index=%d distances differ", n, i)
			}
		}
	}
}

func BenchmarkPackedDistances(b *testing.B) {
	const n = 2048
	x, y, radius, out := make([]float64, n), make([]float64, n), make([]float64, n), make([]float64, n)
	masks := make([]uint8, n/4)
	for i := range x {
		x[i] = float64(i) * 11
		y[i] = float64(i%17) * 73
		radius[i] = 2500 * 2500
	}
	b.Run("scalar", func(b *testing.B) {
		for b.Loop() {
			packedDistancesScalar(x, y, radius, out, masks, 5000, 2000)
		}
	})
	b.Run("selected", func(b *testing.B) {
		for b.Loop() {
			packedDistances(x, y, radius, out, masks, 5000, 2000)
		}
	})
}
