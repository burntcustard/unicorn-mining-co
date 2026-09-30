// Port of src/shared/collision/shape/circle-shape.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package shape

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
)

type CircleShape struct{ BaseShape }

func NewCircle(position Vec.Vector, radius float64) *CircleShape {
	return &CircleShape{BaseShape{Type: "circle", Count: 1, Vertices: []Vec.Vector{position}, Radius: radius}}
}
func (s *CircleShape) Position() Vec.Vector     { return s.Vertices[0] }
func (s *CircleShape) SetPosition(p Vec.Vector) { s.Vertices[0] = p; s.bound = nil }
func (s *CircleShape) ComputeAABB(aabb *collision.AABB, xf Vec.TransformValue) {
	var p Vec.Vector
	Vec.TransformInto(&p, xf, s.Position())
	aabb.LowerBound = Vec.Vector{X: p.X - s.Radius, Y: p.Y - s.Radius}
	aabb.UpperBound = Vec.Vector{X: p.X + s.Radius, Y: p.Y + s.Radius}
}
