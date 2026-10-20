package network

import (
	"bytes"
	"math"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func pirateTaunts(s *GameSession, socket *soundSocket) [][]byte {
	return slices.DeleteFunc(slices.Clone(socket.frames), func(frame []byte) bool {
		return len(frame) < 4 || frame[3] != byte(s.World.Specification.Protocol.ControlMessageIDs["chat"]) || !slices.ContainsFunc(s.World.Specification.PirateDialog.Taunt, func(text string) bool { return bytes.HasSuffix(frame, []byte(text)) })
	})
}

func TestPirateAttackAnnouncementPauseAlsoBlocksRetaliation(t *testing.T) {
	s, p, socket, npc := waitingEncounter(t)

	for range 30 * 20 {
		advanceEncounter(s, socket)
	}

	if npc.state != pirateWaiting || npc.countdown != -1 || npc.attackAfter == 0 {
		t.Fatal("pirate did not announce its pending attack")
	}

	otherSocket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, otherSocket)
	other := s.playersBySocket[otherSocket]
	other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(200, 0))
	other.ship.DockedTo, other.ship.Launching = nil, 0
	s.pirateHits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})

	if !npc.aggressors[other.playerID] {
		t.Fatal("another player's attack did not register hostility")
	}

	for float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep+1e-9 < npc.attackAfter {
		advanceEncounter(s, socket)

		if npc.ship.Firing || npc.input.Fire || npc.tauntAfter != 0 {
			t.Fatal("retaliation bypassed the announcement pause")
		}
	}

	advanceEncounter(s, socket)

	if npc.state != pirateFighting || !npc.aggressors[p.playerID] || math.Abs(npc.tauntAfter-npc.attackAfter-60) > 1e-8 {
		t.Fatalf("combat did not start after pause: tick=%d state=%d hostile=%v attackAfter=%g tauntAfter=%g", s.World.Tick, npc.state, npc.aggressors[p.playerID], npc.attackAfter, npc.tauntAfter)
	}
}

func TestPirateTauntsEveryMinuteAndBroadcastsOneVariant(t *testing.T) {
	s, p, socket, npc := waitingEncounter(t)
	otherSocket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, otherSocket)
	npc.state, npc.aggressors[p.playerID] = pirateFighting, true
	npc.thinkAfter = 0
	s.updatePirates()
	started := s.World.Tick

	for _, seconds := range []uint64{59, 60, 119, 120, 179, 180} {
		s.World.Tick = started + seconds*30
		s.updatePirates()
		a, b := pirateTaunts(s, socket), pirateTaunts(s, otherSocket)

		if len(a) != int(seconds/60) || len(b) != len(a) {
			t.Fatalf("at %ds, taunt counts=%d/%d", seconds, len(a), len(b))
		}

		for i := range a {
			if !bytes.Equal(a[i], b[i]) {
				t.Fatal("players received different random taunt variants")
			}
		}
	}
}

func TestPirateRetaliationDoesNotRestartItsAttackAnnouncement(t *testing.T) {
	s, _, socket, npc := waitingEncounter(t)
	otherSocket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, otherSocket)
	other := s.playersBySocket[otherSocket]
	other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
	other.ship.DockedTo, other.ship.Launching = nil, 0
	s.pirateHits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
	s.updatePirates()
	deadline := npc.tauntAfter
	announcements := pirateDialogCount(socket, s.World.Specification.PirateDialog.Attack)

	if npc.input.Fire || npc.attackAfter == 0 || deadline != 0 {
		t.Fatal("retaliation did not wait before starting combat")
	}

	s.World.Tick += uint64(math.Round(s.World.Specification.PirateSpec.AttackDelay / s.World.Specification.Simulation.SimulationStep))
	s.updatePirates()
	deadline = npc.tauntAfter

	if !npc.input.Fire || deadline == 0 {
		t.Fatal("retaliation did not begin after its delay")
	}

	s.World.Tick = 20 * 30
	s.updatePirates()

	if !npc.input.Fire || npc.tauntAfter != deadline {
		t.Fatal("the robbery timeout paused an existing fight")
	}

	if pirateDialogCount(socket, s.World.Specification.PirateDialog.Attack) != announcements {
		t.Fatal("the existing fight received a redundant attack announcement")
	}
}

func TestPirateTauntClockSurvivesPursuitAndTargetChanges(t *testing.T) {
	s, p, socket, npc := waitingEncounter(t)
	otherSocket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, otherSocket)
	other := s.playersBySocket[otherSocket]
	other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(300, 0))
	npc.state, npc.aggressors[p.playerID] = pirateFighting, true
	npc.thinkAfter = 0
	s.updatePirates()
	deadline := npc.tauntAfter
	started := s.World.Tick
	p.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(2000, 0))
	s.World.Tick = started + 45*30
	s.updatePirates()

	if npc.state != piratePursuing || npc.tauntAfter != deadline {
		t.Fatal("temporary loss of sight restarted the combat clock")
	}

	s.World.Tick = started + 65*30
	s.updatePirates()

	if len(pirateTaunts(s, socket)) != 0 || npc.tauntAfter != deadline {
		t.Fatal("pirate taunted an unseen target or lost its pending deadline")
	}

	s.pirateHits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
	s.updatePirates()

	if len(pirateTaunts(s, socket)) != 1 {
		t.Fatal("pirate did not resume its combat dialog against the new attacker")
	}

	deadline = npc.tauntAfter
	p.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(150, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.tauntAfter != deadline || len(pirateTaunts(s, socket)) != 1 {
		t.Fatal("switching to a nearer hostile target restarted the taunt clock")
	}

	p.ship.DockedTo = &npc.homeID
	s.updatePirates()

	if npc.tauntAfter != deadline || !npc.aggressors[other.playerID] {
		t.Fatal("one player's escape interrupted combat against another")
	}

	other.ship.DockedTo = &npc.homeID
	s.updatePirates()

	if npc.tauntAfter != 0 {
		t.Fatal("ending combat did not clear its taunt clock")
	}

	other.ship.DockedTo = nil
	s.pirateHits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
	s.updatePirates()

	if npc.tauntAfter != 0 || npc.attackAfter <= float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep {
		t.Fatal("a fresh attack after escaping bypassed its pause")
	}

	s.World.Tick += uint64(math.Round(s.World.Specification.PirateSpec.AttackDelay / s.World.Specification.Simulation.SimulationStep))
	s.updatePirates()
	want := float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep + 60

	if math.Abs(npc.tauntAfter-want) > 1e-8 {
		t.Fatal("a fresh attack after escaping did not start a fresh taunt clock")
	}
}

func TestPirateTauntsEndOnSurrenderOrAbandonedSearch(t *testing.T) {
	for _, end := range []string{"surrender", "search expired"} {
		t.Run(end, func(t *testing.T) {
			s, p, socket, npc := waitingEncounter(t)
			npc.state, npc.aggressors[p.playerID] = pirateFighting, true
			npc.thinkAfter = 0
			s.updatePirates()

			if end == "surrender" {
				p.ship.CargoRelease()
			} else {
				p.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(2000, 0))
				npc.state = pirateSearch
				npc.searchStartedAt = -101
			}

			npc.thinkAfter = 0
			s.updatePirates()

			if npc.tauntAfter != 0 {
				t.Fatal("finished encounter kept its combat clock")
			}

			s.World.Tick += 60 * 30
			s.updatePirates()

			if len(pirateTaunts(s, socket)) != 0 {
				t.Fatal("finished encounter emitted a combat taunt")
			}
		})
	}
}

func TestPirateEndedDemandStartsAFreshRetaliationPause(t *testing.T) {
	for _, end := range []string{"surrender", "docking"} {
		t.Run(end, func(t *testing.T) {
			s, p, _, npc := waitingEncounter(t)
			s.World.Tick += 20 * 30
			s.updatePirates()

			if npc.attackAfter == 0 {
				t.Fatal("pirate did not announce its pending attack")
			}

			if end == "surrender" {
				p.ship.CargoRelease()
			} else {
				p.ship.DockedTo = &npc.homeID
			}

			s.updatePirates()

			if npc.attackAfter != 0 || npc.tauntAfter != 0 {
				t.Fatal("ended demand kept its pending combat timers")
			}

			otherSocket := &soundSocket{}
			s.Receive(protocol.Control{Type: "hello"}, otherSocket)
			other := s.playersBySocket[otherSocket]
			other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
			other.ship.DockedTo, other.ship.Launching = nil, 0
			s.pirateHits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
			s.updatePirates()

			if npc.input.Fire || npc.tauntAfter != 0 || math.Abs(npc.attackAfter-float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep-s.World.Specification.PirateSpec.AttackDelay) > 1e-8 {
				t.Fatal("new retaliation did not start its own pause")
			}

		})
	}
}

func TestPiratePendingRetaliationKeepsPauseWhenVictimEscapes(t *testing.T) {
	for _, end := range []string{"surrender", "docking"} {
		t.Run(end, func(t *testing.T) {
			s, p, _, npc := waitingEncounter(t)
			s.World.Tick += 20 * 30
			s.updatePirates()
			deadline := npc.attackAfter
			otherSocket := &soundSocket{}
			s.Receive(protocol.Control{Type: "hello"}, otherSocket)
			other := s.playersBySocket[otherSocket]
			other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
			other.ship.DockedTo, other.ship.Launching = nil, 0
			s.pirateHits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})

			if end == "surrender" {
				p.ship.CargoRelease()
			} else {
				p.ship.DockedTo = &npc.homeID
			}

			s.updatePirates()

			if npc.input.Fire || npc.attackAfter != deadline || npc.tauntAfter != 0 {
				t.Fatal("the victim's escape bypassed an existing retaliation pause")
			}

			s.World.Tick += 3 * 30
			s.updatePirates()

			if !npc.input.Fire || math.Abs(npc.tauntAfter-deadline-60) > 1e-8 {
				t.Fatal("pending retaliation did not begin after its original pause")
			}
		})
	}
}
