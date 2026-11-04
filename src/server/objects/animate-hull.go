package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

// The joint phase is simulation time, shared with the browser's animated hulls.
func (c *Craft) animateHull() {
	if !c.hullAnimation || c.World == nil {
		return
	}

	if c.hullPoseReady && c.hullPoseTick == c.World.Tick {
		return
	}

	c.hullPoseReady, c.hullPoseTick = true, c.World.Tick

	type pose struct {
		position Vec.Vector
		rotation float64
	}

	poses := map[*simulation.SegmentPlan]pose{}
	time := float64(c.World.Tick) * c.Catalog.Simulation.SimulationStep
	var poseOf func(*simulation.SegmentPlan) pose

	poseOf = func(plan *simulation.SegmentPlan) pose {
		if value, ok := poses[plan]; ok {
			return value
		}

		parent := pose{}
		animation := plan.Animation
		pivot := Vec.Vector{}
		angle := 0.0

		if animation != nil {
			if animation.Parent != nil {
				parent = poseOf(c.HullSegments[*animation.Parent])
			}

			pivot = Vec.Create(animation.Pivot[0], animation.Pivot[1])
			angle = math.Sin(time*math.Pi*2/1.8+animation.Phase) * animation.Amplitude
		}

		rotation := parent.rotation + angle
		value := pose{Vec.Subtract(Vec.Add(parent.position, simulation.RotatePoint(pivot, parent.rotation)), simulation.RotatePoint(pivot, rotation)), rotation}
		poses[plan] = value
		return value
	}

	for _, segment := range c.Segments {
		plan := segment.HullPlan

		if !segment.Hull || plan == nil || plan.Animation == nil {
			continue
		}

		pose := poseOf(plan)

		transform := func(point simulation.Point) simulation.Point {
			at := Vec.Add(pose.position, simulation.RotatePoint(Vec.Create(point[0], point[1]), pose.rotation))
			return simulation.Point{at.X, at.Y}
		}

		outline := &simulation.ShapeOutline{Points: make([]simulation.Point, len(plan.Points.Points))}

		for index, point := range plan.Points.Points {
			outline.Points[index] = transform(point)
		}

		segment.Points = outline
		middle, radius := simulation.ShapeOutlineExtent(outline.Points)
		segment.Middle = &middle

		segment.Radius = func(*simulation.Segment) float64 { return radius }

		if plan.CollisionParts != nil {
			segment.CollisionParts = make([][][]float64, len(plan.CollisionParts))

			for index, part := range plan.CollisionParts {
				for _, point := range part {
					at := transform(simulation.Point{point[0], point[1]})
					segment.CollisionParts[index] = append(segment.CollisionParts[index], []float64{at[0], at[1]})
				}
			}
		}
	}

	c.updateHullRibbons()
}
