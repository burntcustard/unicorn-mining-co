package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

func (c *Craft) updateHullRibbons() {
	ribbons := []*simulation.Segment{}

	for _, segment := range c.Segments {
		if segment.Hull && segment.Ribbon {
			ribbons = append(ribbons, segment)
		}
	}

	parentOf := func(segment *simulation.Segment) *simulation.SegmentPlan {
		return c.HullSegments[*segment.Animation.Parent]
	}

	center := func(a, b simulation.Point) Vec.Vector { return Vec.Create((a[0]+b[0])/2, (a[1]+b[1])/2) }

	width := func(a, b simulation.Point) float64 { return math.Hypot(a[0]-b[0], a[1]-b[1]) / 2 }

	for _, root := range ribbons {
		hasParent := false

		for _, other := range ribbons {
			hasParent = hasParent || other.HullPlan == parentOf(root)
		}

		if hasParent {
			continue
		}

		chain := []*simulation.Segment{root}

		for {
			var child *simulation.Segment

			for _, other := range ribbons {
				if parentOf(other) == chain[len(chain)-1].HullPlan {
					child = other
					break
				}
			}

			if child == nil {
				break
			}

			chain = append(chain, child)
		}

		first := root.Points.Points
		points := []Vec.Vector{center(first[0], first[3])}
		widths := []float64{width(first[0], first[3])}

		for _, segment := range chain {
			part := segment.Points.Points
			points = append(points, center(part[1], part[2]))
			widths = append(widths, width(part[1], part[2]))
		}

		for index, outline := range simulation.RibbonSections(points, widths) {
			chain[index].VisualOutline = outline
		}
	}
}
