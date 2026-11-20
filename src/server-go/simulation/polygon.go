// Port of src/client/utilities/polygon.ts. Edges are mechanical fracture state.
package simulation

import (
	"math"
	"slices"
)

type Point [2]float64

type ShapeOutline struct {
	Points []Point
	Edges  []bool
}

type PolygonOptions struct {
	PointCount int
	Radius     float64
	RadiusEven *float64
	Variance   float64
	Random     func() float64
}

func CreatePolygon(options PolygonOptions) *ShapeOutline {
	even := options.Radius

	if options.RadiusEven != nil {
		even = *options.RadiusEven
	}

	random := options.Random

	if random == nil {
		random = func() float64 { return 0 }
	}

	outline := &ShapeOutline{Points: make([]Point, options.PointCount)}

	for i := range outline.Points {
		angle := float64(i) / float64(options.PointCount) * math.Pi * 2
		wander := 1 - random()*options.Variance
		reach := even

		if i%2 != 0 {
			reach = options.Radius
		}

		reach *= wander
		sin, cos := math.Sincos(angle)
		outline.Points[i] = Point{cos * reach, sin * reach}
	}

	return outline
}

func RadiusOf(points []Point, center Point) float64 {
	radius := math.Inf(-1)

	for _, p := range points {
		radius = max(radius, math.Hypot(p[0]-center[0], p[1]-center[1]))
	}

	return radius
}

func OuterEdges(outlines []*ShapeOutline) [][]int {
	vertices := map[Point]uint64{}
	nextID := uint64(0)

	vertex := func(p Point) uint64 {
		if id, ok := vertices[p]; ok {
			return id
		}

		id := nextID
		nextID++
		vertices[p] = id
		return id
	}

	sides := make([][]uint64, len(outlines))
	outlinesBySide := map[uint64][]int{}

	for index, outline := range outlines {
		sides[index] = make([]uint64, len(outline.Points))

		for i, from := range outline.Points {
			a, b := vertex(from), vertex(outline.Points[(i+1)%len(outline.Points)])

			if a > b {
				a, b = b, a
			}

			side := a*0x100000000 + b
			sides[index][i] = side
			outlinesBySide[side] = append(outlinesBySide[side], index)
		}
	}

	neighbours := make([]map[int]bool, len(outlines))
	left := make([]int, len(outlines))
	groups := [][]int{}

	for index, outline := range outlines {
		left[index] = index
		neighbours[index] = map[int]bool{}
		outline.Edges = make([]bool, len(outline.Points))

		for i, side := range sides[index] {
			outline.Edges[i] = len(outlinesBySide[side]) == 1

			for _, other := range outlinesBySide[side] {
				if other != index {
					neighbours[index][other] = true
				}
			}
		}
	}

	for len(left) > 0 {
		last := len(left) - 1
		group := []int{left[last]}
		left = left[:last]

		for at := 0; at < len(group); at++ {
			for index, other := range slices.Backward(left) {
				if neighbours[group[at]][other] {
					group = append(group, other)
					left = append(left[:index], left[index+1:]...)
				}
			}
		}

		groups = append(groups, group)
	}

	return groups
}
