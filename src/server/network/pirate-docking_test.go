package network

import (
	"bytes"
	"context"
	"path/filepath"
	"slices"
	"strconv"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestDockedPirateDisappearsImmediately(t *testing.T) {
	for state, name := range pirateStateNames {
		t.Run(name, func(t *testing.T) {
			s, p, socket := pirateEncounter(t)
			s.dispatchPirates()
			npc := s.sectors[s.currentSector].pirates[0]
			npc.state, npc.thinkAfter = state, 1e9
			npc.ship.Launching = 0
			npc.ship.DockedTo = &npc.homeID
			station, _ := s.World.Entities.Get(npc.homeID)
			cargo := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World))}, s.World.Specification)
			npc.ship.CargoContents = append(npc.ship.CargoContents, cargo)
			loot := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World)), Position: p.ship.Position}, s.World.Specification)
			simulation.AddEntity(s.World, loot)
			npc.loot = append(npc.loot, loot)
			manager := NewBinaryReplicationManager(s.World.Specification)
			options := SnapshotOptions{World: s.World, ShipID: p.ship.ID}
			manager.Initial(options)

			if manager.members[npc.ship.ID] == nil {
				t.Fatal("pirate was not initially replicated")
			}

			s.updatePirates()
			manager.Snapshot(options)

			if npc.state != pirateDocked || s.World.Entities.Has(npc.ship.ID) || s.World.Players.Has(*npc.ship.PlayerID) || len(s.sectors[s.currentSector].pirates) != 0 || manager.members[npc.ship.ID] != nil {
				t.Fatal("docked pirate remained in the world or client snapshot")
			}

			if !slices.Contains(station.(*objects.Station).CargoContents, simulation.Entity(cargo)) || npc.credits != 1000+cargo.Price {
				t.Fatal("pirate did not sell its carried cargo before disappearing")
			}

			if !s.World.Entities.Has(loot.ID) || npc.ship.Launching != 0 || p.pirateAfter <= s.World.Tick {
				t.Fatal("pirate relaunched for leftover cargo or skipped the encounter cooldown")
			}

			if npc.ship.Dead || chatCount(socket, "AHH!") != 0 {
				t.Fatal("docking was treated as ship destruction")
			}
		})
	}
}

func TestDockingCallsOffAnOngoingPirateEncounter(t *testing.T) {
	for _, state := range []int{piratePursuing, pirateWaiting, pirateFighting, pirateSearch} {
		t.Run(strconv.Itoa(state), func(t *testing.T) {
			s, p, socket := pirateEncounter(t)
			s.Receive(protocol.Control{Type: "profile", DisplayName: "Skye"}, socket)
			s.dispatchPirates()
			npc := s.sectors[s.currentSector].pirates[0]
			npc.ship.Launching = 0
			npc.ship.Position = Vec.Add(p.ship.Position, Vec.Create(-250, 0))
			npc.state = state
			npc.aggressors[p.playerID] = true
			npc.input.Fire = true
			npc.thinkAfter = 10
			npc.loot = append(npc.loot, p.ship.CargoContents...)
			p.ship.DockedTo = &npc.homeID
			s.updatePirates()

			if npc.state != pirateReturning || npc.input.Fire || npc.aggressors[p.playerID] || len(npc.loot) != 0 {
				t.Fatal("docking did not immediately call off the encounter")
			}

			id := int64(0)
			cleared, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: &id}, s.World.Specification.Protocol)

			if err != nil {
				t.Fatal(err)
			}

			found := false

			for _, frame := range socket.frames {
				found = found || bytes.Equal(frame, cleared)
			}

			if !found {
				t.Fatal("docking did not remove the cargo release action")
			}

			lateHit := []protocol.SimulationEvent{protocol.CollisionEvent{By: p.playerID, B: npc.ship.ID, Damage: [2]float64{0, 3}}}
			s.pirateHits(lateHit)
			s.World.Tick += pirateDecisionTicks(s)
			s.updatePirates()

			if npc.aggressors[p.playerID] || chatCount(socket, "You've gotten away this time Skye") != 1 {
				t.Fatal("escape message was missing or repeated")
			}

			p.ship.Launch()
			s.pirateHits(lateHit)
			s.World.Tick += pirateDecisionTicks(s)
			s.updatePirates()

			if npc.state != pirateReturning || npc.input.Fire || npc.aggressors[p.playerID] {
				t.Fatal("launching restarted the old encounter")
			}

			p.ship.Launching = 0
			s.pirateHits(lateHit)

			if !npc.aggressors[p.playerID] {
				t.Fatal("a fresh attack after escaping could not provoke the pirate")
			}
		})
	}
}

func TestDockingCallsOffOnlyThePlayerWhoEscaped(t *testing.T) {
	for _, victimEscapes := range []bool{false, true} {
		t.Run(strconv.FormatBool(victimEscapes), func(t *testing.T) {
			s, p, socket := pirateEncounter(t)
			s.Receive(protocol.Control{Type: "profile", DisplayName: "Skye"}, socket)
			otherSocket := &soundSocket{}
			s.Receive(protocol.Control{Type: "hello"}, otherSocket)
			other := s.playersBySocket[otherSocket]
			s.Receive(protocol.Control{Type: "profile", DisplayName: "Robin"}, otherSocket)
			s.dispatchPirates()
			npc := s.sectors[s.currentSector].pirates[0]
			npc.ship.Launching = 0
			npc.ship.Position = Vec.Add(p.ship.Position, Vec.Create(-250, 0))
			npc.ship.Face(0)
			npc.state = pirateFighting
			npc.aggressors[p.playerID], npc.aggressors[other.playerID] = true, true
			other.ship.Position = p.ship.Position
			escaped, active := other, p

			if victimEscapes {
				escaped, active = p, other
			}

			escaped.ship.DockedTo = &npc.homeID
			npc.input.Fire = true
			npc.thinkAfter = 10
			s.updatePirates()

			if npc.aggressors[escaped.playerID] || !npc.aggressors[active.playerID] || !npc.input.Fire {
				t.Fatal("docking did not end only the escaped player's hostility")
			}

			escaped.ship.Launch()
			s.World.Tick += pirateDecisionTicks(s)
			s.updatePirates()

			if npc.aggressors[escaped.playerID] || !npc.aggressors[active.playerID] || chatCount(socket, "You've gotten away this time "+escaped.ship.Name) != 1 {
				t.Fatal("the escaped player became a target again or received repeated messages")
			}
		})
	}
}

func TestDockedReconnectWithMinedCargoDoesNotDispatchPirates(t *testing.T) {
	for _, restart := range []bool{false, true} {
		for _, login := range []string{"hello", "prepare"} {
			t.Run(strconv.FormatBool(restart)+"/"+login, func(t *testing.T) {
				var s *GameSession
				var p *playerRecord
				var socket *soundSocket
				var store *persistence.Store
				path := filepath.Join(t.TempDir(), "world.sqlite")

				if restart {
					s, store = persistedSession(t, path)
					socket = &soundSocket{}
					s.Receive(protocol.Control{Type: "hello"}, socket)
					p = s.playersBySocket[socket]
				} else {
					s, p, socket = pirateEncounter(t)
				}

				home := s.nearestStation(p.ship.Position)
				dockedTo := s.regions.idOffset + int64(home.ID)
				p.ship.Position = home.Position
				p.ship.DockedTo = &dockedTo
				p.ship.CargoContents = nil

				for range 3 {
					id := simulation.EntityID(s.World)
					item := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World, ID: &id}, s.World.Specification)
					item.Mined = true
					p.ship.CargoContents = append(p.ship.CargoContents, item)
				}

				token := p.profile.ID
				s.Disconnect(socket)

				if restart {
					committedSession(t, s)

					if err := store.Close(context.Background()); err != nil {
						t.Fatal(err)
					}

					s, store = persistedSession(t, path)
					defer store.Close(context.Background())
				}

				socket = &soundSocket{}
				s.Receive(protocol.Control{Type: login, PlayerToken: token}, socket)
				p = s.playersBySocket[socket]

				if login == "prepare" {
					for range 31 {
						advanceEncounter(s, socket)
					}

					if len(s.sectors[s.currentSector].pirates) != 0 {
						t.Fatal("preparing a docked returning player dispatched a pirate")
					}

					s.Receive(protocol.Control{Type: "play"}, socket)
				}

				for range 90 {
					advanceEncounter(s, socket)
				}

				if p.ship.DockedTo == nil || *p.ship.DockedTo != dockedTo || p.ship.MinedCargoValue() <= s.World.Specification.PirateSpec.CargoValueThreshold || !s.World.Players.Has(p.playerID) {
					t.Fatal("reconnection did not preserve an active docked ship and its valuable mined cargo")
				}

				if len(s.sectors[s.currentSector].pirates) != 0 {
					t.Fatal("docked mined cargo dispatched a pirate after reconnection")
				}

				p.ship.Launch()
				s.World.Tick += 30
				s.dispatchPirates()

				if len(s.sectors[s.currentSector].pirates) != 1 {
					t.Fatal("the docked guard permanently disabled later dispatches")
				}
			})
		}
	}
}
