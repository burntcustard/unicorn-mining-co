package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
)

// CollectionHatch opens the doors near a pickup, allowing time to unfold at speed.
func CollectionHatch(ship *objects.Ship, position Vec.Vector) bool {
	reach := ship.Radius + math.Max(300, ship.MaxSpeed()*collectionApproachTime)
	return Vec.DistanceSquared(ship.Position, position) <= reach*reach
}

type collectionProgress struct {
	itemID    int64
	checkedAt uint64
	distance  float64
}

/*
Track stalled cargo so a short, unpowered turn can free it before retrying.
Reset while approaching and after each attempt to keep rocking intermittent.
*/
func (c *collectionProgress) update(ship *objects.Ship, destination Movement) {
	if !destination.Collect {
		*c = collectionProgress{}
		return
	}

	distance := Vec.Distance(ship.Position, destination.Position)

	if c.itemID != destination.IgnoreID {
		*c = collectionProgress{itemID: destination.IgnoreID, checkedAt: ship.World.Tick, distance: distance}
	}

	if distance < c.distance-2 || (distance > 2*navigationRadius(ship) && Vec.LengthSquared(ship.Velocity) >= ship.Rules.Motion.MinimumSpeedSquared || distance > 4*navigationRadius(ship)) || float64(ship.World.Tick-c.checkedAt)*ship.Catalog.Simulation.SimulationStep >= 2 {
		c.checkedAt, c.distance = ship.World.Tick, distance
	}
}

/*
Rock loose cargo between pickup attempts using only ordinary turning and no
engine impulse. Collision avoidance can suppress the turn without substituting
forward thrust near the wedged item.
*/
func (p *Pilot) collectionWiggle(ship *objects.Ship, obstacles []obstacle) (float64, bool) {
	c := &p.collection
	elapsed := float64(ship.World.Tick-c.checkedAt) * ship.Catalog.Simulation.SimulationStep

	if c.itemID == 0 || elapsed < .6 || elapsed >= 1.4 {
		return 0, false
	}

	entity, exists := ship.World.Entities.Get(c.itemID)

	if !exists || collectionRecoveryConstrained(ship, entity.Base().Position, obstacles) {
		return 0, false
	}

	spin := ship.TurnRate * ship.RotationalThrust() / ship.Rules.Flight.SpinDivisor
	turn := 0.0

	if spin > 0 {
		turn = min(1, 1.5/spin)

		if elapsed >= 1 {
			turn = -turn
		}
	}

	steps := max(1, int(math.Ceil(ship.Catalog.NPCMovement.DecisionInterval/predictionStep)))
	forecast := p.forecast.reset(ship, predictionOptions{radius: navigationRadius(ship), obstacles: obstacles, steps: steps})

	if !forecast.predict(ship.Rotation, 0, turn).safe {
		turn = 0
	}

	return turn, true
}

/*
Avoid rocking near other obstacles or powering a pickup before their fixtures
are ready for contact planning.
*/
func collectionRecoveryConstrained(ship *objects.Ship, position Vec.Vector, obstacles []obstacle) bool {
	reach := navigationRadius(ship) + 60

	for _, object := range obstacles {
		if !object.station && (object.distance(ship.Position) < reach || object.distance(position) < reach) {
			return true
		}
	}

	return false
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

const (
	collectionApproachTime   = 4
	collectionPredictionTime = 2.1
)

/*
collectControls compares short pickup forecasts at full thrust or coasting,
including the departure toward remaining cargo.
*/
func (p *Pilot) collectControls(ship *objects.Ship, destination Movement, obstacles []obstacle, centers []Vec.Vector) (float64, float64) {
	item, exists := ship.World.Entities.Get(destination.IgnoreID)

	if !exists {
		return 0, 0
	}

	offset := Vec.Subtract(item.Base().Position, ship.Position)
	bearing := math.Atan2(offset.Y, offset.X)
	maximum := ship.TurnRate * ship.RotationalThrust() / ship.Rules.Flight.SpinDivisor
	forecast := newContactForecast(ship, item, centers)
	gain := collectionTurnGain

	if forecast.rocks {
		gain = 1.8
	}

	desired := turnCommand(math.Remainder(bearing-ship.Rotation, 2*math.Pi), maximum, gain)
	turns := []float64{desired, 0, -1, 1}
	best, bestThrust, bestTurn := math.Inf(1), 0., desired

	for index, turn := range turns {
		duplicate := false

		for _, previous := range turns[:index] {
			if math.Abs(previous-turn) < .001 {
				duplicate = true
			}
		}

		if duplicate {
			continue
		}

		for _, thrust := range []float64{1, 0} {
			// Pickup time and departure cost are nonnegative, so a later
			// pickup cannot improve the best captured candidate's score.
			horizon := min(collectionPredictionTime, best)

			prediction, ready := forecast.predict(thrust, turn, horizon)

			if !ready {
				thrust := 1.

				if collectionRecoveryConstrained(ship, item.Base().Position, obstacles) {
					thrust = 0
				}

				return p.avoid(ship, simulation.DirectionOf(bearing), thrust, desired, obstacles)
			}

			if !prediction.safe {
				continue
			}

			score := 1000 + prediction.distance

			if prediction.arrived {
				futureShip, futureCraft := *ship, *ship.Craft
				futureCraft.GameObject, futureShip.Craft = &prediction.ship, &futureCraft
				departure := math.Inf(1)

				for _, position := range destination.NextPositions {
					departure = min(departure, PickupDeparture(&futureShip, position))
				}

				if math.IsInf(departure, 1) {
					departure = 0
				}

				score = prediction.seconds + .25*departure
			}

			if score < best {
				best, bestThrust, bestTurn = score, thrust, turn
			}
		}
	}

	if math.IsInf(best, 1) {
		return p.avoid(ship, simulation.DirectionOf(bearing), 0, desired, obstacles)
	}

	remaining := make([]obstacle, 0, len(obstacles))

	for _, obstacle := range obstacles {
		if !slices.Contains(forecast.sources, obstacle.entity) {
			remaining = append(remaining, obstacle)
		}
	}

	heading := ship.Rotation + bestTurn*maximum/gain
	return p.avoid(ship, simulation.DirectionOf(heading), bestThrust, bestTurn, remaining)
}

/*
PickupDeparture estimates travel time from the current heading and momentum.
Drift away from the new course costs both the coast and the trip back.
*/
func PickupDeparture(ship *objects.Ship, position Vec.Vector) float64 {
	offset := Vec.Subtract(position, ship.Position)
	maximum := max(1, ship.MaxSpeed())
	duration := Vec.Length(offset) / maximum
	duration += 2 * (Vec.Length(ship.Velocity) - Vec.Dot(ship.Velocity, Vec.Normalize(offset))) / (max(.001, ship.Drag) * maximum)
	spin := ship.TurnRate * ship.RotationalThrust() / ship.Rules.Flight.SpinDivisor

	if spin > 0 {
		duration += math.Abs(math.Remainder(math.Atan2(offset.Y, offset.X)-ship.Rotation, 2*math.Pi)) / spin
	}

	return duration
}
