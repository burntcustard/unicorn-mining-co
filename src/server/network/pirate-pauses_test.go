package network

import (
	"math"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func pirateDialogCount(socket *soundSocket, lines []string) int {
	count := 0

	for _, line := range lines {
		count += chatCount(socket, line)
	}

	return count
}

func assertPiratePaused(t *testing.T, npc *pirate) {
	t.Helper()

	if npc.state != pirateWaiting || npc.ship.NPCState != "Waiting" || npc.input.Fire || npc.ship.Firing {
		t.Fatalf("pirate did not wait peacefully: state=%d label=%q input=%+v firing=%v", npc.state, npc.ship.NPCState, npc.input, npc.ship.Firing)
	}
}

func TestPirateSurrenderPausesBeforeCollectingReleasedItems(t *testing.T) {
	for _, delay := range []float64{3, 1.2} {
		t.Run(strconv.FormatFloat(delay, 'f', -1, 64), func(t *testing.T) {
			s, p, socket, npc := waitingEncounter(t)
			s.World.Specification.PirateSpec.CollectDelay = delay

			for range 24 {
				advanceEncounter(s, socket)
			}

			if !npc.ship.ModuleActive("cargoHatch") {
				t.Fatal("fixture did not start with active cargo hatches")
			}

			p.ship.CargoRelease()
			s.updatePirates()
			started := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep
			deadline := npc.collectAfter

			if math.Abs(deadline-started-delay) > 1e-8 {
				t.Fatalf("collection deadline=%g, want %g", deadline, started+delay)
			}

			assertPiratePaused(t, npc)

			for float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep+1e-9 < deadline {
				advanceEncounter(s, socket)
				assertPiratePaused(t, npc)

				if npc.collectAfter != deadline || len(npc.ship.CargoContents) != 1 {
					t.Fatal("continued ejection restarted the pause or collected cargo early")
				}

				for _, collider := range npc.ship.HitboxColliding() {
					if segment, ok := collider.Segment.(*simulation.Segment); ok && segment.Catches {
						t.Fatal("collection pause left a passive cargo pickup collider active")
					}
				}
			}

			if len(p.ship.CargoContents) == 7 {
				t.Fatal("the physical cargo release did not begin during the pause")
			}

			s.updatePirates()

			if npc.state != pirateCollecting || npc.ship.NPCState != "Collecting" || npc.input.Fire {
				t.Fatalf("collection did not begin at its deadline: state=%d label=%q", npc.state, npc.ship.NPCState)
			}
		})
	}
}

func TestLastAttackerLeavingCancelsPendingPirateCombat(t *testing.T) {
	for _, scenario := range []struct{ accepted, dead bool }{{false, false}, {true, false}, {false, true}, {true, true}} {
		t.Run("cargoAccepted"+strconv.FormatBool(scenario.accepted)+"/dead"+strconv.FormatBool(scenario.dead), func(t *testing.T) {
			accepted := scenario.accepted
			s, p, socket, npc := waitingEncounter(t)
			warnedAt := npc.warnedAt
			otherSocket := &soundSocket{}
			s.Receive(protocol.Control{Type: "hello"}, otherSocket)
			other := s.playersBySocket[otherSocket]
			other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
			other.ship.DockedTo, other.ship.Launching = nil, 0

			if accepted {
				p.ship.CargoRelease()
				advanceEncounter(s, socket)
			}

			s.pirateHits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
			s.updatePirates()
			deadline := npc.attackAfter
			assertPiratePaused(t, npc)
			s.World.Tick += 30

			if scenario.dead {
				other.ship.Remove()
			} else {
				other.ship.DockedTo = &npc.homeID
			}

			s.updatePirates()
			now := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep

			if len(npc.aggressors) != 0 || npc.attackAfter != 0 || npc.tauntAfter != 0 || npc.input.Fire {
				t.Fatal("the last attacker's escape retained pending combat")
			}

			if accepted {
				assertPiratePaused(t, npc)

				if math.Abs(npc.collectAfter-now-s.World.Specification.PirateSpec.CollectDelay) > 1e-8 {
					t.Fatal("escaping attacker did not restart collection's pause")
				}
			} else {
				if npc.state == piratePursuing {
					s.World.Tick += pirateDecisionTicks(s)
					s.updatePirates()
				}

				if npc.state != pirateWaiting || npc.warnedAt <= warnedAt || npc.countdown <= 0 || npc.collectAfter != 0 {
					t.Fatal("escaping attacker did not resume a fresh cargo demand")
				}
			}

			s.World.Tick = uint64(math.Round(deadline/s.World.Specification.Simulation.SimulationStep)) + 1
			s.updatePirates()

			if npc.state == pirateFighting || npc.input.Fire || len(npc.aggressors) != 0 {
				t.Fatal("the canceled deadline started combat without an enemy")
			}
		})
	}
}

func TestPirateAttackPauseDoesNotTrackAnUnseenVictim(t *testing.T) {
	s, p, _, npc := waitingEncounter(t)
	s.pirateHits([]protocol.SimulationEvent{protocol.CollisionEvent{By: p.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
	s.updatePirates()
	remembered := npc.destination

	for _, offset := range []Vec.Vector{Vec.Create(2000, 0), Vec.Create(2400, 300)} {
		p.ship.Position = Vec.Add(npc.ship.Position, offset)
		s.World.Tick += pirateDecisionTicks(s)
		s.updatePirates()

		if npc.victimVisible || npc.destination != remembered || npc.input.Fire {
			t.Fatal("the attack pause tracked an unseen player's live position")
		}
	}
}

func TestFriendlyVictimDockingDoesNotAbandonDefendedLoot(t *testing.T) {
	for _, active := range []bool{false, true} {
		t.Run("fighting"+strconv.FormatBool(active), func(t *testing.T) {
			s, p, socket, npc := waitingEncounter(t)
			// Finish this fixture's release within the pirate's collection delay.
			p.ship.CargoContents = p.ship.CargoContents[:4]
			p.ship.CargoRelease()

			for tick := 0; tick < 150 && npc.state != pirateCollecting; tick++ {
				advanceEncounter(s, socket)
			}

			if npc.state != pirateCollecting || !npc.cargoAccepted || len(npc.loot) == 0 || p.ship.MinedCargoValue() != 0 {
				t.Fatal("fixture did not accept and eject the original victim's cargo")
			}

			otherSocket := &soundSocket{}
			s.Receive(protocol.Control{Type: "hello"}, otherSocket)
			other := s.playersBySocket[otherSocket]
			other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
			other.ship.DockedTo, other.ship.Launching = nil, 0
			s.pirateHits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
			s.updatePirates()

			if active {
				s.World.Tick += uint64(math.Round(s.World.Specification.PirateSpec.AttackDelay / s.World.Specification.Simulation.SimulationStep))
				s.updatePirates()
			}

			loot := slices.Clone(npc.loot)
			state := npc.state
			p.ship.DockedTo = &npc.homeID
			s.updatePirates()

			if !npc.cargoAccepted || !slices.Equal(npc.loot, loot) || !npc.aggressors[other.playerID] || npc.aggressors[p.playerID] || npc.state != state {
				t.Fatal("the friendly victim's docking abandoned loot or interrupted its defender")
			}

			for _, line := range s.World.Specification.PirateDialog.Escaped {
				if chatCount(socket, strings.ReplaceAll(line, "{player}", p.ship.Name)) != 0 {
					t.Fatal("the pirate called off combat against a friendly original victim")
				}
			}

			other.ship.DockedTo = &npc.homeID
			s.updatePirates()

			if !npc.cargoAccepted || !slices.Equal(npc.loot, loot) || npc.collectAfter == 0 || len(npc.aggressors) != 0 {
				t.Fatal("loot could not resume collection after both players docked")
			}
		})
	}
}

func TestPiratePursuesAndSearchesForItsLostThirdPartyAttacker(t *testing.T) {
	s, p, socket, npc := waitingEncounter(t)
	otherSocket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, otherSocket)
	other := s.playersBySocket[otherSocket]
	other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(0, 400))
	other.ship.DockedTo, other.ship.Launching = nil, 0
	npc.ship.Face(math.Pi / 2)
	s.pirateHits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
	s.updatePirates()
	remembered := other.ship.Position

	if npc.destination != remembered {
		t.Fatal("the retaliation pause did not remember the visible attacker's position")
	}

	s.World.Tick += uint64(math.Round(s.World.Specification.PirateSpec.AttackDelay / s.World.Specification.Simulation.SimulationStep))
	s.updatePirates()
	other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(2000, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.state != piratePursuing || npc.ship.NPCState != "Pursuing" || npc.destination != remembered || npc.input.Fire || npc.input.Thrust <= 0 || npc.aggressors[p.playerID] {
		t.Fatalf("lost attacker was not pursued independently of the friendly victim: state=%d destination=%v input=%+v", npc.state, npc.destination, npc.input)
	}

	npc.ship.Position = remembered
	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.state != pirateSearch || !npc.aggressors[other.playerID] || npc.aggressors[p.playerID] || pirateDialogCount(socket, s.World.Specification.PirateDialog.CargoDemand) != 1 {
		t.Fatal("search replaced the lost hostile attacker with the visible friendly victim")
	}
}

func TestFreshPirateRetaliationAlwaysPausesBeforeFighting(t *testing.T) {
	for _, state := range []int{piratePursuing, pirateWaiting, pirateSearch, pirateReturning} {
		t.Run(pirateStateNames[state], func(t *testing.T) {
			s, p, _, npc := waitingEncounter(t)
			s.World.Specification.PirateSpec.AttackDelay = 1.4
			npc.state = state
			npc.ship.Face(0)
			hit := []protocol.SimulationEvent{protocol.CollisionEvent{By: p.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}}
			s.pirateHits(hit)
			s.updatePirates()
			started := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep
			deadline := npc.attackAfter

			if !npc.aggressors[p.playerID] || math.Abs(deadline-started-1.4) > 1e-8 {
				t.Fatalf("retaliation did not use its spec delay: hostile=%v deadline=%g", npc.aggressors, deadline)
			}

			assertPiratePaused(t, npc)
			s.World.Tick += 41
			s.pirateHits(hit)
			s.updatePirates()
			assertPiratePaused(t, npc)

			if npc.attackAfter != deadline {
				t.Fatal("repeated damage extended the retaliation pause")
			}

			s.World.Tick++
			s.updatePirates()

			if npc.state != pirateFighting || npc.ship.NPCState != "Fighting" || !npc.input.Fire {
				t.Fatalf("retaliation did not begin at its deadline: state=%d label=%q input=%+v", npc.state, npc.ship.NPCState, npc.input)
			}
		})
	}
}

func TestPirateDefendsSurrenderedCargoAfterASecondPause(t *testing.T) {
	for _, collecting := range []bool{false, true} {
		for _, original := range []bool{false, true} {
			t.Run("collecting"+strconv.FormatBool(collecting)+"/original"+strconv.FormatBool(original), func(t *testing.T) {
				s, p, socket, npc := waitingEncounter(t)
				otherSocket := &soundSocket{}
				s.Receive(protocol.Control{Type: "hello"}, otherSocket)
				other := s.playersBySocket[otherSocket]
				other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
				other.ship.DockedTo, other.ship.Launching = nil, 0
				// Finish this fixture's release during the three-second attack pause.
				p.ship.CargoContents = p.ship.CargoContents[:4]
				p.ship.CargoRelease()
				advanceEncounter(s, socket)

				if collecting {
					for float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep <= npc.collectAfter+1e-9 {
						advanceEncounter(s, socket)
					}

					if npc.state != pirateCollecting {
						t.Fatal("fixture did not begin collecting")
					}
				} else if !p.ship.ReleasingCargo() {
					t.Fatal("fixture did not retain an ongoing cargo release")
				}

				attacker := other
				lines, otherLines := s.World.Specification.PirateDialog.DefendLoot, s.World.Specification.PirateDialog.BrokenTruce

				if original {
					attacker = p
					lines, otherLines = otherLines, lines
				}

				socket.frames, otherSocket.frames = nil, nil
				npc.ship.Face(0)
				hit := []protocol.SimulationEvent{protocol.CollisionEvent{By: attacker.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}}
				s.pirateHits(hit)
				s.updatePirates()
				deadline := npc.attackAfter
				started := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep

				if !npc.aggressors[attacker.playerID] || math.Abs(deadline-started-3) > 1e-8 || npc.collectAfter != 0 {
					t.Fatalf("loot defense did not replace collection with a fresh pause: state=%d deadline=%g collectAfter=%g", npc.state, deadline, npc.collectAfter)
				}

				assertPiratePaused(t, npc)

				for float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep+1e-9 < deadline {
					s.pirateHits(hit)
					advanceEncounter(s, socket)
					assertPiratePaused(t, npc)

					if npc.attackAfter != deadline || !npc.aggressors[attacker.playerID] {
						t.Fatal("old cargo release appeased retaliation or repeated hits reset its pause")
					}
				}

				s.updatePirates()

				if npc.state != pirateFighting || npc.ship.NPCState != "Fighting" || !npc.input.Fire {
					t.Fatalf("loot defender did not enter combat: state=%d label=%q input=%+v", npc.state, npc.ship.NPCState, npc.input)
				}

				if p.ship.MinedCargoValue() != 0 || p.ship.ReleasingCargo() {
					t.Fatal("fixture did not finish releasing its mined inventory")
				}

				if pirateDialogCount(socket, lines) != 1 || pirateDialogCount(otherSocket, lines) != 1 || pirateDialogCount(socket, otherLines) != 0 {
					t.Fatal("loot defense chose the wrong dialog or repeated it while taking hits")
				}

				for range 12 {
					advanceEncounter(s, socket)
				}

				if npc.state != pirateFighting || !npc.aggressors[attacker.playerID] {
					t.Fatal("empty mined inventory silently ended loot defense")
				}

				if original {
					id := simulation.EntityID(s.World)
					item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id}, s.World.Specification)
					item.Mined = true
					p.ship.CargoContents = append(p.ship.CargoContents, item)
					p.ship.CargoRelease()
					advanceEncounter(s, socket)
					assertPiratePaused(t, npc)

					if npc.aggressors[p.playerID] || npc.collectAfter == 0 || pirateDialogCount(socket, s.World.Specification.PirateDialog.LateSurrender) != 1 {
						t.Fatal("a separate cargo release could not surrender after breaking the truce")
					}
				}
			})
		}
	}
}
