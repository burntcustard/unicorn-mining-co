// Port of src/shared/collision/contact-manifold.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package collision

import (
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
)

type Manifold struct {
	Type                    string
	LocalNormal, LocalPoint Vec.Vector
	Points                  [2]Vec.Vector
	PointCount              int
}
type WorldManifold struct {
	Normal      Vec.Vector
	Points      [2]Vec.Vector
	Separations [2]float64
	PointCount  int
}

func (m *Manifold) Recycle()      { *m = Manifold{} }
func (m *WorldManifold) Recycle() { *m = WorldManifold{} }
func (m *Manifold) GetWorldManifold(wm *WorldManifold, xfA Vec.TransformValue, radiusA float64, xfB Vec.TransformValue, radiusB float64) *WorldManifold {
	if m.PointCount == 0 {
		return wm
	}
	if wm == nil {
		wm = &WorldManifold{}
	}
	wm.PointCount = m.PointCount
	var pointA, pointB, cA, cB, planePoint, clipPoint Vec.Vector
	switch m.Type {
	case "circles":
		wm.Normal = Vec.Vector{X: 1}
		Vec.TransformInto(&pointA, xfA, m.LocalPoint)
		Vec.TransformInto(&pointB, xfB, m.Points[0])
		dist := Vec.Subtract(pointB, pointA)
		lengthSqr := Vec.LengthSquared(dist)
		if lengthSqr > 1e-18 {
			wm.Normal = Vec.Scale(dist, 1/math.Sqrt(lengthSqr))
		}
		cA = Vec.AddScaled(pointA, wm.Normal, radiusA)
		cB = Vec.AddScaled(pointB, wm.Normal, -radiusB)
		Vec.Combine2Into(&wm.Points[0], 0.5, cA, 0.5, cB)
		wm.Separations[0] = Vec.Dot(Vec.Subtract(cB, cA), wm.Normal)
	case "faceA":
		Vec.RotateInto(&wm.Normal, xfA.Q, m.LocalNormal)
		Vec.TransformInto(&planePoint, xfA, m.LocalPoint)
		for i := 0; i < m.PointCount; i++ {
			Vec.TransformInto(&clipPoint, xfB, m.Points[i])
			cA = Vec.AddScaled(clipPoint, wm.Normal, radiusA-Vec.Dot(Vec.Subtract(clipPoint, planePoint), wm.Normal))
			cB = Vec.AddScaled(clipPoint, wm.Normal, -radiusB)
			Vec.Combine2Into(&wm.Points[i], 0.5, cA, 0.5, cB)
			wm.Separations[i] = Vec.Dot(Vec.Subtract(cB, cA), wm.Normal)
		}
	case "faceB":
		Vec.RotateInto(&wm.Normal, xfB.Q, m.LocalNormal)
		Vec.TransformInto(&planePoint, xfB, m.LocalPoint)
		for i := 0; i < m.PointCount; i++ {
			Vec.TransformInto(&clipPoint, xfA, m.Points[i])
			cB = Vec.AddScaled(clipPoint, wm.Normal, radiusB-Vec.Dot(Vec.Subtract(clipPoint, planePoint), wm.Normal))
			cA = Vec.AddScaled(clipPoint, wm.Normal, -radiusA)
			Vec.Combine2Into(&wm.Points[i], 0.5, cA, 0.5, cB)
			wm.Separations[i] = Vec.Dot(Vec.Subtract(cA, cB), wm.Normal)
		}
		wm.Normal = Vec.Scale(wm.Normal, -1)
	}
	return wm
}
func ClipSegmentToLine(out *[2]Vec.Vector, in [2]Vec.Vector, normal Vec.Vector, offset float64) int {
	n := 0
	d0, d1 := Vec.Dot(normal, in[0])-offset, Vec.Dot(normal, in[1])-offset
	if d0 <= 0 {
		out[n] = in[0]
		n++
	}
	if d1 <= 0 {
		out[n] = in[1]
		n++
	}
	if d0*d1 < 0 {
		interp := d0 / (d0 - d1)
		Vec.Combine2Into(&out[n], 1-interp, in[0], interp, in[1])
		n++
	}
	return n
}
