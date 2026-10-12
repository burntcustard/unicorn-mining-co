// Port of the mechanical geometry in src/client/utilities/geometry.ts.
package simulation

import (
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
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
