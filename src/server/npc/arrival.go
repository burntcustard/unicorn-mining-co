package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

/*
arrivalThrust uses full power until passive coasting can close the remaining gap.
Predict the next held input to avoid overshooting by a whole steering interval.
A partial final impulse fills that interval; subsequent slowdown uses no thrust.
*/
func arrivalThrust(ship *objects.Ship, direction, targetVelocity, targetAcceleration Vec.Vector, gap float64) float64 {
	if ship.Drag <= 0 {
		return 1
	}

	speed := Vec.Dot(ship.Velocity, direction)
	targetSpeed := max(0, Vec.Dot(targetVelocity, direction))
	step := ship.Catalog.Simulation.SimulationStep / float64(ship.Catalog.Simulation.UpdateTiers["visible"].Substeps)
	minimum := math.Sqrt(ship.Rules.Motion.MinimumSpeedSquared)
	maximumSpeed := ship.MaxSpeed()

	interval := ship.Catalog.NPCMovement.DecisionInterval
	targetDrag := 0.0

	if targetSpeed > minimum {
		// Infer passive slowing from consecutive sightings rather than assuming
		// that a moving player will continue at its present speed indefinitely.
		targetDrag = math.Log1p(max(0, -Vec.Dot(targetAcceleration, direction)/targetSpeed)*interval) / interval
	}

	// Once relative motion settles, match a moving target's speed against drag.
	// This avoids alternating full-power pulses and coasting while following.
	if targetSpeed > minimum && math.Abs(gap) <= targetSpeed*interval && math.Abs(speed-targetSpeed) <= targetSpeed*ship.Drag*interval {
		desired := max(0, min(maximumSpeed, targetSpeed+gap*ship.Drag))
		maximum := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass
		return max(0, min(1, (desired*ship.Drag+(desired-speed)/ship.Catalog.NPCMovement.ResponseTime)/maximum))
	}

	coast := func(speed, targetSpeed float64) float64 {
		if speed <= minimum || targetDrag == 0 && speed <= targetSpeed {
			return 0
		}

		if targetSpeed > minimum && targetDrag > 0 {
			closing := max(0, speed/ship.Drag-targetSpeed/targetDrag)

			if ship.Drag > targetDrag && speed > targetSpeed {
				time := math.Log(speed/targetSpeed) / (ship.Drag - targetDrag)
				closing = max(closing, speed*-math.Expm1(-ship.Drag*time)/ship.Drag-targetSpeed*-math.Expm1(-targetDrag*time)/targetDrag)
			}

			return closing
		}

		if targetSpeed > minimum {
			return (speed - targetSpeed - targetSpeed*math.Log(speed/targetSpeed)) / ship.Drag
		}

		// Match drag substeps and the simulation's minimum-speed cutoff.
		steps := math.Floor(math.Log(speed/minimum)/(ship.Drag*step)) + 1
		return speed * step * (1 - math.Exp(-ship.Drag*step*steps)) / math.Expm1(ship.Drag*step)
	}

	if gap <= coast(speed, targetSpeed)+3 {
		return 0
	}

	forward := Vec.Create(math.Cos(ship.Rotation), math.Sin(ship.Rotation))
	acceleration := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass * max(0, Vec.Dot(forward, direction))
	drag := math.Exp(-ship.Drag * step)
	targetDecay := math.Exp(-targetDrag * step)
	steps := int(math.Round(interval / step))

	endpoint := func(thrust float64) float64 {
		velocity, target, distance := speed, targetSpeed, 0.0

		for range steps {
			velocity += acceleration * thrust * step

			if math.Abs(velocity) < minimum {
				velocity = 0
			} else {
				velocity = min(maximumSpeed, velocity*drag)
			}

			target *= targetDecay
			distance += (velocity - target) * step
		}

		return distance + coast(velocity, target)
	}

	if endpoint(1) < gap {
		return 1
	}

	low, high := 0.0, 1.0

	for range 10 {
		middle := (low + high) * 0.5

		if endpoint(middle) < gap {
			low = middle
		} else {
			high = middle
		}
	}

	return low
}
