// Port of src/client/collision/shape/base.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package collision

import (
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

type Bound struct{ X, Y, Radius, OffsetRadius float64 }
type BaseShape struct {
	Type     string
	Radius   float64
	Count    int
	Vertices []Vec.Vector
	bound    *Bound
}

func (s *BaseShape) Base() *BaseShape { return s }
func (s *BaseShape) ClearBound()      { s.bound = nil }
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
			radius = max(radius, math.Hypot(s.Vertices[i].X-x, s.Vertices[i].Y-y))
		}
		s.bound = &Bound{x, y, radius, math.Sqrt(x*x + y*y)}
	}
	return s.bound
}
func (s *BaseShape) GetVertex(index int) Vec.Vector { return s.Vertices[index] }
func (s *BaseShape) GetSupport(d Vec.Vector) int {
	bestIndex, bestValue := -1, math.Inf(-1)
	if s.Count <= 0 {
		return bestIndex
	}
	for i, vertex := range s.Vertices[:s.Count] {
		value := Vec.Dot(vertex, d)
		if value > bestValue {
			bestIndex, bestValue = i, value
		}
	}
	return bestIndex
}

func (s *BaseShape) ComputeAABB(aabb *AABB, xf Vec.TransformValue) {
	if s.Type == "circle" {
		var point Vec.Vector
		Vec.TransformInto(&point, xf, s.Vertices[0])
		aabb.LowerBound = Vec.Vector{X: point.X - s.Radius, Y: point.Y - s.Radius}
		aabb.UpperBound = Vec.Vector{X: point.X + s.Radius, Y: point.Y + s.Radius}
		return
	}
	minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for i := 0; i < s.Count; i++ {
		v := s.Vertices[i]
		x := xf.Q.C*v.X - xf.Q.S*v.Y + xf.P.X
		y := xf.Q.S*v.X + xf.Q.C*v.Y + xf.P.Y
		minX = min(minX, x)
		maxX = max(maxX, x)
		minY = min(minY, y)
		maxY = max(maxY, y)
	}
	aabb.LowerBound = Vec.Vector{X: minX - s.Radius, Y: minY - s.Radius}
	aabb.UpperBound = Vec.Vector{X: maxX + s.Radius, Y: maxY + s.Radius}
}
