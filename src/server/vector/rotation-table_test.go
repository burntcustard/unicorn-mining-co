package vector

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

func TestRotationTableAccuracy(t *testing.T) {
	for i := 0; i <= 400000; i++ {
		angle := -64 + 128*float64(i)/400000
		s, c := SinCos(angle)
		wantS, wantC := math.Sincos(angle)
		if math.Abs(s-wantS) > 1e-12 || math.Abs(c-wantC) > 1e-12 || math.Abs(s*s+c*c-1) > 1e-12 {
			t.Fatalf("angle %g: got %.17g %.17g, want %.17g %.17g", angle, s, c, wantS, wantC)
		}
	}
	for _, angle := range []float64{-1e20, -65, 65, 1e20, math.Inf(1), math.NaN()} {
		s, c := SinCos(angle)
		wantS, wantC := math.Sincos(angle)
		if !(s == wantS || math.IsNaN(s) && math.IsNaN(wantS)) || !(c == wantC || math.IsNaN(c) && math.IsNaN(wantC)) {
			t.Fatalf("fallback differs at %g", angle)
		}
	}
}

func TestRotationTableMatchesTypeScript(t *testing.T) {
	data, err := os.ReadFile("../../../tests/fixtures/rotation.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct{ Angle, S, C float64 }
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, test := range cases {
		s, c := SinCos(test.Angle)
		if s != test.S || c != test.C {
			t.Fatalf("angle %.17g: Go %.17g %.17g != TypeScript %.17g %.17g", test.Angle, s, c, test.S, test.C)
		}
	}
}
