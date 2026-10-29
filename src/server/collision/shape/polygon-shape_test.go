package shape

import (
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

func TestFailedHullTraversalTerminates(t *testing.T) {
	hull := NewPolygon([]Vec.Vector{{X: 10}, {X: 12}, {X: 13, Y: 1}, {X: 12, Y: 2}, {X: 10, Y: 2}, {X: 9, Y: 1}}, nil, .5)
	hull.Set([]Vec.Vector{{}, {X: 1, Y: 1}, {X: 10, Y: math.NaN()}}, .5)

	if hull.Count != 4 || len(hull.Vertices) != 4 || len(hull.Normals) != 4 || hull.Centroid != (Vec.Vector{}) {
		t.Fatal("fallback must discard old geometry and reset its center")
	}

	for _, point := range hull.Vertices {
		if math.IsNaN(point.X) || math.IsNaN(point.Y) || math.IsInf(point.X, 0) || math.IsInf(point.Y, 0) {
			t.Fatal("a failed hull walk must terminate with finite geometry")
		}
	}
}

func TestRotatedCollinearPolygonHull(t *testing.T) {
	captured := []Vec.Vector{
		{X: 14.006162036981271, Y: -2.97317155034599},
		{X: 22.006145009196764, Y: -2.9566656646630287},
		{X: 21.993765594934544, Y: 3.0433215644985907},
		{X: 13.993782622719051, Y: 3.0268156788156295},
		{X: 13.998940711994976, Y: 0.526820999998288},
		{X: 16.998934326575785, Y: 0.5330107071293986},
		{X: 17.000997562286155, Y: -0.4669871643975379},
		{X: 14.001003947705346, Y: -0.47317687152864846},
	}

	verify := func(points []Vec.Vector) {
		t.Helper()
		hull := NewPolygon(points, nil, .5)

		if hull.Count != 4 {
			t.Fatalf("collinear inserts entered the hull: %d vertices", hull.Count)
		}

		if math.IsNaN(hull.Centroid.X) || math.IsNaN(hull.Centroid.Y) || math.IsInf(hull.Centroid.X, 0) || math.IsInf(hull.Centroid.Y, 0) {
			t.Fatal("invalid centroid")
		}

		area := 0.0

		for i, from := range hull.Vertices {
			to := hull.Vertices[(i+1)%hull.Count]
			area += from.X*to.Y - to.X*from.Y

			for _, point := range points {
				if (to.X-from.X)*(point.Y-from.Y)-(to.Y-from.Y)*(point.X-from.X) < -1e-8 {
					t.Fatal("hull does not contain all input points")
				}
			}
		}

		if math.Abs(area/2-48) > 1e-6 {
			t.Fatalf("hull did not retain the enclosing rectangle: area %v", area/2)
		}
	}

	verify(captured)
	outline := []Vec.Vector{{X: 13, Y: -3}, {X: 21, Y: -3}, {X: 21, Y: 3}, {X: 13, Y: 3}, {X: 13, Y: .5}, {X: 16, Y: .5}, {X: 16, Y: -.5}, {X: 13, Y: -.5}}

	for step := range 1440 {
		sin, cos := math.Sincos(float64(step) * math.Pi / 720)
		points := make([]Vec.Vector, len(outline))

		for i, p := range outline {
			points[i] = Vec.Create(1+p.X*cos-p.Y*sin, p.X*sin+p.Y*cos)
		}

		verify(points)
	}
}
