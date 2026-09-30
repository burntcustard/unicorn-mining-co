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
