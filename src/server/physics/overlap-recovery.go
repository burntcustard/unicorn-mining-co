// Port of src/client/physics/overlap-recovery.ts.
package physics

import (
	"math"
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

const recoveryTolerance = 1e-8

type recoverySlab struct {
	normal                 Vec.Vector
	lowerBound, upperBound float64
}

func recoveryAxes(f *Fixture) []Vec.Vector {
	result := []Vec.Vector{}

	if s, ok := f.Shape.(*shape.PolygonShape); ok {
		for _, normal := range s.Normals {
			var axis Vec.Vector
			Vec.RotateInto(&axis, f.Body.Xf.Q, normal)
			result = append(result, axis)
		}
	}

	return result
}

func recoveryProject(f *Fixture, normal, origin Vec.Vector) (float64, float64) {
	var axis Vec.Vector
	Vec.UnrotateInto(&axis, f.Body.Xf.Q, normal)
	offset := Vec.Dot(Vec.Subtract(f.Body.Xf.P, origin), normal)
	lowerBound, upperBound := math.Inf(1), math.Inf(-1)

	for _, vertex := range f.Shape.Base().Vertices {
		value := Vec.Dot(vertex, axis) + offset
		lowerBound, upperBound = min(lowerBound, value), max(upperBound, value)
	}

	return lowerBound - f.Shape.Base().Radius, upperBound + f.Shape.Base().Radius
}

// Search the union of forbidden translations, preserving the body's full
// compound hitbox. Recovery changes position without adding impact velocity.
func (w *World) recoverOverlaps() {
	candidates := []*Body{}
	var manifold collision.Manifold
	slop := w.Rules.LinearSlop

	var result collision.WorldManifold

	embedded := func(c *Contact) bool {
		a, b := c.FixtureA, c.FixtureB

		if !c.EnabledFlag || !a.Physics || !b.Physics || a.Body.InvMass == 0 && b.Body.InvMass == 0 || !a.ShouldCollide(b) {
			return false
		}

		c.Evaluate(&manifold, a.Body.Xf, b.Body.Xf)

		if manifold.PointCount == 0 {
			return false
		}

		manifold.GetWorldManifold(&result, a.Body.Xf, a.Shape.Base().Radius, b.Body.Xf, b.Shape.Base().Radius)
		deep := false

		for _, separation := range result.Separations[:result.PointCount] {
			deep = deep || separation < -3*slop-recoveryTolerance
		}

		return deep
	}

	for c := w.ContactList; c != nil; c = c.Next {
		if !embedded(c) {
			continue
		}

		a, b := c.FixtureA, c.FixtureB

		body := a.Body

		if b.Body.InvMass > a.Body.InvMass {
			body = b.Body
		}

		if body.InvMass > 0 && !slices.Contains(candidates, body) {
			candidates = append(candidates, body)
		}
	}

	for _, body := range candidates {
		trapped := false

		for edge := body.ContactList; edge != nil; edge = edge.Next {
			if embedded(edge.Contact) {
				trapped = true
				break
			}
		}

		if !trapped {
			continue
		}

		directions := make([]Vec.Vector, 16)

		for i := range 16 {
			angle := body.GetAngle() + float64(i)*math.Pi/8
			directions[i] = Vec.Create(math.Cos(angle), math.Sin(angle))
		}

		obstacles := [][]recoverySlab{}
		origin := body.Xf.P

		for other := w.BodyList; other != nil; other = other.Next {
			if other == body {
				continue
			}

			for a := body.FixtureList; a != nil; a = a.Next {
				if !a.Physics {
					continue
				}

				for b := other.FixtureList; b != nil; b = b.Next {
					if !b.Physics || !a.ShouldCollide(b) {
						continue
					}

					axes := append(recoveryAxes(a), recoveryAxes(b)...)

					if a.Shape.Base().Type == "circle" || b.Shape.Base().Type == "circle" {
						axes = append(axes, directions[:16]...)
					}

					slabs := []recoverySlab{}
					contains := true

					for _, normal := range axes {
						a0, a1 := recoveryProject(a, normal, origin)
						b0, b1 := recoveryProject(b, normal, origin)
						slab := recoverySlab{normal, b0 - a1 - slop, b1 - a0 + slop}
						slabs = append(slabs, slab)
						contains = contains && slab.lowerBound < -recoveryTolerance && slab.upperBound > recoveryTolerance
					}

					if contains {
						for _, slab := range slabs {
							directions = append(directions, slab.normal, Vec.Scale(slab.normal, -1))
						}
					}

					obstacles = append(obstacles, slabs)
				}
			}
		}

		best := math.Inf(1)
		escape := Vec.Vector{}

		for _, direction := range directions {
			intervals := [][2]float64{}

			for _, slabs := range obstacles {
				entry, exit := math.Inf(-1), math.Inf(1)

				for _, slab := range slabs {
					speed := Vec.Dot(slab.normal, direction)

					if math.Abs(speed) < 1e-10 {
						if slab.lowerBound >= -recoveryTolerance || slab.upperBound <= recoveryTolerance {
							exit = math.Inf(-1)
							break
						}
					} else {
						t0, t1 := slab.lowerBound/speed, slab.upperBound/speed
						entry, exit = max(entry, min(t0, t1)), min(exit, max(t0, t1))
					}
				}

				if exit > 0 && entry < exit {
					intervals = append(intervals, [2]float64{entry, exit})
				}
			}

			slices.SortStableFunc(intervals, func(a, b [2]float64) int {
				if a[0] < b[0] {
					return -1
				}

				if a[0] > b[0] {
					return 1
				}

				return 0
			})

			distance := 0.0

			for _, interval := range intervals {
				if interval[0] > distance+recoveryTolerance {
					break
				}

				distance = max(distance, interval[1])
			}

			if distance < best-recoveryTolerance {
				best, escape = distance, Vec.Scale(direction, distance)
			}
		}

		if best > 0 && !math.IsInf(best, 0) {
			body.SetTransform(Vec.Add(origin, escape), body.GetAngle())
		}
	}

	if len(candidates) > 0 {
		w.FindNewContacts()
	}
}
