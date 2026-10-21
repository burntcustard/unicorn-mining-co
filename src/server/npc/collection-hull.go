package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

/*
collectionRadius encloses local geometry and its collision skin. Native polygon
clipping can extend corners along both axes, so pad skins by sqrt(2).
*/
func collectionRadius(collider shape.Shape) float64 {
	geometry := collider.Base()
	radiusSquared := 0.0

	for _, vertex := range geometry.Vertices[:geometry.Count] {
		radiusSquared = max(radiusSquared, Vec.LengthSquared(vertex))
	}

	return math.Sqrt(radiusSquared) + math.Sqrt2*max(0, geometry.Radius)
}
