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

// Bound the offset polygon, including the miter at acute corners. Recovery
// intersects face slabs, so the ordinary rounded-shape radius is insufficient.
func recoveryRadius(f *Fixture, slop float64) float64 {
	if f.Geometry.Count == 0 || f.Geometry.Count != len(f.Geometry.Vertices) {
		return math.Inf(1)
	}

	// Sixteen evenly spaced circle axes have sec(pi/16) < 1.02 corner reach.
	padding := 1.02

	if polygon, ok := f.Shape.(*shape.PolygonShape); ok {
		for i, normal := range polygon.Normals {
			previous := polygon.Normals[(i+len(polygon.Normals)-1)%len(polygon.Normals)]
			padding = max(padding, 2/math.Abs(Vec.Cross(previous, normal)))
		}
	}

	return (f.Geometry.GetBound().Radius+max(0, f.Geometry.Radius+slop)*padding)*(1+1e-10) + recoveryTolerance
}

type recoveryCircle struct {
	center Vec.Vector
	radius float64
	pose   uint64
}

type recoveryObstacle struct {
	body   *Body
	radius float64
}

func (f *Fixture) recoveryBound(slop float64) *recoveryCircle {
	if f.recovery.radius == 0 || f.recoverySlop != slop {
		f.recovery.radius = recoveryRadius(f, slop)
		f.recoverySlop = slop
		f.recovery.pose = ^f.Body.poseVersion
	}

	if f.recovery.pose != f.Body.poseVersion {
		bound := f.Geometry.GetBound()
		Vec.TransformInto(&f.recovery.center, f.Body.Xf, Vec.Create(bound.X, bound.Y))

		// At huge world coordinates, keep the original relative projections;
		// subtracting separately translated centers can lose local detail.
		if math.Abs(f.recovery.center.X) > 1e9 || math.Abs(f.recovery.center.Y) > 1e9 {
			f.recovery.radius = math.Inf(1)
		}

		f.recovery.pose = f.Body.poseVersion
	}

	return &f.recovery
}

func recoveryIntersects(delta Vec.Vector, radius float64, direction Vec.Vector, limit float64) bool {
	if math.IsInf(limit, 1) {
		return math.Abs(Vec.Cross(delta, direction)) <= radius && Vec.Dot(delta, direction) >= -radius
	}

	return Vec.Dot(delta, delta) <= (radius+limit)*(radius+limit)
}

func (b *Body) recoveryReach(slop float64) float64 {
	radius := -1.0

	for f := b.FixtureList; f != nil; f = f.Next {
		if f.Physics {
			radius = max(radius, (f.Geometry.GetBound().OffsetRadius+f.recoveryBound(slop).radius)*(1+1e-10))
		}
	}

	return radius
}

func recoveryAxes(f *Fixture, result []Vec.Vector) []Vec.Vector {
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

func recoveryClip(slab recoverySlab, direction Vec.Vector, entry, exit float64) (float64, float64) {
	speed := Vec.Dot(slab.normal, direction)

	if math.Abs(speed) < 1e-10 {
		if slab.lowerBound >= -recoveryTolerance || slab.upperBound <= recoveryTolerance {
			return 0, 0
		}
	} else {
		t0, t1 := slab.lowerBound/speed, slab.upperBound/speed
		entry, exit = max(entry, min(t0, t1)), min(exit, max(t0, t1))
	}

	return entry, exit
}

func recoveryInterval(slabs []recoverySlab, direction Vec.Vector) (float64, float64) {
	entry, exit := math.Inf(-1), math.Inf(1)

	for _, slab := range slabs {
		entry, exit = recoveryClip(slab, direction, entry, exit)

		if entry >= exit || exit <= 0 {
			return 0, 0
		}
	}

	return entry, exit
}

// For a region strictly containing the origin, entry is irrelevant to the
// interval union. Each nonparallel slab contributes just one positive exit.
func recoveryContainedExit(slabs []recoverySlab, direction Vec.Vector) float64 {
	exit := math.Inf(1)

	for _, slab := range slabs {
		speed := Vec.Dot(slab.normal, direction)
		var boundary float64

		if speed >= 1e-10 {
			boundary = slab.upperBound
		} else if speed <= -1e-10 {
			boundary = slab.lowerBound
		} else {
			continue
		}

		if candidate := boundary / speed; candidate < exit {
			exit = candidate
		}
	}

	return exit
}

func recoveryDistance(intervals [][2]float64) float64 {
	slices.SortFunc(intervals, func(a, b [2]float64) int {
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

	return distance
}

// A conservative length for pruning; keep Hypot's extreme-value behavior.
func recoveryAxisLength(axis Vec.Vector) float64 {
	squared := Vec.Dot(axis, axis)

	if squared >= 0x1p-1022 && squared <= math.MaxFloat64 {
		return math.Sqrt(squared) * (1 + 1e-12)
	}

	return math.Hypot(axis.X, axis.Y)
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

	if len(candidates) == 0 {
		return
	}

	var obstacles []recoveryObstacle

	for other := w.BodyList; other != nil; other = other.Next {
		if radius := other.recoveryReach(slop); radius >= 0 {
			obstacles = append(obstacles, recoveryObstacle{other, radius})
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

		origin := body.Xf.P
		reach := body.recoveryReach(slop)
		var axes []Vec.Vector
		var temporary []recoverySlab
		var intervals [][2]float64
		var firstEntry, firstExit float64

		// The first ray visits every fixture pair. Its escape is an upper bound
		// for the remaining search, including obstacles beyond current contacts.
		pairSlabs := func(a, b *Fixture, limit float64) []recoverySlab {
			ca, cb := a.recoveryBound(slop), b.recoveryBound(slop)
			delta := Vec.Subtract(cb.center, ca.center)
			radius := ca.radius + cb.radius

			if !recoveryIntersects(delta, radius, directions[0], limit) {
				return nil
			}

			axes = recoveryAxes(a, axes[:0])
			axes = recoveryAxes(b, axes)

			if a.Shape.Base().Type == "circle" || b.Shape.Base().Type == "circle" {
				axes = append(axes, directions[:16]...)
			}

			temporary = temporary[:0]
			entry, exit := math.Inf(-1), math.Inf(1)

			for _, normal := range axes {
				a0, a1 := recoveryProject(a, normal, origin)
				b0, b1 := recoveryProject(b, normal, origin)
				slab := recoverySlab{normal, b0 - a1 - slop, b1 - a0 + slop}

				// A separating slab outside the entire search disk cannot affect
				// any better escape, even through a chain of adjacent obstacles.
				if math.IsInf(limit, 1) {
					entry, exit = recoveryClip(slab, directions[0], entry, exit)

					// A pair missing this ray cannot contain its origin either.
					if entry >= exit || exit <= 0 {
						return nil
					}
				} else {
					extent := limit * recoveryAxisLength(normal)

					if slab.lowerBound > extent || slab.upperBound < -extent {
						return nil
					}
				}

				temporary = append(temporary, slab)
			}

			firstEntry, firstExit = entry, exit
			return temporary
		}

		for _, obstacle := range obstacles {
			other := obstacle.body

			if other == body || !recoveryIntersects(Vec.Subtract(other.Xf.P, origin), reach+obstacle.radius, directions[0], math.Inf(1)) {
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

					slabs := pairSlabs(a, b, math.Inf(1))

					if len(slabs) == 0 {
						continue
					}

					contains := true

					for _, slab := range slabs {
						contains = contains && slab.lowerBound < -recoveryTolerance && slab.upperBound > recoveryTolerance
					}

					if contains {
						for _, slab := range slabs {
							for _, direction := range [2]Vec.Vector{slab.normal, Vec.Scale(slab.normal, -1)} {
								if !slices.Contains(directions, direction) {
									directions = append(directions, direction)
								}
							}
						}
					}

					if firstExit > 0 && firstEntry < firstExit {
						intervals = append(intervals, [2]float64{firstEntry, firstExit})
					}
				}
			}
		}

		best := recoveryDistance(intervals)
		escape := Vec.Vector{}

		if !math.IsInf(best, 0) {
			escape = Vec.Scale(directions[0], best)
		}

		maxDirectionLength := 0.0

		for _, direction := range directions {
			maxDirectionLength = max(maxDirectionLength, recoveryAxisLength(direction))
		}

		limit := (best+recoveryTolerance)*maxDirectionLength + recoveryTolerance
		var slabs []recoverySlab
		var ends []int
		var inside []bool

		for _, obstacle := range obstacles {
			other := obstacle.body

			if other == body || !recoveryIntersects(Vec.Subtract(other.Xf.P, origin), reach+obstacle.radius, directions[0], limit) {
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

					if pair := pairSlabs(a, b, limit); len(pair) > 0 {
						contained := true

						for _, slab := range pair {
							contained = contained && slab.lowerBound < -recoveryTolerance && slab.upperBound > recoveryTolerance
						}

						inside = append(inside, contained)
						slabs = append(slabs, pair...)
						ends = append(ends, len(slabs))
					}
				}
			}
		}

	search:
		for _, direction := range directions[1:] {
			intervals = intervals[:0]
			start := 0
			reachable := 0.0

			for i, end := range ends {
				entry, exit := 0.0, 0.0

				if inside[i] {
					exit = recoveryContainedExit(slabs[start:end], direction)
				} else {
					entry, exit = recoveryInterval(slabs[start:end], direction)
				}

				start = end

				if exit > 0 && entry < exit {
					// A connected subset of intervals already rules out improvement.
					if entry <= reachable+recoveryTolerance && exit > reachable {
						reachable = exit
					}

					if reachable >= best-recoveryTolerance {
						continue search
					}

					intervals = append(intervals, [2]float64{entry, exit})
				}
			}

			distance := recoveryDistance(intervals)

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
