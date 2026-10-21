package network

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
)

/*
lostEquipment detects the loss of all cargo hatches or both cannons, even
before destroyed module segments have been removed from the ship.
*/
func (npc *pirate) lostEquipment() bool {
	hatch, cannon := false, false

	for _, segment := range npc.ship.Segments {
		if segment.Module == nil || *segment.TargetHealth() < 1 || segment.Mount.Hull.Health < 1 {
			continue
		}

		module := segment.Module.ModuleBase()
		hatch = hatch || module.Spec.Behavior == "cargoHatch"
		cannon = cannon || module.Type == "cannonSm"
	}

	return !hatch || !cannon
}

/*
updatePirateAttack finishes the pause or resumes the interrupted activity when
the last aggressor leaves. Living enemies outside sight remain hostile.
*/
func (s *GameSession) updatePirateAttack(npc *pirate, now float64) {
	for id := range npc.aggressors {
		player, present := s.World.Players.Get(id)
		entity, loaded := s.World.Entities.Get(player.ShipID)

		if !present || !loaded || entity.Base().Dead {
			delete(npc.aggressors, id)
		}
	}

	if len(npc.aggressors) == 0 && (npc.attackAfter > 0 || npc.tauntAfter > 0) {
		npc.attackAfter, npc.tauntAfter = 0, 0

		if npc.state == pirateFighting || npc.state == pirateWaiting && npc.collectAfter == 0 {
			if npc.cargoAccepted {
				s.beginPirateCollection(npc, now)
			} else {
				npc.state, npc.thinkAfter = piratePursuing, 0
			}
		}
	}

	if npc.state == pirateWaiting && npc.attackAfter > 0 && now+1e-9 >= npc.attackAfter {
		npc.state, npc.thinkAfter = pirateFighting, 0
	}
}

/*
beginPirateCollection accepts a truce and waits before opening the cargo hatches.
Hostility toward other players retains its existing attack delay.
*/
func (s *GameSession) beginPirateCollection(npc *pirate, now float64) {
	npc.reDemandAfter = 0
	npc.state, npc.thinkAfter, npc.countdown = pirateWaiting, 0, -1
	npc.collectAfter = now + s.World.Specification.PirateSpec.CollectDelay
	npc.cargoAccepted = true

	if len(npc.aggressors) == 0 {
		npc.attackAfter, npc.tauntAfter = 0, 0
	}
}

/*
beginPirateAttack announces a new fight and holds fire for the configured pause.
The debug state follows the same phase as the held movement and weapon inputs.
*/
func (s *GameSession) beginPirateAttack(npc *pirate, now float64, lines []string) {
	npc.reDemandAfter = 0
	if npc.state != pirateStranded {
		npc.state = pirateWaiting
	}

	npc.attackAfter = now + s.World.Specification.PirateSpec.AttackDelay
	npc.collectAfter, npc.thinkAfter, npc.countdown = 0, 0, -1
	npc.input.Fire = false
	npc.ship.NPCState = pirateStateNames[npc.state]
	s.pirateChat(npc, lines)
}

/*
pirateRetaliationDialog distinguishes a broken cargo truce from an unsolicited attack.
*/
func (s *GameSession) pirateRetaliationDialog(npc *pirate, attacker int64) []string {
	dialog := &s.World.Specification.PirateDialog

	if npc.collecting() {
		if attacker == npc.victim.playerID {
			return dialog.BrokenTruce
		}

		return dialog.DefendLoot
	}

	return dialog.Attack
}

func (s *GameSession) pirateHits(events []protocol.SimulationEvent) {
	for _, event := range events {
		var target, by int64

		switch hit := event.(type) {
		case protocol.CollisionEvent:
			if hit.By == 0 || hit.Damage[1] <= 0 {
				continue
			}

			target, by = hit.B, hit.By
		case protocol.LaserDamage:
			if hit.Damage <= 0 {
				continue
			}

			target, by = hit.TargetID, hit.By
		case protocol.DrillDamage:
			if hit.Damage <= 0 {
				continue
			}

			target, by = hit.TargetID, hit.By
		default:
			continue
		}

		// Shots fired before docking must not restart an escaped player's encounter.
		attacker, ok := s.World.Players.Get(by)

		if !ok {
			continue
		}

		entity, ok := s.World.Entities.Get(attacker.ShipID)

		if !ok {
			continue
		}

		source, ok := entity.(*objects.Ship)

		if !ok || source.Dead || source.DockedTo != nil || source.Launching != 0 || source.TransitTime != 0 {
			continue
		}

		for _, npc := range s.sectors[s.currentSector].pirates {
			if npc.ship.ID != target || by == *npc.ship.PlayerID || npc.ship.Dead || npc.ship.DockedTo != nil || npc.defeated {
				continue
			}

			ongoing := npc.state == pirateFighting || npc.attackAfter > 0 || npc.tauntAfter > 0
			lines := s.pirateRetaliationDialog(npc, by)
			npc.aggressors[by] = true
			npc.thinkAfter = 0

			if npc.collecting() || !ongoing {
				now := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep
				s.beginPirateAttack(npc, now, lines)
			}
		}
	}
}
