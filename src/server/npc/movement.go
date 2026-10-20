package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

// Movement separates waiting, arrival and combat runs without changing ship physics.
type Movement struct {
	Position, Velocity           Vec.Vector
	FollowDistance, PassDistance float64
	IgnoreID, TargetID           int64
	Collect, Waiting             bool
}

// Pilot retains navigation, docking and attack runs between decisions.
type Pilot struct {
	obstacles                 obstacleSnapshot
	forecast                  predictor
	nearby                    []obstacle
	navigation                routePlan
	passTargetID              int64
	passOffset, passDirection Vec.Vector
	passing                   bool
	chasing                   bool
	chaseUntil                uint64
	targetID                  int64
	targetVelocity            Vec.Vector
	targetTick                uint64
	dockingID                 int64
	dockingBay                int
	enteringDock              bool
}

/*
Steer translates a persistent route into the ship's ordinary thrust and turn inputs.
Angular commands describe a desired spin, accounting for the actual engine response.
*/
func (p *Pilot) Steer(ship *objects.Ship, destination Movement) (float64, float64) {
	if destination.Waiting {
		p.passing = false
		offset := Vec.Subtract(destination.Position, ship.Position)
		angle := math.Remainder(math.Atan2(offset.Y, offset.X)-ship.Rotation, 2*math.Pi)
		return 0, turnInput(ship, angle)
	}

	if ship.Launching > 0 {
		return 1, 0
	}

	combatTarget := destination
	targetAcceleration := p.observeTarget(ship, destination)
	destination, chasing := p.combatMovement(ship, destination)

	target := destination.Position

	if destination.PassDistance > 0 {
		target = p.attackRun(ship, destination)
	} else {
		p.passing = false
	}

	if destination.Collect {
		for _, segment := range ship.Segments {
			if segment.Catches && segment.Module != nil && !(*segment.TargetHealth() < 1) {
				target = Vec.Subtract(target, simulation.RotatePoint(segment.LocalPosition, ship.Rotation))
				break
			}
		}
	}

	offset := Vec.Subtract(target, ship.Position)
	distance := Vec.Length(offset)
	direction := Vec.Normalize(offset)
	targetDirection := direction
	rules := ship.Catalog.NPCMovement
	speed := min(ship.MaxSpeed(), max(0, distance-destination.FollowDistance)*ship.Drag)

	if destination.PassDistance > 0 {
		speed = ship.MaxSpeed()
	}

	obstacles := p.obstacles.capture(ship, destination.IgnoreID)
	routeTarget := target

	// Lead only the route around obstacles; arrival and braking retain the
	// player's observed position even when the predicted waypoint is visible.
	if chasing && !p.passing && !clearSegment(ship.Position, target, navigationRadius(ship)+rules.ClearanceDistance, obstacles, true) {
		routeTarget = interceptPosition(ship, destination, obstacles)
	}

	waypoint, detour := p.navigation.waypoint(ship, routeTarget, obstacles)
	velocity := destination.Velocity

	if routeTarget != target && !detour {
		direction = Vec.Normalize(Vec.Subtract(waypoint, ship.Position))
	}

	if detour {
		offset = Vec.Subtract(waypoint, ship.Position)
		direction = Vec.Normalize(offset)
		speed = min(ship.MaxSpeed(), speed+Vec.Length(velocity))
		velocity = Vec.Vector{}
	}

	if !destination.Collect && destination.PassDistance == 0 && !detour && distance <= destination.FollowDistance+5 && Vec.LengthSquared(velocity) < ship.Rules.Motion.MinimumSpeedSquared && Vec.Length(Vec.Subtract(ship.Velocity, velocity)) < 3 {
		return 0, 0
	}

	// Compensate for drift relative to the target while retaining a forward course.
	relative := Vec.Subtract(ship.Velocity, velocity)
	lateral := Vec.Subtract(relative, Vec.Scale(direction, Vec.Dot(relative, direction)))
	heading := Vec.Add(velocity, Vec.Subtract(Vec.Scale(direction, max(80, speed)), Vec.Scale(lateral, 1.2)))
	angle := math.Remainder(math.Atan2(heading.Y, heading.X)-ship.Rotation, 2*math.Pi)
	turn := turnInput(ship, angle)

	desired := Vec.Add(velocity, Vec.Scale(direction, speed))

	if chasing && !detour {
		wanted := Vec.Dot(velocity, direction) + (distance-destination.FollowDistance)*ship.Drag
		desired = Vec.Scale(direction, max(0, min(ship.MaxSpeed(), wanted)))
	}

	maximum := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass
	acceleration := Vec.Add(Vec.Scale(desired, ship.Drag), Vec.Scale(Vec.Subtract(desired, ship.Velocity), 1/rules.ResponseTime))

	if chasing && !detour {
		acceleration = Vec.Add(acceleration, targetAcceleration)
	}

	// At a route corner, face the acceleration needed to cancel lateral drift
	// before building speed along the new leg.
	if detour || destination.FollowDistance > 0 && Vec.Dot(acceleration, direction) > 0 {
		heading = acceleration
		angle = math.Remainder(math.Atan2(heading.Y, heading.X)-ship.Rotation, 2*math.Pi)
		turn = turnInput(ship, angle)
	}

	thrust := 0.0

	if maximum > 0 && math.Abs(angle) < 1.65 {
		if destination.PassDistance > 0 || detour {
			thrust = 1
		} else {
			thrust = arrivalThrust(ship, targetDirection, destination.Velocity, targetAcceleration, distance-destination.FollowDistance)
		}

		// A route corner must not bypass the braking envelope of the actual
		// player. The waypoint can be far away even when the player is close.
		if detour && destination.FollowDistance > 0 {
			thrust = min(thrust, arrivalThrust(ship, targetDirection, destination.Velocity, targetAcceleration, distance-destination.FollowDistance))
		}

		// A stopped ship must clear the simulation's velocity dead zone to restart.
		if thrust > 0 && math.Abs(angle) < 1.25 && Vec.LengthSquared(ship.Velocity) < ship.Rules.Motion.MinimumSpeedSquared {
			step := ship.Catalog.Simulation.SimulationStep / float64(ship.Catalog.Simulation.UpdateTiers["visible"].Substeps)
			thrust = max(thrust, min(1, math.Sqrt(ship.Rules.Motion.MinimumSpeedSquared)/(maximum*step)*1.2))
		}
	}

	// Coast through sharp detour turns instead of powering the old course.
	// Full thrust resumes as the engine aligns with the requested acceleration.
	if detour {
		thrust *= max(0, math.Cos(angle))
	}

	if destination.FollowDistance > 0 {
		if brakingHeading, brakingThrust, active := brakingControls(ship, acceleration, targetDirection, destination.Velocity); active {
			heading, thrust = brakingHeading, brakingThrust
			angle = math.Remainder(math.Atan2(heading.Y, heading.X)-ship.Rotation, 2*math.Pi)
			turn = turnInput(ship, angle)
		}
	}

	if combatTarget.PassDistance > 0 || destination.FollowDistance > 0 {
		if entity, ok := ship.World.Entities.Get(combatTarget.TargetID); ok {
			if target, ok := entity.(*objects.Ship); ok {
				// Extrapolate the actual target's observed turning and braking.
				obstacles = append(obstacles, obstacle{position: target.Position, velocity: target.Velocity, acceleration: targetAcceleration, radius: target.Radius})
			}
		}
	}

	return p.avoid(ship, heading, thrust, turn, obstacles)
}

/*
turnInput converts a heading error into ordinary rotational controls.
*/
func turnInput(ship *objects.Ship, angle float64) float64 {
	maxSpin := ship.TurnRate * ship.RotationalThrust() / ship.Rules.Flight.SpinDivisor

	if maxSpin > 0 && math.Abs(angle) > 0.02 {
		return max(-1, min(1, angle*1.8/maxSpin))
	}

	return 0
}
