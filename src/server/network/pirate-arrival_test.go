package network

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

/*
A pirate must allow for its remaining drift before entering the cargo-demand
range. Waiting then faces the player without thrust and cannot fix an overshoot.
*/
func TestPirateCoastsIntoItsCargoDemandDistance(t *testing.T) {
	s, p, socket := pirateEncounter(t)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(p.ship.Position, Vec.Create(1000, 0))
	npc.ship.Face(math.Pi)
	startingHealth := npc.ship.HullHealthTotal() + p.ship.HullHealthTotal()
	coasted, warned := false, false

	for range 30 * 45 {
		advanceEncounter(s, socket)
		distance := Vec.Distance(npc.ship.Position, p.ship.Position)

		if distance < 100 || npc.ship.Dead || p.ship.Dead {
			t.Fatal("pirate approached too quickly to wait safely")
		}

		if npc.state == piratePursuing && distance > 300 && npc.input.Thrust == 0 && Vec.Length(npc.ship.Velocity) > 10 {
			coasted = true
		}

		if npc.state == pirateWaiting {
			warned = true
			elapsed := float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep - npc.warnedAt

			if npc.input.Thrust != 0 || npc.following {
				t.Fatalf("pirate needed to chase the stationary player after demanding cargo: distance=%g speed=%g elapsed=%g thrust=%g following=%v", distance, Vec.Length(npc.ship.Velocity), elapsed, npc.input.Thrust, npc.following)
			}

			if elapsed >= 10 {
				if !coasted || distance < 200 || distance > 240 || Vec.Length(npc.ship.Velocity) > 3 {
					t.Fatalf("pirate failed to coast to a sensible stop: coasted=%v distance=%g speed=%g", coasted, distance, Vec.Length(npc.ship.Velocity))
				}

				if npc.ship.HullHealthTotal()+p.ship.HullHealthTotal() != startingHealth {
					t.Fatal("arrival damaged one of the ships")
				}

				return
			}
		}
	}

	t.Fatalf("pirate did not finish its approach: warned=%v state=%d distance=%g", warned, npc.state, Vec.Distance(npc.ship.Position, p.ship.Position))
}

func TestWaitingPirateMaintainsItsDistanceFromAMovingPlayer(t *testing.T) {
	s, p, socket, npc := waitingEncounter(t)
	const speed = 120.0
	p.ship.Velocity = Vec.Create(speed, 0)
	maximum := p.ship.Rules.Flight.ThrustScale * p.ship.ForwardThrust() / p.ship.Mass
	p.lastInput = protocol.Input{Thrust: speed * p.ship.Drag / maximum}
	followed := false
	totalError, samples := 0.0, 0

	for tick := range 30 * 19 {
		advanceEncounter(s, socket)

		if npc.state != pirateWaiting || npc.ship.Firing {
			t.Fatal("moving player interrupted the original cargo demand")
		}

		if npc.following {
			followed = true
		}

		if tick >= 30*10 {
			distance := Vec.Distance(npc.ship.Position, p.ship.Position)

			if !npc.following || distance < 180 || distance > 300 {
				t.Fatalf("pirate stopped maintaining pursuit of a moving player: following=%v distance=%g own speed=%g player speed=%g", npc.following, distance, Vec.Length(npc.ship.Velocity), Vec.Length(p.ship.Velocity))
			}

			totalError += math.Abs(distance - s.World.Specification.PirateSpec.FollowDistance)
			samples++
		}
	}

	if !followed || totalError/float64(samples) > 20 {
		t.Fatalf("moving player did not retain steady following: followed=%v mean spacing error=%g", followed, totalError/float64(samples))
	}
}
