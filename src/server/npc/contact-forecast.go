package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/physics"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

type contactPrediction struct {
	safe, arrived     bool
	seconds, distance float64
	ship, target      simulation.GameObject
}

type forecastBody struct {
	object   simulation.GameObject
	body     *physics.Body
	start    simulation.Pose
	velocity Vec.Vector
	spin     float64
}

/*
contactForecast advances detached copies through the ordinary engine, movement
and collision solver. Reusing immutable fixtures preserves real hull deflection
and continuous pickup sensors without changing any live object or collection.
*/
type contactForecast struct {
	ship     *objects.Ship
	target   simulation.Entity
	sources  []simulation.Entity
	centers  []Vec.Vector
	eligible bool
	rocks    bool
	bay      float64
}

func newContactForecast(ship *objects.Ship, target simulation.Entity, centers []Vec.Vector) contactForecast {
	forecast := contactForecast{ship: ship, target: target, sources: []simulation.Entity{ship, target}, centers: centers}
	radius, maximumSpeed := navigationRadius(ship), ship.MaxSpeed()

	for _, entity := range ship.World.Entities.ReadValues() {
		object := entity.Base()

		if entity == target || object.Dead {
			continue
		}

		reach := object.Radius + radius + 60

		switch entity.(type) {
		case *objects.Station:
			reach = object.Radius + radius + maximumSpeed*6
		case *simulation.Asteroid:
			record, _ := object.CollisionState.(*gameplay.BodyRecord)

			if record == nil || record.Deferred != nil || len(record.Fixtures) == 0 {
				continue
			}
		default:
			continue
		}

		if Vec.DistanceSquared(ship.Position, object.Position) < reach*reach || Vec.DistanceSquared(target.Base().Position, object.Position) < reach*reach {
			forecast.sources = append(forecast.sources, entity)

			if _, rock := entity.(*simulation.Asteroid); rock {
				forecast.rocks = true
			}
		}
	}

	forecast.eligible = target.Base().Item && ship.PlayerID != nil && ship.ModuleActive("cargoHatch") && (target.Base().Message != nil || len(ship.CargoContents) < ship.CargoCapacity())
	return forecast
}

func (forecast contactForecast) predict(thrust, turn, horizon float64) (contactPrediction, bool) {
	ship, target, sources, centers := forecast.ship, forecast.target, forecast.sources, forecast.centers
	rules := ship.Catalog.Simulation
	world := physics.NewWorld(rules)
	bodies := make([]forecastBody, len(sources))
	result := contactPrediction{safe: true, distance: math.Inf(1)}

	for index, source := range sources {
		record, _ := source.Base().CollisionState.(*gameplay.BodyRecord)

		if record == nil || record.Body.Destroyed {
			return result, false
		}

		future := &bodies[index]
		future.object = *source.Base()
		future.object.Self, future.object.World, future.object.Collections = &future.object, nil, nil
		future.object.SpeedLimit = source.MaxSpeed()
		future.body = world.CreateBody()
		future.body.SetTransform(future.object.Position, future.object.Rotation)
		future.body.InvMass, future.body.InvI = record.Body.InvMass, record.Body.InvI

		for _, fixture := range record.Fixtures {
			future.body.CreateFixture(fixture.Shape, physics.FixtureOpt{UserData: fixture.UserData, Physics: &fixture.Physics})
		}

		future.body.SetProxyRadius(record.Radius)
	}

	movers := []simulation.Entity{}

	for index, source := range sources {
		original, ok := source.(*objects.Station)

		if !ok {
			continue
		}

		station := *original
		craft := *station.Craft
		craft.GameObject, station.Craft = &bodies[index].object, &craft
		bodies[index].object.Self = &station
		movers = append(movers, &station)

		for child := range bodies {
			if bodies[child].object.LocalMovementParent == source {
				bodies[child].object.LocalMovementParent = &station
			}
		}
	}

	empty := []simulation.Entity{}
	collections := []*[]simulation.Entity{&empty, &movers}

	for index := range bodies {
		bodies[index].object.Collections = collections
	}

	frameTick := ship.World.Tick
	_, docking := target.(*objects.Station)
	var manifold collision.WorldManifold

	world.OnPreSolve(func(contact *physics.Contact) {
		a, b := contact.FixtureA.UserData.(*collision.Collider), contact.FixtureB.UserData.(*collision.Collider)

		if docking && ship.Cockpit != nil && ship.Launching == 0 && (ship.DockedTo == nil || *ship.DockedTo == 0) && (a.Owner == target && a.DockSegment && b.Owner == ship || b.Owner == target && b.DockSegment && a.Owner == ship) {
			result.arrived = true
		}

		if !docking && modules.CargoContactAllowed(a, b) && (a.Owner == target && b.Owner == ship || b.Owner == target && a.Owner == ship) {
			dropped := target.Base().DroppedBy != nil && ship.PlayerID != nil && *target.Base().DroppedBy == *ship.PlayerID && frameTick < target.Base().PickupAfter

			if forecast.eligible && !dropped && !bodies[1].object.Dead {
				result.arrived = true
			}

			return
		}

		if !contact.FixtureA.Physics || !contact.FixtureB.Physics {
			return
		}

		_, stationA := a.Owner.(*objects.Station)
		_, stationB := b.Owner.(*objects.Station)

		if stationA && b.Owner == ship && !a.DockSegment || stationB && a.Owner == ship && !b.DockSegment {
			result.safe = false
		}

		wm := contact.GetWorldManifold(&manifold)
		va := contact.FixtureA.Body.GetLinearVelocityFromWorldPoint(wm.Points[0])
		vb := contact.FixtureB.Body.GetLinearVelocityFromWorldPoint(wm.Points[0])
		contact.SurfaceSpeed = a.Speed + b.Speed
		impact := contact.SurfaceSpeed - Vec.Dot(Vec.Subtract(vb, va), wm.Normal)
		inverseMass := 1/a.Owner.(simulation.Entity).Base().Mass + 1/b.Owner.(simulation.Entity).Base().Mass

		if (impact/inverseMass-rules.Physics.DamageBase)/rules.Physics.DamageScale >= .5 {
			result.safe = false
		}

		contact.Friction, contact.Restitution = math.Sqrt(a.GetFriction()*b.GetFriction()), 0

		if impact >= rules.ContactSpeedThreshold {
			ba, bb := 0., 0.

			if a.Bounciness != nil {
				ba = *a.Bounciness
			}

			if b.Bounciness != nil {
				bb = *b.Bounciness
			}

			contact.Restitution = max(0, (ba+bb)/2)
		}
	})

	dt := rules.SimulationStep
	substeps := rules.UpdateTiers["visible"].Substeps
	substep := dt / float64(substeps)
	angular := ship.RotationalThrust()
	maximumSpin := ship.TurnRate * angular / ship.Rules.Flight.SpinDivisor
	acceleration := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass
	interval := max(1, int(math.Round(ship.Catalog.NPCMovement.DecisionInterval/dt)))

	for tick := range int(math.Ceil(horizon / dt)) {
		if tick > 0 && tick%interval == 0 {
			thrust, turn = forecast.controls(&bodies[0].object, &bodies[1].object)
		}

		for index := range bodies {
			future := &bodies[index]
			object := &future.object
			future.start = simulation.Pose{Position: object.Position, Rotation: object.Rotation}
			steps, step := substeps, substep

			if _, craft := sources[index].(simulation.CraftEntity); !craft && object.Velocity == (Vec.Vector{}) {
				steps = rules.UpdateTiers["drift"].Substeps
				step = dt / float64(steps)
			}

			for range steps {
				if index == 0 {
					object.Spin += max(-angular*step, min(angular*step, turn*maximumSpin-object.Spin))
					object.Velocity = simulation.MovePoint(object.Velocity, object.Rotation+object.Spin*step, acceleration*thrust*step)
				}

				object.Update(step)
			}

			future.velocity = Vec.Scale(Vec.Subtract(object.Position, future.start.Position), 1/dt)
			future.spin = (object.Rotation - future.start.Rotation) / dt
			future.body.SetTransform(future.start.Position, future.start.Rotation)
			future.body.LinearVelocity, future.body.AngularVelocity = future.velocity, future.spin
		}

		frameTick = ship.World.Tick + uint64(tick)
		world.Step(dt, rules.Physics.VelocityIterations, rules.Physics.PositionIterations)

		for index := range bodies {
			future := &bodies[index]
			future.object.Position, future.object.Rotation = future.body.GetPosition(), future.body.GetAngle()
			future.object.Velocity = Vec.Add(future.object.Velocity, Vec.Subtract(future.body.LinearVelocity, future.velocity))
			future.object.Spin += future.body.AngularVelocity - future.spin
			future.object.RoundMotion()
		}

		result.seconds = float64(tick+1) * dt

		if result.arrived || !result.safe {
			break
		}
	}

	result.ship, result.target = bodies[0].object, bodies[1].object
	local := simulation.RotatePoint(Vec.Subtract(result.target.Position, result.ship.Position), -result.ship.Rotation)

	for _, center := range centers {
		result.distance = min(result.distance, Vec.Distance(local, center))
	}

	return result, true
}

func (forecast contactForecast) controls(ship, target *simulation.GameObject) (float64, float64) {
	position := target.Position
	_, docking := forecast.target.(*objects.Station)

	if docking {
		position = dockingPosition(ship, target, forecast.bay)
	}

	direction := Vec.Normalize(Vec.Subtract(position, ship.Position))
	drift := Vec.Subtract(ship.Velocity, target.Velocity)
	lateral := Vec.Subtract(drift, Vec.Scale(direction, Vec.Dot(drift, direction)))
	course := Vec.Subtract(Vec.Scale(direction, max(80, forecast.ship.MaxSpeed())), Vec.Scale(lateral, 1.2))
	gain := collectionTurnGain
	thrust := 1.

	if forecast.rocks && !docking {
		gain = 1.8
		speed := min(forecast.ship.MaxSpeed(), 40+Vec.Distance(ship.Position, target.Position)*ship.Drag*.8)
		course = Vec.Add(target.Velocity, Vec.Subtract(Vec.Scale(direction, max(80, speed)), Vec.Scale(lateral, 1.2)))
		desired := Vec.Add(target.Velocity, Vec.Scale(direction, speed))
		acceleration := Vec.Add(Vec.Scale(desired, ship.Drag), Vec.Scale(Vec.Subtract(desired, ship.Velocity), 1/forecast.ship.Catalog.NPCMovement.ResponseTime))
		maximum := forecast.ship.Rules.Flight.ThrustScale * forecast.ship.ForwardThrust() / forecast.ship.Mass
		thrust = 0

		if maximum > 0 {
			thrust = max(0, min(1, Vec.Dot(acceleration, simulation.DirectionOf(ship.Rotation))/maximum))
		}
	}

	if docking {
		course = Vec.Add(course, target.Velocity)
		gain = 1.8
	}

	maximum := forecast.ship.TurnRate * forecast.ship.RotationalThrust() / forecast.ship.Rules.Flight.SpinDivisor
	angle := math.Remainder(math.Atan2(course.Y, course.X)-ship.Rotation, 2*math.Pi)

	if docking && math.Abs(angle) >= 1.65 {
		thrust = 0
	}

	return thrust, turnCommand(angle, maximum, gain)
}
