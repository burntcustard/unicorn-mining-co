package utilities

import (
	"math"
	"testing"
)

func TestRoundJavaScriptTies(t *testing.T) {
	cases := []struct{ input, want float64 }{
		{0.000000005, 0.00000001},
		{-0.000000005, math.Copysign(0, -1)},
		{1.000000005, 1.00000001},
		{-1.000000005, -1},
		{2.123456789, 2.12345679},
	}

	for _, test := range cases {
		got := Round(test.input)

		if got != test.want || (got == 0 && math.Signbit(got) != math.Signbit(test.want)) {
			t.Errorf("Round(%g) = %g, want %g", test.input, got, test.want)
		}
	}
}

func TestMotionBinaryGrid(t *testing.T) {
	const step = 0x1p-24

	cases := []struct{ input, want float64 }{
		{step / 2, 0}, {3 * step / 2, 2 * step}, {5 * step / 2, 2 * step},
		{-step / 2, math.Copysign(0, -1)}, {-3 * step / 2, -2 * step},
		{math.Nextafter(step/2, math.Inf(1)), step},
		{math.Nextafter(step/2, math.Inf(-1)), 0},
		{math.Copysign(0, -1), math.Copysign(0, -1)},
		{math.Inf(1), math.Inf(1)}, {math.Inf(-1), math.Inf(-1)},
	}

	for _, c := range cases {
		if got := RoundMotion(c.input); math.Float64bits(got) != math.Float64bits(c.want) {
			t.Fatalf("RoundMotion(%g)=%g, want %g", c.input, got, c.want)
		}
	}

	if !math.IsNaN(RoundMotion(math.NaN())) {
		t.Fatal("NaN became a number")
	}
}
