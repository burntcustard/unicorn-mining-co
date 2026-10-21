package npc

import (
	"math"
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

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
func (p *Pilot) collectControls(ship *objects.Ship, destination Movement, obstacles []obstacle, center Vec.Vector) (float64, float64) {
	// Aim beyond the throat center so slowing cannot leave cargo at its entrance.
	center.X -= 5
	offset := Vec.Subtract(destination.Position, ship.Position)
	bearing := math.Atan2(offset.Y, offset.X)
	radius := navigationRadius(ship)
	forecast := p.forecast.reset(ship, radius, nil)
	// Collection needs to see a complete turn and pickup. Obstacle avoidance
	// resets this shared storage to its usual, shorter prediction horizon.
	forecast.steps = collectionPredictionSteps
	forecast.path = slices.Grow(forecast.path[:0], forecast.steps+1)[:forecast.steps+1]
	forecast.directions = slices.Grow(forecast.directions[:0], forecast.steps)[:forecast.steps]
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

	for step := range forecast.steps {
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
			forecast.project(heading, thrust, turn)
			var costs [collectionPredictionSteps]float64
			minimum := math.Inf(1)

			// Geometry bounds the score before physical contacts add penalties.
			for step := range forecast.steps {
				elapsed := float64(step+1) * predictionStep
				direction := forecast.directions[step]
				local := Vec.Subtract(items[step].P, forecast.path[step+1])
				error := Vec.Subtract(Vec.Create(Vec.Dot(local, direction), Vec.Cross(direction, local)), center)
				costs[step] = math.Hypot(max(0, math.Abs(error.X)-2), max(0, math.Abs(error.Y)-4)) + 4*elapsed
				minimum = min(minimum, costs[step])
			}

			penalty := 0.0

			for step := range forecast.steps {
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

	return p.avoid(ship, simulation.DirectionOf(bestHeading), bestThrust, bestTurn, obstacles)
}
