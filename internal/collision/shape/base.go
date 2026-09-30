// Port of src/shared/collision/shape/base.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package shape

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
)

type Shape interface {
	Base() *BaseShape
	ComputeAABB(*collision.AABB, Vec.TransformValue)
}
type Bound struct{ X, Y, Radius float64 }
type BaseShape struct {
	Type     string
	Radius   float64
	Count    int
	Vertices []Vec.Vector
	bound    *Bound
}

func (s *BaseShape) Base() *BaseShape { return s }
func (s *BaseShape) GetBound() *Bound {
	if s.bound == nil {
		x, y := 0.0, 0.0
		for i := 0; i < s.Count; i++ {
			x += s.Vertices[i].X
			y += s.Vertices[i].Y
		}
		x /= float64(s.Count)
		y /= float64(s.Count)
		radius := 0.0
		for i := 0; i < s.Count; i++ {
			radius = math.Max(radius, math.Hypot(s.Vertices[i].X-x, s.Vertices[i].Y-y))
		}
		s.bound = &Bound{x, y, radius}
	}
	return s.bound
}
func (s *BaseShape) GetVertex(index int) Vec.Vector { return s.Vertices[index] }
func (s *BaseShape) GetSupport(d Vec.Vector) int {
	bestIndex, bestValue := -1, math.Inf(-1)
	for i := 0; i < s.Count; i++ {
		value := Vec.Dot(s.Vertices[i], d)
		if value > bestValue {
			bestIndex, bestValue = i, value
		}
	}
	return bestIndex
}

func (s *BaseShape) ShapeRadius() float64 { return s.Radius }
func (s *BaseShape) VertexCount() int     { return s.Count }
