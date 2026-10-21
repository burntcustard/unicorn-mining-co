package network

import (
	"bytes"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
)

func TestPirateEquipmentDefeat(t *testing.T) {
	for _, equipment := range []string{"cargoHatch", "cannonSm"} {
		for _, state := range []int{pirateWaiting, pirateFighting, pirateCollecting, pirateSearch, pirateReturning} {
			t.Run(equipment+"/"+pirateStateNames[state], func(t *testing.T) {
				s, p, socket, npc := waitingEncounter(t)
				npc.state = state
				npc.aggressors[p.playerID] = true
				npc.input.Fire = true
				npc.attackAfter, npc.tauntAfter, npc.collectAfter = 10, 20, 30
				npc.searchExpired = true
				npc.loot = append(npc.loot, p.ship.CargoContents...)
				npc.thinkAfter = 1e9
				damaged := 0

				for _, module := range npc.ship.Modules() {
					data := module.ModuleBase()

					if data.Type != equipment && data.Spec.Behavior != equipment {
						continue
					}

					npc.ship.SetModuleActive(data.Type, true)
					objects.Damage(npc.ship.SegmentsAtMount(data.Mount)[0], 10000)
					damaged++

					if equipment == "cannonSm" && damaged == 1 {
						s.updatePirates()

						if npc.defeated || chatCount(socket, "You win this time, I'm leaving!") != 0 {
							t.Fatal("losing one cannon defeated the pirate")
						}
					}
				}

				if damaged == 0 {
					t.Fatal("fixture did not damage any equipment")
				}

				s.updatePirates()

				if !npc.defeated || npc.state != pirateReturning || npc.input.Fire || npc.input.AutogunActive || len(npc.aggressors) != 0 || len(npc.loot) != 0 || npc.collectAfter != 0 || npc.attackAfter != 0 || npc.tauntAfter != 0 {
					t.Fatalf("defeat did not end combat and collection: state=%s input=%+v", pirateStateNames[npc.state], npc.input)
				}

				cleared, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: new(int64)}, s.World.Specification.Protocol)

				if err != nil || !slices.ContainsFunc(socket.frames, func(frame []byte) bool { return bytes.Equal(frame, cleared) }) {
					t.Fatal("defeat did not clear the cargo demand")
				}

				s.pirateHits([]protocol.SimulationEvent{protocol.LaserDamage{By: p.playerID, TargetID: npc.ship.ID, Damage: 3}})
				s.World.Tick += pirateDecisionTicks(s)
				s.updatePirates()

				if npc.state != pirateReturning || npc.input.Fire || len(npc.aggressors) != 0 || chatCount(socket, "You win this time, I'm leaving!") != 1 {
					t.Fatal("defeated pirate resumed fighting or repeated its defeat message")
				}

				for range 30 * 120 {
					if npc.state == pirateDocked {
						break
					}

					advanceEncounter(s, socket)
				}

				if npc.ship.Dead || npc.ship.DockedTo == nil || *npc.ship.DockedTo != npc.homeID || npc.state != pirateDocked || s.World.Entities.Has(npc.ship.ID) {
					t.Fatalf("defeated pirate did not dock at its start station: state=%s position=%v home=%v", pirateStateNames[npc.state], npc.ship.Position, npc.home.Position)
				}
			})
		}
	}
}
