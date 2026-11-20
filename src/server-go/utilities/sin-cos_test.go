package utilities

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

func TestSinCosAccuracy(t *testing.T) {
	for i := 0; i <= 400000; i++ {
		angle := -64 + 128*float64(i)/400000
		sin, cos := SinCos(angle)
		wantS, wantC := math.Sincos(angle)

		if !(math.Abs(sin-wantS) <= 1e-12 && math.Abs(cos-wantC) <= 1e-12 && math.Abs(sin*sin+cos*cos-1) <= 1e-12) {
			t.Fatalf("angle %g: got %.17g %.17g, want %.17g %.17g", angle, sin, cos, wantS, wantC)
		}
	}
}

func TestSinCosWrapsLargeAngles(t *testing.T) {
	for _, angle := range []float64{-math.MaxFloat64, -1e300, -1e20, -65, -5 * math.Pi / 2, 5 * math.Pi / 2, 65, 1e20, 1e300, math.MaxFloat64} {
		sin, cos := SinCos(angle)
		wantS, wantC := math.Sincos(math.Mod(angle, 2*math.Pi))

		if !(math.Abs(sin-wantS) <= 1e-12 && math.Abs(cos-wantC) <= 1e-12 && math.Abs(sin*sin+cos*cos-1) <= 1e-12) {
			t.Fatalf("wrapped angle %g: got %.17g %.17g, want %.17g %.17g", angle, sin, cos, wantS, wantC)
		}
	}
}

func TestSinCosSpecialValues(t *testing.T) {
	for _, angle := range []float64{0, math.Copysign(0, -1), 2 * math.Pi, -2 * math.Pi} {
		sin, cos := SinCos(angle)

		if math.Float64bits(sin) != math.Float64bits(math.Copysign(0, angle)) || cos != 1 {
			t.Fatalf("angle %g: got %.17g %.17g, want signed zero and one", angle, sin, cos)
		}
	}

	for _, angle := range []float64{math.Inf(-1), math.Inf(1), math.NaN()} {
		sin, cos := SinCos(angle)

		if !math.IsNaN(sin) || !math.IsNaN(cos) {
			t.Fatalf("angle %g: got %g %g, want NaN NaN", angle, sin, cos)
		}
	}
}

func TestSinCosMatchesTypeScript(t *testing.T) {
	data, err := os.ReadFile("../../../tests/fixtures/rotation.json")

	if err != nil {
		t.Fatal(err)
	}

	var cases []struct{ Angle, Sin, Cos float64 }

	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}

	for _, test := range cases {
		sin, cos := SinCos(test.Angle)

		if sin != test.Sin || cos != test.Cos {
			t.Fatalf("angle %.17g: Go %.17g %.17g != TypeScript %.17g %.17g", test.Angle, sin, cos, test.Sin, test.Cos)
		}
	}
}
