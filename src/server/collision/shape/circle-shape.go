// Port of src/client/collision/shape/circle-shape.ts.
// Copyright (c) Erin Catto, Ali Shakiba (Planck.js), MIT. See LICENSE.
package shape

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type CircleShape struct{ collision.BaseShape }

func NewCircle(position Vec.Vector, radius float64) *CircleShape {
	return &CircleShape{collision.BaseShape{Type: "circle", Count: 1, Vertices: []Vec.Vector{position}, Radius: radius}}
}
func (s *CircleShape) Position() Vec.Vector     { return s.Vertices[0] }
func (s *CircleShape) SetPosition(p Vec.Vector) { s.Vertices[0] = p; s.ClearBound() }
