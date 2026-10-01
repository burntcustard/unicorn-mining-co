// Port of src/shared/collision/shape/polygon-polygon-contact.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package shape

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
)

func findMaxSeparation(poly1 *PolygonShape, xf1 Vec.TransformValue, poly2 *PolygonShape, xf2 Vec.TransformValue, limit float64) (int, float64) {
	var xf Vec.TransformValue
	var n, v1 Vec.Vector
	Vec.DetransformTransform(&xf, xf2, xf1)
	bestIndex, maxSeparation := 0, math.Inf(-1)
	vertices1, vertices2 := poly1.Vertices[:poly1.Count], poly2.Vertices[:poly2.Count]
	for i, normal := range poly1.Normals[:poly1.Count] {
		Vec.RotateInto(&n, xf.Q, normal)
		Vec.TransformInto(&v1, xf, vertices1[i])
		offset := Vec.Dot(n, v1)
		si := math.Inf(1)
		for _, vertex := range vertices2 {
			sij := Vec.Dot(n, vertex) - offset
			if sij < si {
				si = sij
			}
		}
		if si > limit {
			return i, si
		}
		if si > maxSeparation {
			maxSeparation, bestIndex = si, i
		}
	}
	return bestIndex, maxSeparation
}
func findIncidentEdge(clipVertex *[2]Vec.Vector, poly1 *PolygonShape, xf1 Vec.TransformValue, edge1 int, poly2 *PolygonShape, xf2 Vec.TransformValue) {
	var normal1 Vec.Vector
	Vec.RerotateInto(&normal1, xf2.Q, xf1.Q, poly1.Normals[edge1])
	index, minDot := 0, math.Inf(1)
	for i, normal := range poly2.Normals[:poly2.Count] {
		dot := Vec.Dot(normal1, normal)
		if dot < minDot {
			minDot, index = dot, i
		}
	}
	Vec.TransformInto(&clipVertex[0], xf2, poly2.Vertices[index])
	Vec.TransformInto(&clipVertex[1], xf2, poly2.Vertices[(index+1)%poly2.Count])
}
func CollidePolygons(m *collision.Manifold, a *PolygonShape, xfA Vec.TransformValue, b *PolygonShape, xfB Vec.TransformValue, linearSlop float64) {
	m.PointCount = 0
	totalRadius := a.Radius + b.Radius
	edgeA, separationA := findMaxSeparation(a, xfA, b, xfB, totalRadius)
	if separationA > totalRadius {
		return
	}
	edgeB, separationB := findMaxSeparation(b, xfB, a, xfA, totalRadius)
	if separationB > totalRadius {
		return
	}
	poly1, poly2, xf1, xf2, edge1 := a, b, xfA, xfB, edgeA
	m.Type = "faceA"
	if separationB > separationA+0.1*linearSlop {
		poly1, poly2, xf1, xf2, edge1 = b, a, xfB, xfA, edgeB
		m.Type = "faceB"
	}
	var incidentEdge, clipPoints1, clipPoints2 [2]Vec.Vector
	findIncidentEdge(&incidentEdge, poly1, xf1, edge1, poly2, xf2)
	v11, v12 := poly1.Vertices[edge1], poly1.Vertices[(edge1+1)%poly1.Count]
	localTangent := Vec.Normalize(Vec.Subtract(v12, v11))
	var localNormal, planePoint, tangent, normal Vec.Vector
	Vec.CrossScalarInto(&localNormal, localTangent, 1)
	Vec.Combine2Into(&planePoint, 0.5, v11, 0.5, v12)
	Vec.RotateInto(&tangent, xf1.Q, localTangent)
	Vec.CrossScalarInto(&normal, tangent, 1)
	Vec.TransformInto(&v11, xf1, v11)
	Vec.TransformInto(&v12, xf1, v12)
	frontOffset := Vec.Dot(normal, v11)
	sideOffset1 := -Vec.Dot(tangent, v11) + totalRadius
	sideOffset2 := Vec.Dot(tangent, v12) + totalRadius
	if collision.ClipSegmentToLine(&clipPoints1, incidentEdge, Vec.Vector{X: -tangent.X, Y: -tangent.Y}, sideOffset1) < 2 {
		return
	}
	if collision.ClipSegmentToLine(&clipPoints2, clipPoints1, tangent, sideOffset2) < 2 {
		return
	}
	m.LocalNormal = localNormal
	m.LocalPoint = planePoint
	pointCount := 0
	for _, cp := range clipPoints2 {
		separation := Vec.Dot(normal, cp) - frontOffset
		if separation <= totalRadius {
			Vec.InverseTransformInto(&m.Points[pointCount], xf2, cp)
			pointCount++
		}
	}
	m.PointCount = pointCount
}
