package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

// CollectionHatch opens the doors near a pickup, allowing time to unfold at speed.
func CollectionHatch(ship *objects.Ship, position Vec.Vector) bool {
	reach := ship.Radius + math.Max(300, Vec.Length(ship.Velocity)*1.5)
	return Vec.DistanceSquared(ship.Position, position) <= reach*reach
}

type collectionApproach struct {
	itemID        int64
	checkedAt     uint64
	distance      float64
	reposition    Vec.Vector
	repositioning bool
}

/*
Back away and approach from another angle when cargo stops entering the scoop.
Items still have to turn and pass through the ship's physical gap themselves.
*/
func (c *collectionApproach) movement(ship *objects.Ship, destination Movement, obstacles []obstacle) Movement {
	if !destination.Collect {
		*c = collectionApproach{}
		return destination
	}

	distance := Vec.Distance(ship.Position, destination.Position)

	if c.itemID != destination.IgnoreID {
		*c = collectionApproach{itemID: destination.IgnoreID, checkedAt: ship.World.Tick, distance: distance}
	}

	// A centered throat needs the full alignment. Opposing side throats can
	// collect during the broad turn once the ship has backed away.
	recoveryDistance := 20.0

	if c.repositioning {
		var centers [4]Vec.Vector
		left, right := false, false

		for _, center := range collectionCenters(ship, centers[:0]) {
			left, right = left || center.Y < 0, right || center.Y > 0
		}

		if left && right {
			recoveryDistance = 2 * navigationRadius(ship)
		}
	}

	if c.repositioning && Vec.Distance(ship.Position, c.reposition) <= recoveryDistance {
		c.repositioning = false
		c.checkedAt, c.distance = ship.World.Tick, distance
	}

	if !c.repositioning {
		if distance < c.distance-2 || (distance > 2*navigationRadius(ship) && Vec.LengthSquared(ship.Velocity) >= ship.Rules.Motion.MinimumSpeedSquared || distance > 4*navigationRadius(ship)) {
			c.checkedAt, c.distance = ship.World.Tick, distance
		}

		if float64(ship.World.Tick-c.checkedAt)*ship.Catalog.Simulation.SimulationStep >= 2 {
			c.reposition = simulation.RotatePoint(Vec.Create(-100, 80), ship.Rotation)

			if item, ok := ship.World.Entities.Get(destination.IgnoreID); ok {
				// A lengthwise approach lets broadside ore fit through the channel.
				c.reposition = simulation.RotatePoint(Vec.Create(120, 0), item.Base().Rotation)

				if Vec.Dot(c.reposition, Vec.Subtract(ship.Position, destination.Position)) < 0 {
					c.reposition = Vec.Scale(c.reposition, -1)
				}
			}

			// Keep the escape point fixed. Following a waypoint attached to a
			// wedged, moving item keeps pushing the ship and item together.
			offset := c.reposition
			c.checkedAt = ship.World.Tick

			for _, angle := range []float64{0, math.Pi, math.Pi / 2, -math.Pi / 2, math.Pi / 4, -math.Pi / 4, math.Pi * 3 / 4, -math.Pi * 3 / 4} {
				point := Vec.Add(destination.Position, simulation.RotatePoint(offset, angle))

				if Vec.Distance(ship.Position, point) < 60 || !clearSegment(point, point, navigationRadius(ship), obstacles, false) {
					continue
				}

				c.reposition, c.repositioning = point, true
				break
			}
		}
	}

	if c.repositioning {
		destination.Position = c.reposition
		destination.Collect = false
		destination.Velocity = Vec.Vector{}
		destination.FollowDistance = 1
	}

	return destination
}

/*
collectionCenters locates working pickup throats in ship-local coordinates.
Use its current outline because animated geometry can differ from cached centers.
*/
func collectionCenters(ship *objects.Ship, centers []Vec.Vector) []Vec.Vector {
	for _, segment := range ship.Segments {
		if !segment.Catches || segment.Module == nil || *segment.TargetHealth() < 1 {
			continue
		}

		center := segment.LocalPosition

		if outline := segment.Outline(); outline != nil && len(outline.Points) > 0 {
			middle, _ := simulation.ShapeOutlineExtent(outline.Points)
			center = Vec.Add(center, Vec.Create(middle[0], middle[1]))
		}

		centers = append(centers, center)
	}

	return centers
}

type collectionHull struct {
	transform Vec.TransformValue
	shape     shape.Shape
	radius    float64
}

const collectionPredictionSteps = 40

/*
collectControls chooses an ordinary engine input that carries the item through
the pickup throat. Passive arrival aims for an eventual stop, which can strand
cargo at the doors. Forecasting the actual hatch and physical hull also avoids
approaches that look close at the ship's center but knock the item away.
*/
func (p *Pilot) collectControls(ship *objects.Ship, destination Movement, obstacles []obstacle, centers []Vec.Vector) (float64, float64) {
	// Aim beyond the throat center so slowing cannot leave cargo at its entrance.
	for index := range centers {
		centers[index].X -= 5
	}

	offset := Vec.Subtract(destination.Position, ship.Position)
	bearing := math.Atan2(offset.Y, offset.X)
	radius := navigationRadius(ship)
	// Collection needs to see a complete turn and pickup. Obstacle avoidance
	// resets this shared storage to its usual, shorter prediction horizon.
	forecast := p.forecast.reset(ship, predictionOptions{radius: radius, steps: collectionPredictionSteps})
	slop := ship.Catalog.Simulation.LinearSlop
	var hullStorage [16]collectionHull
	hull := hullStorage[:0]

	for _, collider := range ship.Hitbox() {
		if collider.Physics != nil && !*collider.Physics || collider.Collides != nil && !*collider.Collides {
			continue
		}

		position := *collider.LocalPosition
		colliderShape := query.ShapeOf(query.ShapeData{Outline: collider.ShapeOutline, Radius: collider.GetRadius(), CollisionMargin: collider.CollisionMargin}, slop)

		hull = append(hull, collectionHull{
			transform: Vec.Transform(position.X, position.Y, collider.GetRotation()-ship.Rotation),
			shape:     colliderShape,
			radius:    collectionRadius(colliderShape),
		})
	}

	entity, exists := ship.World.Entities.Get(destination.IgnoreID)
	var itemShape shape.Shape
	var itemRotation, itemSpin float64
	contactReach := 60.0
	itemRadius := 0.0

	if exists {
		item := entity.Base()
		contactReach = max(contactReach, radius+item.Radius)
		itemRotation, itemSpin = item.Rotation, item.Spin

		if item.ShapeOutline == nil {
			itemShape = shape.NewCircle(Vec.Vector{}, item.Radius)
		} else {
			vertices := make([]Vec.Vector, len(item.ShapeOutline.Points))

			for index, point := range item.ShapeOutline.Points {
				vertices[index] = Vec.Create(point[0], point[1])
			}

			itemShape = shape.NewPolygon(vertices, new(0.0), slop)
		}

		itemRadius = collectionRadius(itemShape)
	}

	var items [collectionPredictionSteps]Vec.TransformValue

	for step := range forecast.directions {
		elapsed := float64(step+1) * predictionStep
		position := Vec.AddScaled(destination.Position, destination.Velocity, elapsed)
		items[step] = Vec.Transform(position.X, position.Y, itemRotation+itemSpin*elapsed)
	}

	best := math.Inf(1)
	bestHeading, bestThrust, bestTurn := bearing, 0.0, 0.0

	for _, offset := range []float64{0, -.05, .05, -.1, .1, -.2, .2, -.35, .35, -.5, .5, -.75, .75, -1, 1, -1.5, 1.5, -2, 2, math.Pi} {
		heading := bearing + offset
		turn := turnInput(ship, math.Remainder(heading-ship.Rotation, 2*math.Pi))

		for _, thrust := range []float64{0, .25, .5, .75, 1} {
			thrust = restartThrust(ship, thrust)
			forecast.project(heading, thrust, turn)
			var costs [collectionPredictionSteps]float64
			minimum := math.Inf(1)

			// Geometry bounds the score before physical contacts add penalties.
			for step := range forecast.directions {
				elapsed := float64(step+1) * predictionStep
				direction := forecast.directions[step]
				local := Vec.Subtract(items[step].P, forecast.path[step+1])
				local = Vec.Create(Vec.Dot(local, direction), Vec.Cross(direction, local))
				closest := math.Inf(1)

				for _, center := range centers {
					error := Vec.Subtract(local, center)
					x, y := max(0, math.Abs(error.X)-2), max(0, math.Abs(error.Y)-4)
					closest = min(closest, x*x+y*y)
				}

				costs[step] = math.Sqrt(closest) + 4*elapsed
				minimum = min(minimum, costs[step])
			}

			penalty := 0.0

			for step := range forecast.directions {
				elapsed := float64(step+1) * predictionStep

				// Neither elapsed time nor accumulated contact penalties can decrease.
				if max(minimum, 4*elapsed)+penalty >= best {
					break
				}

				direction := forecast.directions[step]
				shipPose := Vec.TransformValue{P: forecast.path[step+1], Q: Vec.RotValue{Sin: direction.Y, Cos: direction.X}}
				var itemTransform Vec.TransformValue
				// Keep every hull fixed and transform only the item into the ship frame.
				Vec.DetransformTransform(&itemTransform, shipPose, items[step])

				if exists && Vec.LengthSquared(itemTransform.P) < contactReach*contactReach {
					for _, collider := range hull {
						reach := collider.radius + itemRadius + slop

						if Vec.DistanceSquared(collider.transform.P, itemTransform.P) > reach*reach {
							continue
						}

						contact, touching := query.ContactShapes(collider.shape, itemShape, collider.transform, itemTransform, slop)

						if touching {
							penalty += 2 * max(.1, contact.Depth)
						}
					}
				}

				if score := costs[step] + penalty; score < best {
					best, bestHeading, bestThrust, bestTurn = score, heading, thrust, turn
				}
			}
		}
	}

	return p.avoidPickup(ship, simulation.DirectionOf(bestHeading), bestThrust, bestTurn, obstacles)
}

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
