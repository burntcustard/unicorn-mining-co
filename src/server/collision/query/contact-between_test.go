package query

import (
	"math"
	"testing"

	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestPreparedContactsReuseGeometryAtDifferentTransforms(t *testing.T) {
	margin := 0.0
	circle := ShapeData{Radius: 1}
	polygon := ShapeData{Outline: [][]float64{{-1, -1}, {1, -1}, {1, 1}, {-1, 1}}, CollisionMargin: &margin}

	for _, test := range []struct {
		name string
		a, b ShapeData
	}{
		{"circles", circle, circle},
		{"polygon-circle", polygon, circle},
		{"circle-polygon", circle, polygon},
		{"polygons", polygon, polygon},
	} {
		t.Run(test.name, func(t *testing.T) {
			a, b := ShapeOf(test.a, 0.005), ShapeOf(test.b, 0.005)

			for _, rotation := range []float64{0, math.Pi / 2, math.Pi} {
				normal := Vec.Create(math.Cos(rotation), math.Sin(rotation))
				position := Vec.Create(20, -10)
				xa := Vec.Transform(position.X, position.Y, rotation)
				positionB := Vec.AddScaled(position, normal, 1.5)
				xb := Vec.Transform(positionB.X, positionB.Y, rotation)
				contact, ok := ContactShapes(a, b, xa, xb, 0.005)

				if !ok || math.Abs(contact.Depth-0.5) > 1e-12 || Vec.DistanceSquared(contact.Normal, normal) > 1e-24 {
					t.Fatalf("rotation %v: expected depth 0.5 and normal %v, got %+v (contact %v)", rotation, normal, contact, ok)
				}

				if projectedPoint := Vec.Dot(Vec.Subtract(contact.Point, position), normal); math.Abs(projectedPoint-0.75) > 1e-12 {
					t.Fatalf("rotation %v: contact point projects to %v, want 0.75", rotation, projectedPoint)
				}

				positionB = Vec.AddScaled(position, normal, 3)
				xb = Vec.Transform(positionB.X, positionB.Y, rotation)

				if _, ok := ContactShapes(a, b, xa, xb, 0.005); ok {
					t.Fatalf("rotation %v: separated shapes reported contact", rotation)
				}
			}
		})
	}
}

func TestPreparedContactsDoNotAllocate(t *testing.T) {
	polygon := ShapeOf(ShapeData{Outline: [][]float64{{-1, -1}, {1, -1}, {1, 1}, {-1, 1}}}, 0.005)
	circle := ShapeOf(ShapeData{Radius: 1}, 0.005)
	xa, xb := Vec.Transform(0, 0, 0), Vec.Transform(1.5, 0, 0)

	allocations := testing.AllocsPerRun(100, func() {
		ContactShapes(polygon, circle, xa, xb, 0.005)
		ContactShapes(circle, polygon, xb, xa, 0.005)
		ContactShapes(polygon, polygon, xa, xb, 0.005)
		ContactShapes(circle, circle, xa, xb, 0.005)
	})

	if allocations != 0 {
		t.Fatalf("prepared contact queries allocated %v times, want 0", allocations)
	}
}
