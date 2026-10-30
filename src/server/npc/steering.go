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

/*
brakingControls turns the ordinary engine against excess closing momentum.
Coast through the turn, then project the requested acceleration onto the engine.
Ignore ordinary speed-matching variation and never reverse relative velocity in
one held input, allowing the normal arrival controller to resume smoothly.
*/
func brakingControls(ship *objects.Ship, acceleration, direction, targetVelocity Vec.Vector) (Vec.Vector, float64, bool) {
	interval := ship.Catalog.NPCMovement.DecisionInterval
	relative := Vec.Subtract(ship.Velocity, targetVelocity)
	tolerance := math.Sqrt(ship.Rules.Motion.MinimumSpeedSquared) + max(0, Vec.Dot(targetVelocity, direction))*ship.Drag*interval
	maximum := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass

	if maximum <= 0 || Vec.Dot(relative, direction) <= tolerance || Vec.Dot(acceleration, direction) >= 0 {
		return Vec.Vector{}, 0, false
	}

	forward := Vec.Create(math.Cos(ship.Rotation), math.Sin(ship.Rotation))
	thrust := max(0, min(1, Vec.Dot(acceleration, forward)/maximum))
	thrust = min(thrust, max(0, -Vec.Dot(relative, forward))/(maximum*interval))
	return acceleration, thrust, true
}

/*
avoid tests reachable controls against momentum, turning response and swept hulls.
Routing supplies the preferred course; collision avoidance has priority over it.
*/
func (p *Pilot) avoid(ship *objects.Ship, heading Vec.Vector, thrust, turn float64, obstacles []obstacle) (float64, float64) {
	thrust = restartThrust(ship, thrust)
	rules := ship.Catalog.NPCMovement
	radius := navigationRadius(ship)
	reach := max(ship.MaxSpeed(), Vec.Length(ship.Velocity))*rules.PredictionTime + radius + rules.ClearanceDistance
	clear(p.nearby)
	p.nearby = p.nearby[:0]

	for _, object := range obstacles {
		travel := Vec.Length(object.velocity)*rules.PredictionTime + Vec.Length(object.acceleration)*rules.PredictionTime*rules.PredictionTime*.5

		within := object.radius + reach + travel

		if Vec.DistanceSquared(ship.Position, object.position) < within*within {
			p.nearby = append(p.nearby, object)
		}
	}

	if len(p.nearby) == 0 {
		return thrust, turn
	}

	forecast := p.forecast.reset(ship, predictionOptions{radius: radius, obstacles: p.nearby})
	return forecast.avoidControls(math.Atan2(heading.Y, heading.X), thrust, turn)
}

/*
avoidControls scores candidate inputs against one prepared collision forecast.
Pickup retries can change only the thrust duration and reuse the same scene.
*/
func (forecast *predictor) avoidControls(headingAngle, thrust, turn float64) (float64, float64) {
	ship := forecast.ship
	rules := ship.Catalog.NPCMovement
	nominal := forecast.predict(headingAngle, thrust, turn)

	if nominal.safe {
		return thrust, turn
	}

	best := nominal
	bestThrust, bestTurn := thrust, turn

	// Small heading changes preserve speed through narrow gaps.
	for _, offset := range []float64{0, -.15, .15, -.35, .35, -.7, .7, -1.2, 1.2, -2, 2, math.Pi} {
		angle := headingAngle + offset
		candidateTurn := turnInput(ship, math.Remainder(angle-ship.Rotation, 2*math.Pi))

		for _, candidateThrust := range []float64{0, .4, .7, 1} {
			candidateThrust = restartThrust(ship, candidateThrust)
			candidate := forecast.project(angle, candidateThrust, candidateTurn)
			penalty := Vec.Distance(candidate.position, nominal.position) + Vec.Distance(candidate.velocity, nominal.velocity)*rules.ResponseTime

			// Clearance penalties cannot improve this candidate's endpoint score.
			if best.safe && -penalty <= best.score {
				continue
			}

			candidate = forecast.inspect(candidate)
			candidate.score -= penalty

			// Retain the first side when mirror-image courses differ only by
			// floating-point noise, so opposing pilots choose opposite lanes.
			if candidate.safe && !best.safe || candidate.safe == best.safe && candidate.score > best.score+.001 {
				best, bestThrust, bestTurn = candidate, candidateThrust, candidateTurn
			}
		}
	}

	return bestThrust, bestTurn
}

/*
A small forecast impulse can fall below the simulation's velocity cutoff at each
physical substep. Raise launch impulses before comparing or returning controls.
*/
func restartThrust(ship *objects.Ship, thrust float64) float64 {
	if thrust <= 0 || Vec.LengthSquared(ship.Velocity) >= ship.Rules.Motion.MinimumSpeedSquared {
		return thrust
	}

	acceleration := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass
	step := ship.Catalog.Simulation.SimulationStep / float64(ship.Catalog.Simulation.UpdateTiers["visible"].Substeps)

	if acceleration <= 0 {
		return thrust
	}

	return max(thrust, min(1, math.Sqrt(ship.Rules.Motion.MinimumSpeedSquared)/(acceleration*step)*1.2))
}

/*
When circular clearance blocks a stopped pickup ship, try an ordinary impulse
followed by coasting through the full forecast horizon. If that also stalls,
creep into physical contact using only the minimum restart impulse and a slow
turn. The next decision adds no contact impulse while the ship is moving.
*/
func (p *Pilot) avoidPickup(ship *objects.Ship, heading Vec.Vector, thrust, turn float64, obstacles []obstacle) (float64, float64) {
	forward, spin := p.avoid(ship, heading, thrust, turn, obstacles)

	if forward != 0 || thrust <= 0 || Vec.LengthSquared(ship.Velocity) >= ship.Rules.Motion.MinimumSpeedSquared {
		return forward, spin
	}

	// The stopped retry has the same geometry, clearance and angular response.
	// Only translation changes: apply one impulse, then coast for the horizon.
	p.forecast.coast = true
	forward, spin = p.forecast.avoidControls(math.Atan2(heading.Y, heading.X), restartThrust(ship, thrust), turn)

	if forward != 0 {
		return forward, spin
	}

	spin = max(-.15, min(.15, turn))

	if math.Abs(ship.Spin) >= .3 {
		return 0, spin
	}

	forward = restartThrust(ship, .01)
	// Gentle rock contact must not become permission to nudge ships,
	// stations or other physical objects out of the pickup approach.
	nearby := p.nearby[:0]

	for _, object := range p.nearby {
		if !object.asteroid {
			nearby = append(nearby, object)
		}
	}

	if len(nearby) > 0 {
		forecast := p.forecast.reset(ship, predictionOptions{radius: navigationRadius(ship), obstacles: nearby, coast: true})

		if !forecast.predict(math.Atan2(heading.Y, heading.X), forward, spin).safe {
			forward = 0
		}
	}

	return forward, spin
}
