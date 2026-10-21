package npc

import (
	"math"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

// Search advances around an expanding spiral, retaining reachable legs through detours.
type Search struct {
	Origin    Vec.Vector
	Heading   float64
	angle     float64
	obstacles obstacleSnapshot
}

/*
Movement advances with the ship rather than time. Skip points inside obstacles
so an unreachable waypoint cannot trap the search in small circles.
Switching reachable legs before arriving keeps the ship moving around the area.
*/
func (s *Search) Movement(ship *objects.Ship) Movement {
	waypoint := func() Vec.Vector {
		angle := s.Heading + s.angle
		return Vec.AddScaled(s.Origin, Vec.Create(math.Cos(angle), math.Sin(angle)), 120+55*s.angle)
	}

	target := waypoint()
	speed := Vec.Length(ship.Velocity)
	lookahead := speed * ship.Catalog.NPCMovement.DecisionInterval
	turnRate := ship.TurnRate * ship.RotationalThrust() / ship.Rules.Flight.SpinDivisor

	if turnRate > 0 {
		lookahead += speed / turnRate
	}

	lookahead = max(70, lookahead)
	obstacles := s.obstacles.capture(ship, 0)
	radius := navigationRadius(ship) + ship.Catalog.NPCMovement.ClearanceDistance

	for Vec.Distance(ship.Position, target) < lookahead || !clearSegment(target, target, radius, obstacles, false) {
		s.angle += math.Pi / 32
		target = waypoint()
	}

	return Movement{Position: target}
}
