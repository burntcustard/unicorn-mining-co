package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
)

const predictionStep = .1

type prediction struct {
	safe               bool
	score              float64
	position, velocity Vec.Vector
}

type obstacleForecast struct {
	object              obstacle
	limit, reachSquared float64
}

type obstacleMotion struct {
	from, to                 Vec.Vector
	fromRotation, toRotation Vec.Vector
}

type predictionOptions struct {
	obstacles []obstacle
	radius    float64
	step      float64
	steps     int
	coast     bool
}

type predictor struct {
	coast bool
	ship  *objects.Ship

	clearance, angular, maxSpin, acceleration  float64
	maximumSpeed, drag, angularDrag, speedDrag float64

	obstacles        []obstacleForecast
	motion           []obstacleMotion
	path, directions []Vec.Vector
	step             float64

	heading, turn float64
	steeringReady bool
}

/*
reset shares ship mechanics and obstacle forecasts across every candidate.
All candidates inspect the same moving and rotating geometry for this decision.
*/
func (p *predictor) reset(ship *objects.Ship, options predictionOptions) *predictor {
	step := options.step

	if step == 0 {
		step = predictionStep
	}

	steps := options.steps

	if steps == 0 {
		steps = int((ship.Catalog.NPCMovement.PredictionTime + .001) / step)
	}

	obstacles := options.obstacles
	angular := ship.RotationalThrust()
	clear(p.obstacles)

	*p = predictor{
		ship: ship, coast: options.coast, clearance: options.radius + ship.Catalog.NPCMovement.ClearanceDistance*.5,
		angular: angular, maxSpin: ship.TurnRate * angular / ship.Rules.Flight.SpinDivisor,
		acceleration: ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass,
		maximumSpeed: ship.MaxSpeed(), drag: math.Exp(-ship.Drag * step),
		angularDrag: math.Exp(-ship.AngularDrag * step), speedDrag: math.Pow(ship.Rules.Motion.MaxSpeedDrag, step*60),
		obstacles: p.obstacles[:0], motion: p.motion, path: p.path, directions: p.directions,
		step: step,
	}

	p.motion = slices.Grow(p.motion[:0], steps*len(obstacles))[:steps*len(obstacles)]
	p.path = slices.Grow(p.path[:0], steps+1)[:steps+1]
	p.directions = slices.Grow(p.directions[:0], steps)[:steps]

	for _, object := range obstacles {
		limit := p.clearance

		if Vec.DistanceSquared(ship.Position, object.position) < (object.radius+limit)*(object.radius+limit) {
			if initial := object.distance(ship.Position); initial < limit {
				limit = initial - 1
			}
		}

		reach := object.radius + p.clearance + ship.Catalog.NPCMovement.ClearanceDistance
		p.obstacles = append(p.obstacles, obstacleForecast{object: object, limit: limit, reachSquared: reach * reach})
	}

	elapsed := step

	for index := range p.directions {
		motion := p.motion[index*len(obstacles) : (index+1)*len(obstacles)]

		for index, object := range obstacles {
			pose := obstacleMotion{from: object.positionAt(elapsed - step), to: object.positionAt(elapsed)}
			pose.fromRotation, pose.toRotation = object.inverseRotation, object.inverseRotation

			if object.spin != 0 && object.polygon != nil {
				base := object.inverseRotation

				if base == (Vec.Vector{}) {
					base.X = 1
				}

				pose.fromRotation = simulation.RotatePoint(base, -object.spin*(elapsed-step))
				pose.toRotation = simulation.RotatePoint(base, -object.spin*elapsed)
			}

			motion[index] = pose
		}

		elapsed += step
	}

	return p
}

/*
predict uses the same angular acceleration, forward thrust and drag as a ship.
The first decision is held for the AI interval; later turns track the chosen heading.
*/
func (p *predictor) predict(heading, thrust, turn float64) prediction {
	return p.inspect(p.project(heading, thrust, turn))
}

/*
project advances ordinary ship controls, retaining the path for collision checks.
*/
func (p *predictor) project(heading, thrust, turn float64) prediction {
	ship := p.ship
	p.steer(heading, turn)
	position, velocity := ship.Position, ship.Velocity
	p.path[0] = position
	dt := p.step
	acceleration := p.acceleration * thrust * dt

	for step := range p.directions {
		// A pickup retry tests the held input followed by a safe passive coast.
		if p.coast && float64(step)*dt >= ship.Catalog.NPCMovement.DecisionInterval {
			acceleration = 0
		}

		velocity = Vec.AddScaled(velocity, p.directions[step], acceleration)
		kept := p.drag

		if speed := Vec.Length(velocity); speed > p.maximumSpeed {
			kept = min(kept, max(p.maximumSpeed, speed*p.speedDrag)/speed)
		}

		velocity = Vec.Scale(velocity, kept)
		position = Vec.AddScaled(position, velocity, dt)

		p.path[step+1] = position
	}

	return prediction{position: position, velocity: velocity}
}

/*
steer shares angular motion across throttle candidates for the same controls.
Thrust changes translation but has no effect on the ship's turning response.
*/
func (p *predictor) steer(heading, turn float64) {
	if p.steeringReady && p.heading == heading && p.turn == turn {
		return
	}

	p.heading, p.turn, p.steeringReady = heading, turn, true
	rotation, spin := p.ship.Rotation, p.ship.Spin
	dt := p.step

	for step := range p.directions {
		if float64(step+1)*dt > p.ship.Catalog.NPCMovement.DecisionInterval+.001 {
			error := math.Remainder(heading-rotation, 2*math.Pi)
			turn = turnCommand(error, p.maxSpin, 1.8)
		}

		spin += max(-p.angular*dt, min(p.angular*dt, turn*p.maxSpin-spin))
		p.directions[step] = Vec.Create(math.Cos(rotation+spin*dt), math.Sin(rotation+spin*dt))
		spin *= p.angularDrag
		rotation += spin * dt
	}
}

/*
inspect checks the projected path against the shared obstacle forecasts.
*/
func (p *predictor) inspect(result prediction) prediction {
	rules := p.ship.Catalog.NPCMovement
	minimum, violation := math.Inf(1), 0.0
	safe := true
	dt := p.step

	for step := range p.directions {
		motion := p.motion[step*len(p.obstacles) : (step+1)*len(p.obstacles)]
		previous, position := p.path[step], p.path[step+1]

		for index, forecast := range p.obstacles {
			object, pose := forecast.object, motion[index]
			from := Vec.Subtract(previous, pose.from)
			to := Vec.Subtract(position, pose.to)

			closest := pointSegmentDistanceSquared(Vec.Vector{}, from, to)

			if closest > forecast.reachSquared {
				continue
			}

			reach := object.radius + forecast.limit
			blocked := forecast.limit > 0 && closest < reach*reach
			var distance float64

			if object.polygon == nil {
				distance = Vec.Length(to) - object.radius
			} else {
				if pose.fromRotation != (Vec.Vector{}) {
					from = Vec.Create(from.X*pose.fromRotation.X-from.Y*pose.fromRotation.Y, from.X*pose.fromRotation.Y+from.Y*pose.fromRotation.X)
					to = Vec.Create(to.X*pose.toRotation.X-to.Y*pose.toRotation.Y, to.X*pose.toRotation.Y+to.Y*pose.toRotation.X)
				}

				distance = object.polygon.distance(to)
				blocked = forecast.limit > 0 && pointSegmentDistanceSquared(Vec.Vector{}, from, to) < reach*reach && !object.polygon.clear(from, to, forecast.limit)
			}

			minimum = min(minimum, distance)

			if distance < forecast.limit || blocked {
				safe = false
				violation += max(1, forecast.limit-distance) * dt
			}
		}
	}

	score := -max(0, p.clearance+rules.ClearanceDistance-minimum) * 2

	if !safe {
		score -= violation * 1000
	}

	result.safe, result.score = safe, score
	return result
}

/*
StoppingPosition predicts one held decision followed by passive braking.
The residual velocity accounts for the coast beyond the collision forecast.
*/
func (p *Pilot) StoppingPosition(ship *objects.Ship, thrust, turn float64) Vec.Vector {
	step := ship.Catalog.Simulation.SimulationStep / float64(ship.Catalog.Simulation.UpdateTiers["visible"].Substeps)
	forecast := p.forecast.reset(ship, predictionOptions{step: step, coast: true})
	result := forecast.project(ship.Rotation, thrust, turn)
	return Vec.AddScaled(result.position, result.velocity, 1/ship.Drag)
}
