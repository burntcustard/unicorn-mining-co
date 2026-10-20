package network

import (
	"bytes"
	"math"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func waitingEncounter(t *testing.T) (*GameSession, *playerRecord, *soundSocket, *pirate) {
	t.Helper()
	s, p, socket := pirateEncounter(t)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(p.ship.Position, Vec.Create(-250, 0))
	npc.ship.Face(0)
	p.ship.Face(0)
	socket.frames = nil
	advanceEncounter(s, socket)

	if npc.state != pirateWaiting || npc.following || npc.ship.Forward != 0 {
		t.Fatal("pirate did not begin by waiting at its normal standoff")
	}

	return s, p, socket, npc
}

func TestWaitingPirateFollowsWithoutRestartingItsDemand(t *testing.T) {
	s, p, socket, npc := waitingEncounter(t)
	warnedAt := npc.warnedAt
	startingPosition := npc.ship.Position
	followed := false
	settled := false

	for tick := 0; tick < 30*23; tick++ {
		if tick < 30*4 {
			p.lastInput = protocol.Input{Thrust: .35}
		} else {
			p.lastInput = protocol.Input{}
		}

		advanceEncounter(s, socket)
		elapsed := float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep - warnedAt

		if elapsed < 23 && npc.state != pirateWaiting {
			t.Fatalf("following interrupted the warning: elapsed=%g state=%d", elapsed, npc.state)
		}

		if npc.warnedAt != warnedAt {
			t.Fatal("following restarted the demand timer")
		}

		if elapsed < 23 && npc.ship.Firing {
			t.Fatal("following pirate fired before its warning expired")
		}

		if npc.following && npc.input.Thrust > .05 {
			followed = true
		}

		if elapsed > 12 && elapsed < 23 && !npc.following {
			distance := Vec.Distance(npc.ship.Position, p.ship.Position)

			if distance < 200 || distance > 230 || npc.input.Thrust != 0 {
				t.Fatalf("pirate stopped at an unreasonable distance: distance=%g thrust=%g", distance, npc.input.Thrust)
			}

			offset := Vec.Subtract(p.ship.Position, npc.ship.Position)
			angle := math.Remainder(math.Atan2(offset.Y, offset.X)-npc.ship.Rotation, 2*math.Pi)

			if math.Abs(angle) < .03 {
				settled = true
			}
		}
	}

	if !followed || !settled || Vec.Distance(startingPosition, npc.ship.Position) < 200 {
		t.Fatalf("waiting pirate failed to follow and settle: followed=%v settled=%v travel=%g distance=%g", followed, settled, Vec.Distance(startingPosition, npc.ship.Position), Vec.Distance(npc.ship.Position, p.ship.Position))
	}

	if npc.state != pirateFighting || !npc.aggressors[p.playerID] {
		t.Fatal("pirate did not attack when the original warning expired")
	}

	demands := 0

	for _, frame := range socket.frames {
		if len(frame) > 3 && frame[1] == 0x43 && frame[3] == byte(s.World.Specification.Protocol.ControlMessageIDs["chat"]) && slices.ContainsFunc(s.World.Specification.PirateDialog.CargoDemand, func(line string) bool { return bytes.HasSuffix(frame, []byte(line)) }) {
			demands++
		}
	}

	if demands != 1 {
		t.Fatalf("following issued %d demands, want one", demands)
	}
}

func TestWaitingPirateResumesFollowingAfterSettling(t *testing.T) {
	s, p, socket, npc := waitingEncounter(t)
	warnedAt := npc.warnedAt
	followed, settled := [2]bool{}, [2]bool{}

	for tick := 0; tick < 30*19; tick++ {
		cycle := 0

		if tick >= 30*9 {
			cycle = 1
		}

		if tick < 30 || tick >= 30*9 && tick < 30*10 {
			p.lastInput = protocol.Input{Thrust: .25}
		} else {
			p.lastInput = protocol.Input{}
		}

		advanceEncounter(s, socket)

		if npc.state != pirateWaiting || npc.warnedAt != warnedAt || npc.ship.Firing {
			t.Fatal("resuming pursuit interrupted the original waiting state")
		}

		if npc.following {
			followed[cycle] = true
		} else if followed[cycle] {
			settled[cycle] = true
		}
	}

	if followed != [2]bool{true, true} || settled != [2]bool{true, true} {
		t.Fatalf("pirate did not follow and settle on both moves: followed=%v settled=%v distance=%g", followed, settled, Vec.Distance(npc.ship.Position, p.ship.Position))
	}
}

func TestFollowingPirateAcceptsSurrenderAndDocking(t *testing.T) {
	for _, ending := range []string{"surrender", "docking"} {
		t.Run(ending, func(t *testing.T) {
			s, p, socket, npc := waitingEncounter(t)
			p.lastInput = protocol.Input{Thrust: .35}

			for range 30 * 2 {
				advanceEncounter(s, socket)
			}

			if npc.state != pirateWaiting || !npc.following {
				t.Fatal("fixture did not make the waiting pirate follow its victim")
			}

			expected := pirateWaiting
			p.lastInput = protocol.Input{}

			if ending == "surrender" {
				p.ship.CargoRelease()
			} else {
				expected = pirateReturning
				p.ship.DockedTo = &npc.homeID
			}

			advanceEncounter(s, socket)

			if npc.state != expected || npc.ship.Firing || npc.input.Fire || npc.aggressors[p.playerID] {
				t.Fatalf("following prevented %s: state=%d firing=%v", ending, npc.state, npc.ship.Firing)
			}

			for range 30 * 22 {
				advanceEncounter(s, socket)

				if npc.state == pirateFighting || npc.input.Fire || npc.aggressors[p.playerID] {
					t.Fatalf("warning restarted combat after %s", ending)
				}
			}
		})
	}
}
