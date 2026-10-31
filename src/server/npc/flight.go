package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

// Movement separates waiting, arrival and combat runs without changing ship physics.
type Movement struct {
	NextPositions                []Vec.Vector
	Position, Velocity           Vec.Vector
	FollowDistance, PassDistance float64
	IgnoreID, TargetID           int64
	Collect, Waiting             bool
	controls                     *protocol.Input
}

// Pilot retains navigation, docking and attack runs between decisions.
type Pilot struct {
	obstacles                 obstacleSnapshot
	forecast                  predictor
	nearby                    []obstacle
	navigation                routePlan
	passOffset, passDirection Vec.Vector
	passing                   bool
	chaseUntil                uint64
	targetID                  int64
	targetMotion              motionObservation
	dockingID                 int64
	dockingBay                int
	collection                collectionProgress
}

/*
Steer translates a persistent route into the ship's ordinary thrust and turn inputs.
Angular commands describe a desired spin, accounting for the actual engine response.
*/
func (p *Pilot) Steer(ship *objects.Ship, destination Movement) (float64, float64) {
	if destination.controls != nil {
		p.passing = false
		return destination.controls.Thrust, destination.controls.Turn
	}

	if destination.Waiting {
		p.passing = false
		offset := Vec.Subtract(destination.Position, ship.Position)
		angle := math.Remainder(math.Atan2(offset.Y, offset.X)-ship.Rotation, 2*math.Pi)
		return p.avoid(ship, offset, 0, turnInput(ship, angle), p.obstacles.capture(ship, destination))
	}

	if ship.Launching > 0 {
		return 1, 0
	}

	scene := destination
	entity, _ := ship.World.Entities.Get(destination.TargetID)

	// Pursuit forecasts its target separately with observed acceleration; it
	// must not also become a stationary route obstacle at its current position.
	if _, shipTarget := entity.(*objects.Ship); shipTarget && (destination.PassDistance > 0 || destination.FollowDistance > 0) {
		scene.IgnoreID = destination.TargetID
	}

	return p.steer(ship, destination, entity, p.obstacles.capture(ship, scene))
}

// steer shares one captured scene across route planning and physical controls.
func (p *Pilot) steer(ship *objects.Ship, destination Movement, entity simulation.Entity, obstacles []obstacle) (float64, float64) {
	p.collection.update(ship, destination)

	if turn, wiggling := p.collectionWiggle(ship, obstacles); wiggling {
		return 0, turn
	}

	combatTarget := destination
	// Pursuit checks the previous target before velocity observation advances it.
	destination, chasing := p.combatMovement(ship, destination)
	targetAcceleration := p.observeTarget(ship, destination)

	target := destination.Position

	if destination.PassDistance > 0 {
		target = p.attackRun(ship, destination)
	} else {
		p.passing = false
	}

	var centerStorage [4]Vec.Vector
	centers := centerStorage[:0]

	if destination.Collect {
		centers = collectionCenters(ship, centers)

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

	routeTarget := target

	// Lead only the route around obstacles; arrival and braking retain the
	// player's observed position even when the predicted waypoint is visible.
	if chasing && !p.passing && !clearSegment(ship.Position, target, navigationRadius(ship)+rules.ClearanceDistance, obstacles, true) {
		radius := ship.Radius

		if entity != nil {
			radius = entity.Base().Radius
		}

		routeTarget = interceptPosition(ship, destination, radius, obstacles)
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
		return p.avoid(ship, direction, 0, 0, obstacles)
	}

	// Circle routes can end outside a usable hatch approach. Hand nearby cargo
	// to the pickup controller while retaining its obstacle forecast.
	collectNearby := destination.Collect && (!detour || distance < navigationRadius(ship)*3) && distance < ship.MaxSpeed()*collectionApproachTime

	if collectNearby {
		if len(centers) == 0 {
			return 0, 0
		}

		return p.collectControls(ship, destination, obstacles, centers)
	}

	// Compensate for drift relative to the target while retaining a forward course.
	relative := Vec.Subtract(ship.Velocity, velocity)
	lateral := Vec.Subtract(relative, Vec.Scale(direction, Vec.Dot(relative, direction)))
	heading := Vec.Add(velocity, Vec.Subtract(Vec.Scale(direction, max(80, speed)), Vec.Scale(lateral, 1.2)))
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
	}

	angle := math.Remainder(math.Atan2(heading.Y, heading.X)-ship.Rotation, 2*math.Pi)
	thrust := 0.0

	if maximum > 0 && math.Abs(angle) < 1.65 {
		thrust = 1

		// Direct arrivals brake for the target. Following retains that braking
		// envelope through detours, whose waypoints may lie beyond the target.
		if !detour && destination.PassDistance == 0 || detour && destination.FollowDistance > 0 {
			thrust = arrivalThrust(ship, targetDirection, destination.Velocity, targetAcceleration, distance-destination.FollowDistance)
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
		}
	}

	if target, ok := entity.(*objects.Ship); ok && (combatTarget.PassDistance > 0 || destination.FollowDistance > 0) {
		// Extrapolate the actual target's observed turning and braking.
		obstacles = append(obstacles, obstacle{position: target.Position, velocity: target.Velocity, acceleration: targetAcceleration, radius: navigationRadius(target)})
	}

	turn := turnInput(ship, angle)

	return p.avoid(ship, heading, thrust, turn, obstacles)
}

/*
turnInput converts a heading error into ordinary rotational controls.
*/
func turnInput(ship *objects.Ship, angle float64) float64 {
	return turnCommand(angle, ship.TurnRate*ship.RotationalThrust()/ship.Rules.Flight.SpinDivisor, 1.8)
}

const collectionTurnGain = 3.5

func collectionTurnInput(ship *objects.Ship, angle float64) float64 {
	return turnCommand(angle, ship.TurnRate*ship.RotationalThrust()/ship.Rules.Flight.SpinDivisor, collectionTurnGain)
}

func turnCommand(angle, maxSpin, gain float64) float64 {
	if maxSpin > 0 && math.Abs(angle) > 0.02 {
		return max(-1, min(1, angle*gain/maxSpin))
	}

	return 0
}

/*
SteerWithin brakes before ordinary controls carry the ship outside a work area.
The correction changes its course without changing the controller's activity.
*/
func (p *Pilot) SteerWithin(ship *objects.Ship, movement Movement, center Vec.Vector, radius float64) (float64, float64) {
	thrust, turn := p.Steer(ship, movement)

	if ship.Launching > 0 {
		return thrust, turn
	}

	interval := ship.Catalog.NPCMovement.DecisionInterval
	acceleration := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass
	travel := (Vec.Length(ship.Velocity) + acceleration*interval) * (interval + 1/ship.Drag)
	interior := radius - travel

	// Full thrust during this decision followed by a coast cannot reach the
	// boundary from here. Avoid the precise forecast for ordinary travel.
	if interior > 0 && Vec.DistanceSquared(ship.Position, center) < interior*interior {
		return thrust, turn
	}

	stopping := p.StoppingPosition(ship, thrust, turn)

	if Vec.DistanceSquared(stopping, center) <= radius*radius {
		return thrust, turn
	}

	thrust, turn = p.Steer(ship, Movement{Position: center})

	if Vec.Dot(simulation.DirectionOf(ship.Rotation), Vec.Subtract(center, ship.Position)) <= 0 {
		thrust = 0
	}

	return thrust, turn
}

/*
observeTarget estimates braking and cornering from consecutive sightings, allowing
the ship to respond before a velocity error grows into a large overshoot.
*/
func (p *Pilot) observeTarget(ship *objects.Ship, destination Movement) Vec.Vector {
	acceleration := Vec.Vector{}

	if p.targetID == destination.TargetID {
		acceleration = p.targetMotion.accelerationAt(ship, destination.Velocity)
		maximum := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass

		if length := Vec.Length(acceleration); length > maximum {
			acceleration = Vec.Scale(acceleration, maximum/length)
		}
	}

	p.targetID = destination.TargetID
	p.targetMotion = motionObservation{velocity: destination.Velocity, tick: ship.World.Tick}
	return acceleration
}

/*
combatMovement follows fast escaping ships from behind. Keep that pursuit through
brief braking and turns; approaching ships still receive a passing attack.
*/
func (p *Pilot) combatMovement(ship *objects.Ship, destination Movement) (Movement, bool) {
	if destination.PassDistance == 0 || p.targetID != destination.TargetID {
		p.chaseUntil, p.passing = 0, false
	}

	if destination.PassDistance == 0 {
		return destination, false
	}

	speed := Vec.Length(destination.Velocity)
	away := Vec.Dot(destination.Velocity, Vec.Subtract(destination.Position, ship.Position)) > speed*destination.PassDistance*2

	if speed > ship.MaxSpeed()*.25 && away || p.chaseUntil != 0 && speed > ship.MaxSpeed()*.1 {
		p.chaseUntil = ship.World.Tick + uint64(ship.Catalog.NPCMovement.PredictionTime/ship.Catalog.Simulation.SimulationStep)
	}

	if ship.World.Tick > p.chaseUntil {
		p.chaseUntil = 0
	}

	if p.chaseUntil == 0 {
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

/*
interceptPosition leads current target movement by at most two response times.
Clip that forecast before the target's footprint would cross an obstacle.
Recompute from each observation so a turn cannot leave a stale destination.
*/
func interceptPosition(ship *objects.Ship, target Movement, radius float64, obstacles []obstacle) Vec.Vector {
	lead := min(ship.Catalog.NPCMovement.ResponseTime*2, Vec.Distance(ship.Position, target.Position)/max(1, ship.MaxSpeed()))
	position := target.Position
	interval := ship.Catalog.NPCMovement.DecisionInterval

	for elapsed := min(interval, lead); elapsed > 0; elapsed = min(elapsed+interval, lead) {
		next := Vec.AddScaled(target.Position, target.Velocity, elapsed)

		if !clearSegment(position, next, radius, obstacles, false) {
			break
		}

		position = next

		if elapsed == lead {
			break
		}
	}

	return position
}
