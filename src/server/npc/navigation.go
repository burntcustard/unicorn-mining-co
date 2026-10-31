package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

/*
ReturnMovement flies toward a station's saved location until its region loads,
then uses the same bay approach for every NPC hull and role.
*/
func (p *Pilot) ReturnMovement(ship *objects.Ship, home Movement) Movement {
	if entity, ok := ship.World.Entities.Get(home.TargetID); ok {
		if station, ok := entity.(*objects.Station); ok {
			return p.DockingMovement(ship, station)
		}
	}

	return home
}

/*
DockingMovement commits to a bay, routes around the hull, then enters its corridor.
The station remains an obstacle until the ship lines up outside that bay.
*/
func (p *Pilot) DockingMovement(ship *objects.Ship, station *objects.Station) Movement {
	if len(station.DockingBays) == 0 {
		return Movement{Position: station.Position, IgnoreID: station.ID}
	}

	if p.dockingID != station.ID {
		p.dockingID = station.ID
		best := math.Inf(1)

		for index, bay := range station.DockingBays {
			angle := station.Rotation + bay
			point := Vec.AddScaled(station.Position, Vec.Create(math.Cos(angle), math.Sin(angle)), station.Radius)

			if d := Vec.DistanceSquared(ship.Position, point); d < best {
				p.dockingBay, best = index, d
			}
		}
	}

	if movement, ready := p.directDock(ship, station); ready {
		return movement
	}

	relative := Vec.Subtract(ship.Position, station.Position)
	spin := station.Spin

	// Local movement already carries the ship around its station.
	if ship.LocalMovementParent == station {
		spin *= 1 - ship.LocalMovementRate
	}

	angle := station.Rotation + station.DockingBays[p.dockingBay]
	direction := Vec.Create(math.Cos(angle), math.Sin(angle))
	cross, along := Vec.Cross(relative, direction), Vec.Dot(relative, direction)
	across := math.Abs(cross)

	velocity := Vec.Add(station.Velocity, Vec.Scale(Vec.Create(-relative.Y, relative.X), spin))
	drift := Vec.Subtract(ship.Velocity, velocity)
	coastAcross := max(across, math.Abs(cross+Vec.Cross(drift, direction)/max(.001, ship.Drag)))

	if coastAcross < 35 && along > 0 && along < station.Radius+240 {
		offset := Vec.Subtract(station.Position, ship.Position)
		angle := math.Remainder(math.Atan2(offset.Y, offset.X)-ship.Rotation, 2*math.Pi)
		return Movement{controls: &protocol.Input{Turn: turnInput(ship, angle)}}
	}

	// Lead the moving bay while still outside its approach corridor.
	lead := min(2, Vec.Distance(ship.Position, station.Position)/max(70, Vec.Length(ship.Velocity)))
	angle += spin * lead
	outside := Vec.AddScaled(station.Position, Vec.Create(math.Cos(angle), math.Sin(angle)), station.Radius)
	// Match an inward entry velocity as the approach reaches the corridor,
	// rather than stopping at the staging point before turning inward.
	approachVelocity := Vec.Add(station.Velocity, Vec.Scale(Vec.Create(-direction.Y, direction.X), spin*station.Radius))

	if along > station.Radius && across < 100 {
		approachVelocity = Vec.AddScaled(approachVelocity, direction, -(100 - across))
	}

	return Movement{Position: outside, Velocity: approachVelocity, FollowDistance: 10, TargetID: station.ID}
}

// Search advances around an expanding spiral, retaining reachable legs through detours.
type Search struct {
	Origin  Vec.Vector
	Heading float64
	Angle   float64
}

/*
Movement advances with the ship rather than time. Skip points inside obstacles
so an unreachable waypoint cannot trap the search in small circles.
Switching reachable legs before arriving keeps the ship moving around the area.
*/
func (s *Search) movement(ship *objects.Ship, obstacles []obstacle) Movement {
	waypoint := func() Vec.Vector {
		angle := s.Heading + s.Angle
		return Vec.AddScaled(s.Origin, Vec.Create(math.Cos(angle), math.Sin(angle)), 120+55*s.Angle)
	}

	target := waypoint()
	speed := Vec.Length(ship.Velocity)
	lookahead := speed * ship.Catalog.NPCMovement.DecisionInterval
	turnRate := ship.TurnRate * ship.RotationalThrust() / ship.Rules.Flight.SpinDivisor

	if turnRate > 0 {
		lookahead += speed / turnRate
	}

	lookahead = max(70, lookahead)
	radius := navigationRadius(ship) + ship.Catalog.NPCMovement.ClearanceDistance

	for Vec.Distance(ship.Position, target) < lookahead || !clearSegment(target, target, radius, obstacles, false) {
		s.Angle += math.Pi / 32
		target = waypoint()
	}

	return Movement{Position: target}
}

/*
Search advances the spiral and steers through the same captured scene.
Only its semantic spiral state is retained separately from the pilot.
*/
func (p *Pilot) Search(ship *objects.Ship, search *Search) (float64, float64) {
	obstacles := p.obstacles.capture(ship, Movement{})
	destination := search.movement(ship, obstacles)

	if ship.Launching > 0 {
		return 1, 0
	}

	return p.steer(ship, destination, nil, obstacles)
}

/*
directDock uses physical contacts to check entry through the bay to its core.
Other obstacles must also leave a direct route and a safe first held decision.
*/
func (p *Pilot) directDock(ship *objects.Ship, station *objects.Station) (Movement, bool) {
	bay := station.DockingBays[p.dockingBay]
	axis := Vec.Create(math.Cos(station.Rotation+bay), math.Sin(station.Rotation+bay))
	relative := Vec.Subtract(ship.Position, station.Position)
	along := Vec.Dot(relative, axis)

	if along <= 0 || math.Abs(Vec.Cross(relative, axis)) > max(80, along) {
		return Movement{}, false
	}

	position := dockingPosition(ship.Base(), station.Base(), bay)
	obstacles := p.obstacles.capture(ship, Movement{IgnoreID: station.ID})

	if !clearSegment(ship.Position, station.Position, navigationRadius(ship)+ship.Catalog.NPCMovement.ClearanceDistance, obstacles, true) {
		return Movement{}, false
	}

	scene := newContactForecast(ship, station, nil)
	scene.bay = bay

	for attempt := range 2 {
		thrust, turn := scene.controls(ship.Base(), station.Base())

		if attempt == 0 && thrust == 0 {
			continue
		}

		if attempt == 1 {
			thrust = 0
			offset := Vec.Subtract(position, ship.Position)
			turn = turnInput(ship, math.Remainder(math.Atan2(offset.Y, offset.X)-ship.Rotation, 2*math.Pi))
		}

		result, ready := scene.predict(thrust, turn, 6)

		if ready && result.safe && result.arrived {
			steps := max(1, int(math.Ceil(ship.Catalog.NPCMovement.DecisionInterval/predictionStep)))
			check := p.forecast.reset(ship, predictionOptions{radius: navigationRadius(ship), obstacles: obstacles, steps: steps})

			if !check.predict(ship.Rotation, thrust, turn).safe {
				continue
			}

			return Movement{controls: &protocol.Input{Thrust: thrust, Turn: turn}}, true
		}
	}

	return Movement{}, false
}

/*
Aim along the bay centerline ahead of the ship, rather than cutting a chord to
the station center. Lead only rotation the station is not already carrying.
*/
func dockingPosition(ship, station *simulation.GameObject, bay float64) Vec.Vector {
	relative := Vec.Subtract(ship.Position, station.Position)
	spin := station.Spin

	if ship.LocalMovementParent != nil && ship.LocalMovementParent.Base() == station {
		spin *= 1 - ship.LocalMovementRate
	}

	lead := min(2, max(0, Vec.Length(relative)-station.Radius*.6)/max(80, Vec.Length(ship.Velocity)))
	direction := simulation.DirectionOf(station.Rotation + bay + spin*lead)
	along := Vec.Dot(relative, direction)
	return Vec.AddScaled(station.Position, direction, max(0, min(station.Radius*.6, along-max(80, ship.Radius*2))))
}
