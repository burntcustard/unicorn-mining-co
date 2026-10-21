package network

import (
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

/*
collecting includes the pause after surrender, when the loot is already claimed.
*/
func (npc *pirate) collecting() bool {
	return npc.state == pirateCollecting || npc.collectAfter > 0
}

/*
pirateLootCollected reacts to actual pickups before the next decision can prune
collected items. Cargo still waiting to be released is not treated as stolen.
*/
func (s *GameSession) pirateLootCollected(events []protocol.SimulationEvent) {
	for _, event := range events {
		pickup, ok := event.(protocol.ItemCollected)

		if !ok {
			continue
		}

		var collector *playerRecord
		s.sectorPlayers(func(p *playerRecord, _ string) {
			if p.playerID == pickup.By {
				collector = p
			}
		})

		if collector == nil || collector.socket == nil || collector.ship.Dead || collector.ship.DockedTo != nil || collector.ship.TransitTime != 0 {
			continue
		}

		for _, npc := range s.sectors[s.currentSector].pirates {
			if npc.defeated || npc.ship.Dead || npc.ship.DockedTo != nil || !npc.cargoAccepted || !npc.collecting() || !slices.ContainsFunc(npc.loot, func(item simulation.Entity) bool { return item.Base().ID == pickup.ItemID }) {
				continue
			}

			s.pirateCargoDemand(npc, false)

			if npc.victim != collector {
				npc.victim.pirateAfter = s.World.Tick + uint64(s.World.Specification.PirateSpec.EncounterCooldown/s.World.Specification.Simulation.SimulationStep)
			}

			npc.victim, npc.victimShipID = collector, collector.shipID
			npc.victimVisible = s.pirateSeesPlayer(npc, collector)
			npc.destination = collector.ship.Position
			npc.victimReleasingCargo = collector.ship.ReleasingCargo()
			npc.state, npc.thinkAfter, npc.countdown = pirateWaiting, 0, -1
			npc.collectAfter, npc.attackAfter, npc.tauntAfter = 0, 0, 0
			npc.cargoAccepted, npc.searchExpired, npc.following = false, false, false
			npc.spawnedAt = float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep
			npc.reDemandAfter = npc.spawnedAt + s.World.Specification.PirateSpec.LootTheftDelay
			clear(npc.aggressors)
			npc.input.Fire = false
			npc.ship.NPCState = pirateStateNames[npc.state]
			s.pirateChat(npc, s.World.Specification.PirateDialog.LootStolen)
		}
	}
}
