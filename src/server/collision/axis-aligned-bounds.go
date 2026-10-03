// Port of src/client/collision/axis-aligned-bounds.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package collision

import (
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type AABB struct {
	LowerBound Vec.Vector `json:"lowerBound"`
	UpperBound Vec.Vector `json:"upperBound"`
}

func (a AABB) GetPerimeter() float64 {
	return 2 * (a.UpperBound.X - a.LowerBound.X + a.UpperBound.Y - a.LowerBound.Y)
}
func (out *AABB) Combine(a, b AABB) {
	*out = AABB{Vec.Vector{X: min(a.LowerBound.X, b.LowerBound.X), Y: min(a.LowerBound.Y, b.LowerBound.Y)}, Vec.Vector{X: max(b.UpperBound.X, a.UpperBound.X), Y: max(b.UpperBound.Y, a.UpperBound.Y)}}
}
func (out *AABB) Set(a AABB) { *out = a }
func (a AABB) Contains(b AABB) bool {
	return a.LowerBound.X <= b.LowerBound.X && a.LowerBound.Y <= b.LowerBound.Y && b.UpperBound.X <= a.UpperBound.X && b.UpperBound.Y <= a.UpperBound.Y
}
func Extend(out *AABB, value float64) {
	out.LowerBound.X -= value
	out.LowerBound.Y -= value
	out.UpperBound.X += value
	out.UpperBound.Y += value
}
func TestOverlap(a, b AABB) bool {
	return !(b.LowerBound.X > a.UpperBound.X || b.LowerBound.Y > a.UpperBound.Y || a.LowerBound.X > b.UpperBound.X || a.LowerBound.Y > b.UpperBound.Y)
}
func CombinedPerimeter(a, b AABB) float64 {
	lx, ly := min(a.LowerBound.X, b.LowerBound.X), min(a.LowerBound.Y, b.LowerBound.Y)
	ux, uy := max(a.UpperBound.X, b.UpperBound.X), max(a.UpperBound.Y, b.UpperBound.Y)
	return 2 * (ux - lx + uy - ly)
}
