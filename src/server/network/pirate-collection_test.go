package network

import (
	"bytes"
	"slices"
	"strconv"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func hasPirateCargoAction(t *testing.T, s *GameSession, socket *soundSocket, npc *pirate) bool {
	t.Helper()
	packet, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: &npc.ship.ID}, s.World.Specification.Protocol)

	if err != nil {
		t.Fatal(err)
	}

	return slices.ContainsFunc(socket.frames, func(frame []byte) bool { return bytes.Equal(frame, packet) })
}

func TestPirateAnnouncesItsHaulWhenLeaving(t *testing.T) {
	for _, scenario := range []struct{ count, full, success int }{{0, 0, 0}, {2, 0, 1}, {8, 1, 0}} {
		t.Run(strconv.Itoa(scenario.count), func(t *testing.T) {
			s, p, socket, npc := waitingEncounter(t)
			p.ship.Name = "Skye"
			npc.state, npc.cargoAccepted, npc.thinkAfter = pirateCollecting, true, 0
			npc.loot = nil

			for len(npc.ship.CargoContents) < scenario.count {
				item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World))}, s.World.Specification)
				npc.ship.CargoContents = append(npc.ship.CargoContents, item)
			}

			s.updatePirates()
			s.World.Tick += pirateDecisionTicks(s)
			s.updatePirates()
			full := chatCount(socket, "That's all I can carry. Lucky you.")
			success := chatCount(socket, "Pleasure doing business with you Skye. I'll see myself out.")

			if npc.state != pirateReturning || full != scenario.full || success != scenario.success {
				t.Fatalf("unexpected departure: state=%d full=%d success=%d", npc.state, full, success)
			}
		})
	}
}

func TestPirateStolenLootRestartsDemandForCollector(t *testing.T) {
	for _, original := range []bool{false, true} {
		t.Run(strconv.FormatBool(original), func(t *testing.T) {
			s, p, socket, npc := waitingEncounter(t)
			otherSocket := &soundSocket{}
			s.Receive(protocol.Control{Type: "hello"}, otherSocket)
			other := s.playersBySocket[otherSocket]
			other.ship.Position = p.ship.Position
			other.ship.DockedTo, other.ship.Launching = nil, 0
			thief, thiefSocket, observer := other, otherSocket, socket

			if original {
				thief, thiefSocket, observer = p, socket, otherSocket
			}

			// Unmined valuables must still be demanded back after theft.
			item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World))}, s.World.Specification)
			thief.ship.CargoContents = []simulation.Entity{item}
			npc.loot = []simulation.Entity{item}
			npc.state, npc.cargoAccepted = pirateCollecting, true
			socket.frames, otherSocket.frames = nil, nil
			started := s.World.Tick
			events := []protocol.SimulationEvent{protocol.ItemCollected{By: thief.playerID, ItemID: item.ID}}
			s.pirateLootCollected(events)
			s.pirateLootCollected(events)

			if npc.victim != thief || npc.victimShipID != thief.shipID || chatCount(thiefSocket, "Hey, that was my haul!") != 1 || hasPirateCargoAction(t, s, thiefSocket, npc) {
				t.Fatal("theft did not protest once and retarget the collector without an early action")
			}

			for _, tick := range []uint64{0, 89, 90, 179, 180, 210, 240, 270, 300, 390, 480, 570} {
				s.World.Tick = started + tick
				s.updatePirates()
				demand := chatCount(thiefSocket, "Give that back or I'll open fire.")

				if tick < 90 && demand != 0 || tick >= 90 && demand != 1 || hasPirateCargoAction(t, s, observer, npc) || hasPirateCargoAction(t, s, thiefSocket, npc) != (tick >= 90) {
					t.Fatalf("incorrect re-demand timing or action recipient at tick %d", tick)
				}

				if tick < 180 && chatCount(thiefSocket, "5") != 0 || tick >= 180 && chatCount(thiefSocket, "5") != 1 {
					t.Fatalf("countdown did not start three seconds after the re-demand at tick %d", tick)
				}

				if tick < 570 && npc.input.Fire {
					t.Fatalf("pirate fired during the warning at tick %d", tick)
				}
			}

			if npc.state != pirateFighting || !npc.aggressors[thief.playerID] || pirateDialogCount(thiefSocket, s.World.Specification.PirateDialog.Attack) != 1 || pirateDialogCount(thiefSocket, s.World.Specification.PirateDialog.CargoDemand) != 0 {
				t.Fatal("re-demand did not flow into the normal attack sequence")
			}

			thief.ship.CargoRelease()
			s.updatePirates()

			if !npc.cargoAccepted || npc.collectAfter == 0 || npc.input.Fire || npc.aggressors[thief.playerID] {
				t.Fatal("the collector could not surrender after the restarted countdown")
			}
		})
	}
}

func TestPirateDetectsLootTheftThroughSimulation(t *testing.T) {
	s, p, socket, npc := waitingEncounter(t)
	p.ship.CargoContents = nil
	p.ship.SetModuleActive("cargoHatch", true)
	p.ship.UpdateModules(1)
	p.lastInput = protocol.Input{CargoHatch: true}
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World)), Position: Vec.Add(p.ship.Position, Vec.Create(-2, 0))}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	npc.state, npc.cargoAccepted, npc.thinkAfter = pirateCollecting, true, 0
	npc.loot = []simulation.Entity{item}

	advanceEncounter(s, socket)

	if !slices.Contains(p.ship.CargoContents, simulation.Entity(item)) || npc.reDemandAfter == 0 || chatCount(socket, "Hey, that was my haul!") != 1 {
		t.Fatal("collecting surrendered loot in the simulation did not trigger the theft sequence")
	}
}

func TestPiratePendingReDemandCanBeInterrupted(t *testing.T) {
	for _, action := range []string{"surrender", "dock", "disconnect", "defeat", "attack"} {
		t.Run(action, func(t *testing.T) {
			s, p, socket, npc := waitingEncounter(t)
			item := p.ship.CargoContents[0]
			npc.loot = []simulation.Entity{item}
			npc.state, npc.cargoAccepted = pirateCollecting, true
			s.pirateLootCollected([]protocol.SimulationEvent{protocol.ItemCollected{By: p.playerID, ItemID: item.Base().ID}})
			socket.frames = nil

			switch action {
			case "surrender":
				p.ship.CargoRelease()
			case "dock":
				p.ship.DockedTo = &npc.homeID
			case "disconnect":
				p.socket = nil
			case "defeat":
				for _, module := range npc.ship.Modules() {
					if module.ModuleBase().Spec.Behavior == "cargoHatch" {
						module.ModuleBase().Mount.Health = 0
					}
				}
			case "attack":
				s.pirateHits([]protocol.SimulationEvent{protocol.LaserDamage{By: p.playerID, TargetID: npc.ship.ID, Damage: 3}})
			}

			s.updatePirates()

			if npc.reDemandAfter != 0 {
				t.Fatal("interruption left a pending re-demand")
			}

			s.World.Tick += 3 * 30
			s.updatePirates()

			if chatCount(socket, "Give that back or I'll open fire.") != 0 || hasPirateCargoAction(t, s, socket, npc) {
				t.Fatal("interrupted sequence sent a delayed re-demand or cargo action")
			}
		})
	}
}

func TestPirateIgnoresItsOwnAndUnclaimedPickups(t *testing.T) {
	s, p, socket, npc := waitingEncounter(t)
	item := p.ship.CargoContents[0]
	npc.loot = []simulation.Entity{item}
	npc.state, npc.cargoAccepted = pirateCollecting, true

	s.pirateLootCollected([]protocol.SimulationEvent{
		protocol.ItemCollected{By: *npc.ship.PlayerID, ItemID: item.Base().ID},
		protocol.ItemCollected{By: p.playerID, ItemID: -999},
	})

	if npc.reDemandAfter != 0 || chatCount(socket, "Hey, that was my haul!") != 0 {
		t.Fatal("pirate accused someone of stealing an unrelated or self-collected item")
	}
}
