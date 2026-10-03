// Port of src/client/collision/contact-between.ts.
// This leaf package avoids a Go import cycle between collision and shape.
package query

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type ShapeData struct {
	Position        Vec.Vector  `json:"position"`
	Rotation        float64     `json:"rotation"`
	Radius          float64     `json:"radius"`
	Outline         [][]float64 `json:"shapeOutline,omitempty"`
	CollisionMargin *float64    `json:"collisionMargin,omitempty"`
}
type Contact struct {
	Depth  float64    `json:"depth"`
	Normal Vec.Vector `json:"normal"`
	Point  Vec.Vector `json:"point"`
}

func shapeOf(collider ShapeData, linearSlop float64) shape.Shape {
	if collider.Outline != nil {
		vertices := make([]Vec.Vector, len(collider.Outline))
		for i, p := range collider.Outline {
			vertices[i] = Vec.Create(p[0], p[1])
		}
		return shape.NewPolygon(vertices, collider.CollisionMargin, linearSlop)
	}
	return shape.NewCircle(Vec.Vector{}, collider.Radius)
}
func ContactBetween(a, b ShapeData, linearSlop float64) (Contact, bool) {
	sa, sb := shapeOf(a, linearSlop), shapeOf(b, linearSlop)
	xa, xb := Vec.Transform(a.Position.X, a.Position.Y, a.Rotation), Vec.Transform(b.Position.X, b.Position.Y, b.Rotation)
	var manifold collision.Manifold
	reversed := false
	switch sa := sa.(type) {
	case *shape.PolygonShape:
		switch sb := sb.(type) {
		case *shape.PolygonShape:
			shape.CollidePolygons(&manifold, sa, xa, sb, xb, linearSlop)
		case *shape.CircleShape:
			shape.CollidePolygonCircle(&manifold, sa, xa, sb, xb)
		}
	case *shape.CircleShape:
		switch sb := sb.(type) {
		case *shape.PolygonShape:
			shape.CollidePolygonCircle(&manifold, sb, xb, sa, xa)
			reversed = true
		case *shape.CircleShape:
			shape.CollideCircles(&manifold, sa, xa, sb, xb)
		}
	}
	if manifold.PointCount == 0 {
		return Contact{}, false
	}
	var contact *collision.WorldManifold
	direction := 1.0
	if reversed {
		contact = manifold.GetWorldManifold(nil, xb, sb.Base().Radius, xa, sa.Base().Radius)
		direction = -1
	} else {
		contact = manifold.GetWorldManifold(nil, xa, sa.Base().Radius, xb, sb.Base().Radius)
	}
	return Contact{Depth: -min(contact.Separations[0], contact.Separations[1]), Normal: Vec.Scale(contact.Normal, direction), Point: contact.Points[0]}, true
}
