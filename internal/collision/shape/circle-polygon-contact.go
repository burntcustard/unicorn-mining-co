// Port of src/shared/collision/shape/circle-polygon-contact.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package shape

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
)

func CollidePolygonCircle(m *collision.Manifold, a *PolygonShape, xfA Vec.TransformValue, b *CircleShape, xfB Vec.TransformValue) {
	m.PointCount = 0
	var cLocal, faceCenter Vec.Vector
	Vec.ChangeTransformInto(&cLocal, xfB, xfA, b.Position())
	normalIndex, separation := 0, math.Inf(-1)
	radius := a.Radius + b.Radius
	for i := 0; i < a.Count; i++ {
		s := Vec.Dot(a.Normals[i], cLocal) - Vec.Dot(a.Normals[i], a.Vertices[i])
		if s > radius {
			return
		}
		if s > separation {
			separation, normalIndex = s, i
		}
	}
	v1, v2 := a.Vertices[normalIndex], a.Vertices[(normalIndex+1)%a.Count]
	if separation <= 0 {
		m.PointCount = 1
		m.Type = "faceA"
		m.LocalNormal = a.Normals[normalIndex]
		Vec.Combine2Into(&m.LocalPoint, 0.5, v1, 0.5, v2)
		m.Points[0] = b.Position()
		return
	}
	u1 := Vec.Dot(cLocal, v2) - Vec.Dot(cLocal, v1) - Vec.Dot(v1, v2) + Vec.Dot(v1, v1)
	u2 := Vec.Dot(cLocal, v1) - Vec.Dot(cLocal, v2) - Vec.Dot(v2, v1) + Vec.Dot(v2, v2)
	if u1 <= 0 {
		if Vec.DistanceSquared(cLocal, v1) > radius*radius {
			return
		}
		m.LocalNormal = Vec.Normalize(Vec.Subtract(cLocal, v1))
		m.LocalPoint = v1
	} else if u2 <= 0 {
		if Vec.DistanceSquared(cLocal, v2) > radius*radius {
			return
		}
		m.LocalNormal = Vec.Normalize(Vec.Subtract(cLocal, v2))
		m.LocalPoint = v2
	} else {
		Vec.Combine2Into(&faceCenter, 0.5, v1, 0.5, v2)
		separation := Vec.Dot(cLocal, a.Normals[normalIndex]) - Vec.Dot(faceCenter, a.Normals[normalIndex])
		if separation > radius {
			return
		}
		m.LocalNormal = a.Normals[normalIndex]
		m.LocalPoint = faceCenter
	}
	m.PointCount = 1
	m.Type = "faceA"
	m.Points[0] = b.Position()
}
