package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

/*
observeTarget estimates braking and cornering from consecutive sightings, allowing
the ship to respond before a velocity error grows into a large overshoot.
*/
func (p *Pilot) observeTarget(ship *objects.Ship, destination Movement) Vec.Vector {
	acceleration := Vec.Vector{}
	dt := float64(ship.World.Tick-p.targetTick) * ship.Catalog.Simulation.SimulationStep

	if p.targetID == destination.TargetID && dt > 0 && dt <= ship.Catalog.NPCMovement.DecisionInterval*2 {
		acceleration = Vec.Scale(Vec.Subtract(destination.Velocity, p.targetVelocity), 1/dt)
		maximum := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass

		if length := Vec.Length(acceleration); length > maximum {
			acceleration = Vec.Scale(acceleration, maximum/length)
		}
	}

	p.targetID, p.targetVelocity, p.targetTick = destination.TargetID, destination.Velocity, ship.World.Tick
	return acceleration
}

/*
combatMovement follows fast escaping ships from behind. Keep that pursuit through
brief braking and turns; approaching ships still receive a passing attack.
*/
func (p *Pilot) combatMovement(ship *objects.Ship, destination Movement) (Movement, bool) {
	if destination.PassDistance == 0 || p.passTargetID != destination.TargetID {
		p.chasing, p.passing = false, false
		p.passTargetID = destination.TargetID
	}

	if destination.PassDistance == 0 {
		return destination, false
	}

	speed := Vec.Length(destination.Velocity)
	away := Vec.Dot(destination.Velocity, Vec.Subtract(destination.Position, ship.Position)) > speed*destination.PassDistance*2

	if speed > ship.MaxSpeed()*.25 && away || p.chasing && speed > ship.MaxSpeed()*.1 {
		p.chasing = true
		p.chaseUntil = ship.World.Tick + uint64(ship.Catalog.NPCMovement.PredictionTime/ship.Catalog.Simulation.SimulationStep)
	}

	if ship.World.Tick > p.chaseUntil {
		p.chasing = false
	}

	if !p.chasing {
		return destination, false
	}

	destination.FollowDistance = destination.PassDistance * 2
	destination.PassDistance = 0
	return destination, true
}

/*
attackRun closes on the target before committing to a short passing maneuver.
Its exit follows the target, so a moving ship cannot leave the pilot chasing a stale point.
*/
func (p *Pilot) attackRun(ship *objects.Ship, destination Movement) Vec.Vector {
	if p.passing {
		end := Vec.Add(destination.Position, p.passOffset)
		remaining := Vec.Subtract(end, ship.Position)

		if Vec.Length(remaining) < 80 || Vec.Dot(remaining, p.passDirection) < 0 || Vec.Distance(ship.Position, destination.Position) > 600 {
			p.passing = false
		} else {
			return end
		}
	}

	offset := Vec.Subtract(destination.Position, ship.Position)
	direction := Vec.Normalize(offset)
	closing := Vec.Dot(Vec.Subtract(ship.Velocity, destination.Velocity), direction)

	// Leave room to turn across the approach before momentum carries us into the target.
	if closing >= 0 && Vec.Length(offset) < max(320, closing*1.6+140) {
		if Vec.LengthSquared(direction) == 0 {
			direction = Vec.Create(math.Cos(ship.Rotation), math.Sin(ship.Rotation))
		}

		side := Vec.Create(-direction.Y, direction.X)

		if Vec.Dot(Vec.Subtract(ship.Velocity, destination.Velocity), side) < 0 {
			side = Vec.Scale(side, -1)
		}

		turnRate := ship.TurnRate * ship.RotationalThrust() / ship.Rules.Flight.SpinDivisor
		turnRadius := 0.0

		if turnRate > 0 {
			turnRadius = Vec.Length(ship.Velocity) / turnRate
		}

		lateral := destination.PassDistance*3 + turnRadius + max(0, closing)*ship.Catalog.NPCMovement.DecisionInterval
		p.passOffset = Vec.Add(Vec.Scale(direction, 250), Vec.Scale(side, lateral))
		end := Vec.Add(destination.Position, p.passOffset)
		p.passDirection = Vec.Normalize(Vec.Subtract(end, ship.Position))
		p.passing = true
		return end
	}

	return destination.Position
}
