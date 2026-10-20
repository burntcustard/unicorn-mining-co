package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

type obstacleGeometry struct {
	points              []simulation.Point
	minimum, maximum    Vec.Vector
	radius, innerRadius float64
}

/*
Cache local outline bounds once. Invalid outlines retain their circle obstacle.
The inner circle can reject blocked sweeps before any polygon edge inspection.
*/
func newObstacleGeometry(points []simulation.Point) *obstacleGeometry {
	if len(points) < 3 {
		return nil
	}

	g := &obstacleGeometry{points: points, minimum: Vec.Create(math.Inf(1), math.Inf(1)), maximum: Vec.Create(math.Inf(-1), math.Inf(-1)), innerRadius: math.Inf(1)}
	area := 0.
	previous := points[len(points)-1]

	for _, point := range points {
		area += previous[0]*point[1] - previous[1]*point[0]
		g.minimum.X = min(g.minimum.X, point[0])
		g.minimum.Y = min(g.minimum.Y, point[1])
		g.maximum.X = max(g.maximum.X, point[0])
		g.maximum.Y = max(g.maximum.Y, point[1])
		g.radius = max(g.radius, point[0]*point[0]+point[1]*point[1])
		g.innerRadius = min(g.innerRadius, pointSegmentDistanceSquared(Vec.Vector{}, Vec.Create(previous[0], previous[1]), Vec.Create(point[0], point[1])))
		previous = point
	}

	if area == 0 {
		return nil
	}

	g.radius = math.Sqrt(g.radius)

	if g.distance(Vec.Vector{}) >= 0 {
		g.innerRadius = 0
	} else {
		g.innerRadius = math.Sqrt(g.innerRadius)
	}

	return g
}

func (g *obstacleGeometry) distance(point Vec.Vector) float64 {
	nearest, inside := math.Inf(1), false
	previous := g.points[len(g.points)-1]
	from := Vec.Create(previous[0], previous[1])

	for _, vertex := range g.points {
		to := Vec.Create(vertex[0], vertex[1])
		nearest = min(nearest, pointSegmentDistanceSquared(point, from, to))

		if (from.Y > point.Y) != (to.Y > point.Y) && point.X < (to.X-from.X)*(point.Y-from.Y)/(to.Y-from.Y)+from.X {
			inside = !inside
		}

		from = to
	}

	distance := math.Sqrt(nearest)

	if inside {
		return -distance
	}

	return distance
}

func (g *obstacleGeometry) clear(from, to Vec.Vector, radius float64) bool {
	if min(from.X, to.X) > g.maximum.X+radius || max(from.X, to.X) < g.minimum.X-radius || min(from.Y, to.Y) > g.maximum.Y+radius || max(from.Y, to.Y) < g.minimum.Y-radius {
		return true
	}

	if g.innerRadius > 0 && pointSegmentDistanceSquared(Vec.Vector{}, from, to) < (g.innerRadius+radius)*(g.innerRadius+radius) {
		return false
	}

	inside := false
	previous := g.points[len(g.points)-1]
	a := Vec.Create(previous[0], previous[1])

	for _, vertex := range g.points {
		b := Vec.Create(vertex[0], vertex[1])

		if segmentDistanceSquared(from, to, a, b) < radius*radius {
			return false
		}

		if (a.Y > from.Y) != (b.Y > from.Y) && from.X < (b.X-a.X)*(from.Y-a.Y)/(b.Y-a.Y)+a.X {
			inside = !inside
		}

		a = b
	}

	return !inside
}
