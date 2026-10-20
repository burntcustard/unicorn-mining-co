package npc

import (
	"math"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

// Search advances around an expanding spiral, retaining each leg through detours.
type Search struct {
	Origin  Vec.Vector
	Heading float64
	angle   float64
}

/*
Movement advances with the ship rather than time, so obstacles cannot skip search legs.
Switching legs before arriving keeps the ship moving around the search area.
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

	for Vec.Distance(ship.Position, target) < lookahead {
		s.angle += math.Pi / 32
		target = waypoint()
	}

	return Movement{Position: target}
}
