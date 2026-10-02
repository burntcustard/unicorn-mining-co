// Port of src/shared/collision/shape/circle-circle-contact.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package shape

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
)

func CollideCircles(manifold *collision.Manifold, a *CircleShape, xfA Vec.TransformValue, b *CircleShape, xfB Vec.TransformValue) {
	manifold.PointCount = 0
	var pA, pB Vec.Vector
	Vec.TransformInto(&pA, xfA, a.Position())
	Vec.TransformInto(&pB, xfB, b.Position())
	distSqr := Vec.DistanceSquared(pB, pA)
	radius := a.Radius + b.Radius
	if distSqr > radius*radius {
		return
	}
	manifold.Type = "circles"
	manifold.LocalPoint = a.Position()
	manifold.LocalNormal = Vec.Vector{}
	manifold.PointCount = 1
	manifold.Points[0] = b.Position()
}
