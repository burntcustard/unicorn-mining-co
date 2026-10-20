package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

/*
avoid tests reachable controls against momentum, turning response and swept hulls.
Routing supplies the preferred course; collision avoidance has priority over it.
*/
func (p *Pilot) avoid(ship *objects.Ship, heading Vec.Vector, thrust, turn float64, obstacles []obstacle) (float64, float64) {
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

	headingAngle := math.Atan2(heading.Y, heading.X)
	forecast := p.forecast.reset(ship, radius, p.nearby)
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
			candidate := forecast.project(angle, candidateThrust, candidateTurn)
			penalty := Vec.Distance(candidate.position, nominal.position) + Vec.Distance(candidate.velocity, nominal.velocity)*rules.ResponseTime

			// Clearance penalties cannot improve this candidate's endpoint score.
			if best.safe && -penalty <= best.score {
				continue
			}

			candidate = forecast.inspect(candidate)
			candidate.score -= penalty

			if candidate.safe && !best.safe || candidate.safe == best.safe && candidate.score > best.score {
				best, bestThrust, bestTurn = candidate, candidateThrust, candidateTurn
			}
		}
	}

	return bestThrust, bestTurn
}
