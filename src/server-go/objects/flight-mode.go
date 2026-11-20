package objects

import (
	"math"
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server-go/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server-go/vector"
)

func (c *Craft) flightModeState() (progress, boost float64) {
	boost = 1

	for _, segment := range c.Segments {
		if segment.Module == nil || segment.Mount == nil || segment.Module.ModuleBase().Spec.Behavior != "flightMode" {
			continue
		}

		mount := segment.Mount

		if mount.Module != segment.Module || segment.Module.ModuleBase().Mount != mount || mount.Hull == nil || mount.Health < 1 || mount.Hull.Health < 1 {
			continue
		}

		value := math.Max(0, math.Min(1, segment.ActivationProgress))
		progress = math.Max(progress, value)
		boost = math.Max(boost, 1+value*(segment.Module.ModuleBase().Spec.FlightBoost-1))
	}

	return progress, boost
}

func (s *Ship) flightBoostFactor() float64 {
	_, boost := s.flightModeState()
	return boost
}

func (c *Craft) flightOffset(plan *simulation.SegmentPlan, depth int) (Vec.Vector, bool) {
	if plan.FlightOffset != nil {
		return Vec.Create(plan.FlightOffset[0], plan.FlightOffset[1]), true
	}

	if depth >= len(c.HullSegments) {
		return Vec.Vector{}, false
	}

	for _, index := range plan.Connections {
		if index < 0 || index >= len(c.HullSegments) {
			continue
		}

		if offset, ok := c.flightOffset(c.HullSegments[index], depth+1); ok {
			return offset, true
		}
	}

	return Vec.Vector{}, false
}

// Offset immutable hull geometry and its mounts together. Detached crafts have
// inert plans with their current placement, so they keep the pose they lost.
func (c *Craft) updateFlightMode() {
	if !slices.ContainsFunc(c.HullSegments, func(plan *simulation.SegmentPlan) bool { return plan.FlightOffset != nil }) {
		return
	}

	progress, _ := c.flightModeState()

	for _, segment := range c.Segments {
		if !segment.Hull || segment.HullPlan == nil {
			continue
		}

		offset, ok := c.flightOffset(segment.HullPlan, 0)

		if !ok {
			continue
		}

		segment.LocalPosition = Vec.AddScaled(segment.HullPlan.LocalPosition, offset, progress)

		for _, mount := range segment.Mounts {
			point := mount.MountPoints[0]

			if mount.Module != nil {
				for _, candidate := range mount.MountPoints {
					if slices.Contains(candidate.Fits, mount.Module.ModuleBase().Type) {
						point = candidate
						break
					}
				}
			}

			position := Vec.Add(segment.LocalPosition, Vec.Create(point.X, point.Y))
			delta := Vec.Subtract(position, mount.LocalPosition)

			if delta == (Vec.Vector{}) {
				continue
			}

			mount.LocalPosition = position

			for _, part := range c.Segments {
				if part.Mount == mount {
					part.LocalPosition = Vec.Add(part.LocalPosition, delta)
				}
			}
		}
	}
}
