package physics

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestRecoveryContainedExitMatchesInterval(t *testing.T) {
	slabs := []recoverySlab{
		{Vec.Create(1, 0), -2, 3},
		{Vec.Create(0, 1), -4, 5},
		{Vec.Create(.6, .8), -.25, 7},
		{Vec.Create(-.8, .6), -6, .5},
	}

	for _, direction := range []Vec.Vector{
		{}, {X: 1}, {X: -1}, {Y: 1}, {Y: -1},
		{X: 1e-11, Y: 1}, {X: -1e-11, Y: -1},
		{X: 1e-10, Y: 1}, {X: -1e-10, Y: -1},
		{X: .6, Y: .8}, {X: -.6, Y: -.8},
	} {
		for count := 1; count <= len(slabs); count++ {
			_, want := recoveryInterval(slabs[:count], direction)

			if got := recoveryContainedExit(slabs[:count], direction); got != want {
				t.Fatalf("direction %v, %d slabs: exit %g != %g", direction, count, got, want)
			}
		}
	}
}

func TestRecoveryAxisLengthIsConservative(t *testing.T) {
	for _, axis := range []Vec.Vector{
		{}, {X: 1}, {X: .6, Y: .8}, {X: 3, Y: -4},
		{X: math.SmallestNonzeroFloat64}, {X: 1e-160, Y: 1e-160},
		{X: 1e160, Y: 1e160}, {X: math.Inf(1)},
	} {
		want := math.Hypot(axis.X, axis.Y)

		if got := recoveryAxisLength(axis); !(got >= want) {
			t.Fatalf("axis %v: pruning length %g < %g", axis, got, want)
		}
	}
}

func TestRecoveryBoundContainsOffsetCorners(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, points := range [][]Vec.Vector{
		{{X: -100}, {X: 100}, {Y: .6}},
		{{X: -20, Y: -10}, {X: 20, Y: -10}, {X: 20, Y: 10}, {X: -20, Y: 10}},
	} {
		for _, margin := range []float64{0, 1, 100} {
			world := NewWorld(catalog.Simulation)
			body := world.CreateBody()
			polygon := shape.NewPolygon(points, &margin, world.Rules.LinearSlop)
			fixture := body.CreateFixture(polygon, FixtureOpt{})

			for _, angle := range []float64{0, .71, math.Pi / 2} {
				body.SetTransform(Vec.Create(1234, -5678), angle)
				bound := fixture.recoveryBound(world.Rules.LinearSlop)

				for i, normal := range polygon.Normals {
					previous := polygon.Normals[(i+len(polygon.Normals)-1)%len(polygon.Normals)]
					vertex := polygon.Vertices[i]
					padding := margin + world.Rules.LinearSlop
					a, b := Vec.Dot(previous, vertex)+padding, Vec.Dot(normal, vertex)+padding
					determinant := Vec.Cross(previous, normal)
					corner := Vec.Create((a*normal.Y-previous.Y*b)/determinant, (previous.X*b-a*normal.X)/determinant)
					Vec.TransformInto(&corner, body.Xf, corner)

					if Vec.Distance(corner, bound.center) > bound.radius {
						t.Fatalf("offset corner escaped its recovery bound: %v", corner)
					}
				}
			}
		}
	}
}

func TestRecoveryBoundFollowsPoseAndSlop(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	body := NewWorld(catalog.Simulation).CreateBody()
	fixture := body.CreateFixture(shape.NewCircle(Vec.Create(20, -10), 3), FixtureOpt{})

	for _, angle := range []float64{0, .71, -1.2} {
		body.SetTransform(Vec.Create(1234+angle, -5678), angle)
		bound := fixture.recoveryBound(.5)
		var center Vec.Vector
		Vec.TransformInto(&center, body.Xf, Vec.Create(20, -10))

		if bound.center != center {
			t.Fatal("recovery bound retained an earlier pose")
		}

		radius := bound.radius

		if fixture.recoveryBound(20).radius <= radius {
			t.Fatal("recovery bound ignored changed slop")
		}
	}

	body.SetTransform(Vec.Create(1e12, -1e12), 0)

	if !math.IsInf(fixture.recoveryBound(.5).radius, 1) {
		t.Fatal("large world coordinates must retain relative projection checks")
	}
}
