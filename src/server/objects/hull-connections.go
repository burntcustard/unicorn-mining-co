package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"slices"
)

func (c *Craft) connectedHullGroups(hulls []*simulation.Segment) [][]int {
	groups := simulation.OuterEdges(outlinesOf(hulls))

	explicit := slices.ContainsFunc(c.HullSegments, func(plan *simulation.SegmentPlan) bool { return plan.Connections != nil })

	if !explicit {
		return groups
	}

	neighbors := make([]map[int]bool, len(hulls))

	for index := range hulls {
		neighbors[index] = map[int]bool{}
	}

	for _, group := range groups {
		for _, index := range group {
			for _, other := range group {
				neighbors[index][other] = true
			}
		}
	}

	for index, segment := range hulls {
		for _, connection := range segment.Connections {
			other := slices.IndexFunc(hulls, func(hull *simulation.Segment) bool { return hull.HullPlan == c.HullSegments[connection] })

			if other >= 0 {
				neighbors[index][other], neighbors[other][index] = true, true
			}
		}
	}

	left := make([]bool, len(hulls))

	for index := range left {
		left[index] = true
	}

	connected := [][]int{}

	for index := len(hulls) - 1; index >= 0; index-- {
		if !left[index] {
			continue
		}

		left[index] = false
		group := []int{index}

		for at := 0; at < len(group); at++ {
			for other := len(hulls) - 1; other >= 0; other-- {
				if left[other] && neighbors[group[at]][other] {
					left[other] = false
					group = append(group, other)
				}
			}
		}

		connected = append(connected, group)
	}

	return connected
}
