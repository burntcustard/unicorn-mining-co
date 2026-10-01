// Port of the mechanical geometry in src/shared/geometry.ts.
package simulation

import (
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
)

func RotatePoint(point Vec.Vector, angle float64) Vec.Vector {
	sin, cos := math.Sincos(angle)
	return Vec.Create(point.X*cos-point.Y*sin, point.X*sin+point.Y*cos)
}
func DirectionOf(angle float64) Vec.Vector {
	sin, cos := math.Sincos(angle)
	return Vec.Create(cos, sin)
}
func MovePoint(point Vec.Vector, angle, distance float64) Vec.Vector {
	return Vec.AddScaled(point, DirectionOf(angle), distance)
}
func PointBetween(from, to Point, at float64) Point {
	return Point{from[0] + (to[0]-from[0])*at, from[1] + (to[1]-from[1])*at}
}
func RotatePoints(points []Point, angle float64, position Vec.Vector) *ShapeOutline {
	out := &ShapeOutline{Points: make([]Point, len(points))}
	for i, p := range points {
		point := RotatePoint(Vec.Create(p[0], p[1]), angle)
		out.Points[i] = Point{position.X + point.X, position.Y + point.Y}
	}
	return out
}
func ShapeOutlineExtent(points []Point) (Point, float64) {
	middle := Point{}
	for _, p := range points {
		middle[0] += p[0]
		middle[1] += p[1]
	}
	middle[0] /= float64(len(points))
	middle[1] /= float64(len(points))
	return middle, RadiusOf(points, middle)
}
