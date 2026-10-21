package network

import (
	"math"
	"strconv"
)

/*
Run the cargo-demand countdown, pausing around its final ellipsis before
announcing an attack and starting the shared combat delay.
*/
func (s *GameSession) updatePirateWarning(npc *pirate, now float64) {
	if npc.collectAfter > 0 || npc.attackAfter > 0 {
		return
	}

	dialog := &s.World.Specification.PirateDialog
	rules := &s.World.Specification.PirateSpec

	if npc.reDemandAfter > 0 {
		if now+1e-9 < npc.reDemandAfter {
			return
		}

		npc.warnedAt = npc.reDemandAfter + rules.ReDemandDelay - rules.DemandDelay
		npc.reDemandAfter = 0
		npc.countdown = rules.CountdownFrom + 1
		s.pirateChat(npc, dialog.CargoReDemand)
		s.pirateCargoDemand(npc, true)
	}

	elapsed := now - npc.warnedAt + 1e-9
	remaining := int(math.Ceil(rules.DemandDelay + float64(rules.CountdownFrom) - elapsed))
	end := rules.DemandDelay + float64(rules.CountdownFrom-1) + rules.CountdownPause

	if remaining <= rules.CountdownFrom && remaining > 0 && remaining < npc.countdown {
		npc.countdown = remaining
		s.pirateChat(npc, dialog.Countdown, "{seconds}", strconv.Itoa(remaining))
	}

	if elapsed >= end && npc.countdown > 0 {
		npc.countdown = 0
		s.pirateChat(npc, dialog.CountdownEnd)
	}

	if elapsed >= end+rules.CountdownPause && npc.countdown == 0 {
		npc.aggressors[npc.victim.playerID] = true
		s.beginPirateAttack(npc, now, dialog.Attack)
	}
}

/*
Taunts follow the encounter's combat clock, retaining it across target changes
and temporary pursuit while an aggressor is out of sight.
*/
func (s *GameSession) pirateCombatDialog(npc *pirate, attacking bool, now float64) {
	if !attacking {
		if len(npc.aggressors) == 0 || npc.state >= pirateCollecting {
			npc.tauntAfter = 0
		}

		return
	}

	if npc.tauntAfter == 0 {
		npc.tauntAfter = now + s.World.Specification.PirateSpec.TauntInterval
	} else if now+1e-9 >= npc.tauntAfter {
		s.pirateChat(npc, s.World.Specification.PirateDialog.Taunt)
		npc.tauntAfter = now + s.World.Specification.PirateSpec.TauntInterval
	}
}
