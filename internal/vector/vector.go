// Port of src/shared/vector.ts. Keep arithmetic order and output aliasing.
// Vector formulas: Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT.
// Game vector operations also derive from Kontra, MIT. See LICENSE.
package vector

import "math"

type Vector struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func Create(x, y float64) Vector              { return Vector{x, y} }
func Set(out *Vector, value Vector) *Vector   { *out = value; return out }
func SetXY(out *Vector, x, y float64) *Vector { *out = Vector{x, y}; return out }
func Clone(value Vector) Vector               { return value }
func Add(a, b Vector) Vector                  { return Vector{a.X + b.X, a.Y + b.Y} }
func AddScaled(point, direction Vector, distance float64) Vector {
	return Vector{point.X + direction.X*distance, point.Y + direction.Y*distance}
}
func Subtract(a, b Vector) Vector               { return Vector{a.X - b.X, a.Y - b.Y} }
func Scale(value Vector, amount float64) Vector { return Vector{value.X * amount, value.Y * amount} }
func Length(value Vector) float64               { return math.Sqrt(value.X*value.X + value.Y*value.Y) }
func Distance(a, b Vector) float64              { return math.Hypot(a.X-b.X, a.Y-b.Y) }
func Normalize(value Vector) Vector {
	magnitude := Length(value)
	if magnitude == 0 || math.IsNaN(magnitude) {
		magnitude = 1
	}
	return Vector{value.X / magnitude, value.Y / magnitude}
}
func Combine2Into(out *Vector, am float64, a Vector, bm float64, b Vector) *Vector {
	*out = Vector{am*a.X + bm*b.X, am*a.Y + bm*b.Y}
	return out
}
func Combine3Into(out *Vector, am float64, a Vector, bm float64, b Vector, cm float64, c Vector) *Vector {
	*out = Vector{am*a.X + bm*b.X + cm*c.X, am*a.Y + bm*b.Y + cm*c.Y}
	return out
}
func CrossScalarInto(out *Vector, v Vector, w float64) *Vector {
	*out = Vector{w * v.Y, -w * v.X}
	return out
}
func Cross(a, b Vector) float64           { return a.X*b.Y - a.Y*b.X }
func Dot(a, b Vector) float64             { return a.X*b.X + a.Y*b.Y }
func LengthSquared(a Vector) float64      { return a.X*a.X + a.Y*a.Y }
func DistanceSquared(a, b Vector) float64 { dx, dy := a.X-b.X, a.Y-b.Y; return dx*dx + dy*dy }
