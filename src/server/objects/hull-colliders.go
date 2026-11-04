package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

func hullColliders(collider *collision.Collider, segment *simulation.Segment) []*collision.Collider {
	if segment.CollisionParts == nil {
		return []*collision.Collider{collider}
	}

	if len(segment.PartColliders) != len(segment.CollisionParts) {
		segment.PartColliders = make([]*collision.Collider, len(segment.CollisionParts))
	}

	for index, points := range segment.CollisionParts {
		part := segment.PartColliders[index]

		if part == nil {
			part = &collision.Collider{}
			segment.PartColliders[index] = part
		}

		outline := part.ShapeOutline
		*part = *collider

		if len(outline) != len(points) {
			outline = make([][]float64, len(points))
		}

		for at, point := range points {
			if len(outline[at]) != 2 {
				outline[at] = make([]float64, 2)
			}

			outline[at][0], outline[at][1] = point[0]-segment.Middle[0], point[1]-segment.Middle[1]
		}

		part.ShapeOutline = outline
	}

	return segment.PartColliders
}
