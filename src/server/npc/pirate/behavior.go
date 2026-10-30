package pirate

import (
	ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"strconv"
)

func (m *Manager) inputFor(npc *pirate) protocol.Input {
	ship, world := npc.ship, m.World
	rules := &world.Specification.PirateSpec
	victim := npc.victim.Ship()
	input := protocol.Input{AutogunActive: true}

	enemy := ai.NearestEnemy(ship, npc.aggressors)
	now := float64(world.Tick) * world.Specification.Simulation.SimulationStep

	if enemy == nil && npc.State >= collecting {
		npc.AttackAfter = 0
	}

	if enemy != nil && npc.State != fighting && npc.AttackAfter == 0 && npc.TauntAfter == 0 {
		m.beginAttack(npc, now, m.retaliationDialog(npc, *enemy.PlayerID))
	}

	announcing := now+1e-9 < npc.AttackAfter
	m.combatDialog(npc, enemy != nil && !announcing, now)

	if enemy != nil && !announcing {
		if npc.State != stranded {
			npc.State = fighting
		}

		npc.CollectAfter = 0
		target := enemy.Base()
		// Lead kinetic shots with the target's relative motion.
		flight := Vec.Distance(ship.Position, target.Position) / world.Specification.ModuleSpecs["cannonSm"].Projectile.Speed
		aim := Vec.AddScaled(target.Position, Vec.Subtract(target.Velocity, ship.Velocity), min(flight, rules.AimPredictionTime))
		input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: target.Position, Velocity: target.Velocity, PassDistance: rules.PassDistance, TargetID: target.ID})
		angle := math.Remainder(math.Atan2(aim.Y-ship.Position.Y, aim.X-ship.Position.X)-ship.Rotation, 2*math.Pi)
		input.Fire = math.Abs(angle) < rules.AimTolerance && Vec.DistanceSquared(ship.Position, target.Position) < rules.FiringDistance*rules.FiringDistance
		return input
	}

	if npc.State == stranded {
		return input
	}

	if npc.CollectAfter > 0 {
		input.AutogunActive, input.CargoHatch = false, false
		input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: npc.Destination, Waiting: true})
		return input
	}

	if npc.State == waiting || announcing {
		if enemy == nil && !npc.VictimVisible {
			input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: npc.Destination, Waiting: true})
			return input
		}

		target := victim

		if announcing && enemy != nil {
			target = enemy
		}

		distance := Vec.Distance(ship.Position, target.Position)

		if distance > rules.FollowStartDistance {
			npc.Following = true
		} else if distance <= rules.FollowDistance+8 && Vec.Length(target.Velocity) < 10 && Vec.Length(Vec.Subtract(ship.Velocity, target.Velocity)) < 10 {
			npc.Following = false
		}

		input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: target.Position, Velocity: target.Velocity, TargetID: target.ID, FollowDistance: rules.FollowDistance, Waiting: !npc.Following})
		return input
	}

	if npc.State == search {
		input.Thrust, input.Turn = npc.pilot.Search(ship, &npc.Search)
		return input
	}

	if npc.State == pursuing {
		movement := ai.Movement{Position: npc.Destination}

		if npc.VictimVisible && (len(npc.aggressors) == 0 || npc.aggressors[npc.victim.ObserverID()]) {
			movement.Velocity, movement.FollowDistance = victim.Velocity, rules.FollowDistance
			movement.TargetID = victim.ID
		}

		input.Thrust, input.Turn = npc.pilot.Steer(ship, movement)
		return input
	}

	if npc.State == collecting {
		var nearest simulation.Entity
		best := math.Inf(1)
		waitingForRelease := false
		loot := npc.loot[:0]

		for _, item := range npc.loot {
			held := slices.Contains(victim.CargoContents, item)
			loose := m.Environment.Entity(item.Base().ID) != nil

			if !held && (item.Base().Dead || !loose) {
				continue
			}

			loot = append(loot, item)
			waitingForRelease = waitingForRelease || held

			if !loose || nearest != nil && nearest == npc.lootTarget {
				continue
			}

			if distance := Vec.DistanceSquared(ship.Position, item.Base().Position); item == npc.lootTarget || distance < best {
				nearest, best = item, distance
			}
		}

		clear(npc.loot[len(loot):])
		npc.loot, npc.lootTarget = loot, nearest

		if nearest != nil && len(ship.CargoContents) < ship.CargoSpace {
			input.CargoHatch = ai.CollectionHatch(ship, nearest.Base().Position)
			input.AutogunActive = false
			input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: nearest.Base().Position, Velocity: nearest.Base().Velocity, IgnoreID: nearest.Base().ID, Collect: true})
			return input
		}

		full := len(ship.CargoContents) >= ship.CargoSpace

		if !full && victim.ReleasingCargo() && waitingForRelease {
			input.AutogunActive = false
			input.CargoHatch = ai.CollectionHatch(ship, victim.Position)
			return input
		}

		if full {
			m.chat(npc, world.Specification.PirateDialog.CargoFull)
		} else if slices.ContainsFunc(ship.CargoContents, func(item simulation.Entity) bool { return item != npc.ammunition && item.Base().Price > 0 }) {
			m.chat(npc, world.Specification.PirateDialog.SuccessfulHaul, "{player_name}", victim.Name)
		}

		npc.State = returning
	}

	if npc.State == returning {
		input.AutogunActive = false

		movement := npc.pilot.ReturnMovement(ship, ai.Movement{Position: npc.Home.Position, TargetID: npc.HomeID})
		input.Thrust, input.Turn = npc.pilot.Steer(ship, movement)
	}

	return input
}

/*
observe remembers only visible positions, then searches the last reported area.
Search can acquire a different player, while existing hostility is retained.
*/
func (m *Manager) observe(npc *pirate, now float64) {
	returningFromSearch := npc.State == returning && npc.SearchExpired

	if npc.State > search && !returningFromSearch {
		return
	}

	npc.VictimVisible = npc.victim.Ship().ID == npc.VictimShipID && m.seesPlayer(npc, npc.victim)
	npc.PlayerSeen = npc.PlayerSeen || npc.VictimVisible

	if npc.CollectAfter > 0 || npc.ReDemandAfter > 0 {
		return
	}

	enemy := ai.NearestEnemy(npc.ship, npc.aggressors)

	if now+1e-9 < npc.AttackAfter {
		if enemy != nil {
			npc.Destination = enemy.Position
		}

		return
	}

	if !npc.VictimVisible && (npc.State == waiting || npc.State == fighting) && !npc.victim.Ship().ReleasingCargo() {
		m.cargoDemand(npc, false)
		npc.State = pursuing
	}

	if enemy != nil {
		if returningFromSearch {
			npc.SpawnedAt = now
		}

		npc.SearchExpired = false
		npc.PlayerSeen = true
		npc.Destination = enemy.Position
		npc.State = fighting
		return
	}

	if npc.VictimVisible && (len(npc.aggressors) == 0 || npc.aggressors[npc.victim.ObserverID()]) {
		npc.Destination = npc.victim.Ship().Position

		if returningFromSearch {
			npc.SpawnedAt = now
		}

		if npc.State == search || returningFromSearch {
			npc.State = pursuing
		}

		npc.SearchExpired = false

		if npc.aggressors[npc.victim.ObserverID()] {
			npc.State = fighting
		}

		return
	}

	if npc.State == fighting || npc.State == waiting {
		npc.State = pursuing
	}

	arrivalDistance := m.World.Specification.PirateSpec.ReportArrivalDistance

	if npc.State == pursuing && Vec.DistanceSquared(npc.ship.Position, npc.Destination) <= arrivalDistance*arrivalDistance {
		npc.State, npc.SearchStartedAt = search, now
		npc.Search = ai.Search{Origin: npc.Destination, Heading: npc.ship.Rotation}

		if npc.PlayerSeen {
			m.chat(npc, m.World.Specification.PirateDialog.LostPlayer)
		} else {
			m.chat(npc, m.World.Specification.PirateDialog.Search)
		}

		return
	}

	if npc.State != search && !returningFromSearch {
		return
	}

	var found ai.Player
	distance := math.Inf(1)

	m.Environment.Players(func(p ai.Player) {
		d := Vec.DistanceSquared(npc.ship.Position, p.Ship().Position)

		if d < distance && (len(npc.aggressors) == 0 || npc.aggressors[p.ObserverID()]) && m.seesPlayer(npc, p) {
			found, distance = p, d
		}
	})

	if found != nil {
		if returningFromSearch {
			npc.SpawnedAt = now
		}

		npc.SearchExpired = false

		if npc.victim.AccountID() != found.AccountID() {
			npc.victim.SetEncounterAfter(m.World.Tick + uint64(m.World.Specification.PirateSpec.EncounterCooldown/m.World.Specification.Simulation.SimulationStep))
		}

		if npc.victim.AccountID() != found.AccountID() || npc.VictimShipID != found.Ship().ID {
			npc.loot = nil
			npc.VictimReleasingCargo = false
			npc.CargoAccepted = false
		}

		npc.victim, npc.VictimShipID = found, found.Ship().ID
		npc.PlayerSeen = true
		npc.State, npc.Destination, npc.VictimVisible = pursuing, found.Ship().Position, true
	} else if npc.State == search && now-npc.SearchStartedAt+1e-9 >= m.World.Specification.PirateSpec.SearchDuration {
		m.chat(npc, m.World.Specification.PirateDialog.SearchExpired)
		npc.State, npc.loot = returning, nil
		npc.SearchExpired = true
	}
}

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
updateAttack finishes the pause or resumes the interrupted activity when
the last aggressor leaves. Living enemies outside sight remain hostile.
*/
func (m *Manager) updateAttack(npc *pirate, now float64) {
	for id := range npc.aggressors {
		player, present := m.World.Players.Get(id)
		entity, loaded := m.World.Entities.Get(player.ShipID)

		if !present || !loaded || entity.Base().Dead {
			delete(npc.aggressors, id)
		}
	}

	if len(npc.aggressors) == 0 && (npc.AttackAfter > 0 || npc.TauntAfter > 0) {
		npc.AttackAfter, npc.TauntAfter = 0, 0

		if npc.State == fighting || npc.State == waiting && npc.CollectAfter == 0 {
			if npc.CargoAccepted {
				m.beginCollection(npc, now)
			} else {
				npc.State, npc.ThinkAfter = pursuing, 0
			}
		}
	}

	if npc.State == waiting && npc.AttackAfter > 0 && now+1e-9 >= npc.AttackAfter {
		npc.State, npc.ThinkAfter = fighting, 0
	}
}

/*
beginCollection accepts a truce and waits before opening the cargo hatches.
Hostility toward other players retains its existing attack delay.
*/
func (m *Manager) beginCollection(npc *pirate, now float64) {
	npc.ReDemandAfter = 0
	npc.State, npc.ThinkAfter, npc.Countdown = waiting, 0, -1
	npc.CollectAfter = now + m.World.Specification.PirateSpec.CollectDelay
	npc.CargoAccepted = true

	if len(npc.aggressors) == 0 {
		npc.AttackAfter, npc.TauntAfter = 0, 0
	}
}

/*
beginAttack announces a new fight and holds fire for the configured pause.
The debug state follows the same phase as the held movement and weapon inputs.
*/
func (m *Manager) beginAttack(npc *pirate, now float64, lines []string) {
	npc.ReDemandAfter = 0

	if npc.State != stranded {
		npc.State = waiting
	}

	npc.AttackAfter = now + m.World.Specification.PirateSpec.AttackDelay
	npc.CollectAfter, npc.ThinkAfter, npc.Countdown = 0, 0, -1
	npc.Input.Fire = false
	npc.ship.NPCState = stateNames[npc.State]
	m.chat(npc, lines)
}

/*
retaliationDialog distinguishes a broken cargo truce from an unsolicited attack.
*/
func (m *Manager) retaliationDialog(npc *pirate, attacker int64) []string {
	dialog := &m.World.Specification.PirateDialog

	if npc.collecting() {
		if attacker == npc.victim.ObserverID() {
			return dialog.BrokenTruce
		}

		return dialog.DefendLoot
	}

	return dialog.Attack
}

func (m *Manager) Hits(events []protocol.SimulationEvent) {
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
		attacker, ok := m.World.Players.Get(by)

		if !ok {
			continue
		}

		entity, ok := m.World.Entities.Get(attacker.ShipID)

		if !ok {
			continue
		}

		source, ok := entity.(*objects.Ship)

		if !ok || source.Dead || source.DockedTo != nil || source.Launching != 0 || source.TransitTime != 0 {
			continue
		}

		for _, npc := range m.Pirates {
			if npc.ship.ID != target || by == *npc.ship.PlayerID || npc.ship.Dead || npc.ship.DockedTo != nil || npc.Defeated {
				continue
			}

			ongoing := npc.State == fighting || npc.AttackAfter > 0 || npc.TauntAfter > 0
			lines := m.retaliationDialog(npc, by)
			npc.aggressors[by] = true
			npc.ThinkAfter = 0

			if npc.collecting() || !ongoing {
				now := float64(m.World.Tick) * m.World.Specification.Simulation.SimulationStep
				m.beginAttack(npc, now, lines)
			}
		}
	}
}

/*
Run the cargo-demand countdown, pausing around its final ellipsis before
announcing an attack and starting the shared combat delay.
*/
func (m *Manager) updateWarning(npc *pirate, now float64) {
	if npc.CollectAfter > 0 || npc.AttackAfter > 0 {
		return
	}

	dialog := &m.World.Specification.PirateDialog
	rules := &m.World.Specification.PirateSpec

	if npc.ReDemandAfter > 0 {
		if now+1e-9 < npc.ReDemandAfter {
			return
		}

		npc.WarnedAt = npc.ReDemandAfter + rules.ReDemandDelay - rules.DemandDelay
		npc.ReDemandAfter = 0
		npc.Countdown = rules.CountdownFrom + 1
		m.chat(npc, dialog.CargoReDemand)
		m.cargoDemand(npc, true)
	}

	elapsed := now - npc.WarnedAt + 1e-9
	remaining := int(math.Ceil(rules.DemandDelay + float64(rules.CountdownFrom) - elapsed))
	end := rules.DemandDelay + float64(rules.CountdownFrom-1) + rules.CountdownPause

	if remaining <= rules.CountdownFrom && remaining > 0 && remaining < npc.Countdown {
		npc.Countdown = remaining
		m.chat(npc, dialog.Countdown, "{seconds}", strconv.Itoa(remaining))
	}

	if elapsed >= end && npc.Countdown > 0 {
		npc.Countdown = 0
		m.chat(npc, dialog.CountdownEnd)
	}

	if elapsed >= end+rules.CountdownPause && npc.Countdown == 0 {
		npc.aggressors[npc.victim.ObserverID()] = true
		m.beginAttack(npc, now, dialog.Attack)
	}
}

/*
Taunts follow the encounter's combat clock, retaining it across target changes
and temporary pursuit while an aggressor is out of sight.
*/
func (m *Manager) combatDialog(npc *pirate, attacking bool, now float64) {
	if !attacking {
		if len(npc.aggressors) == 0 || npc.State >= collecting {
			npc.TauntAfter = 0
		}

		return
	}

	if npc.TauntAfter == 0 {
		npc.TauntAfter = now + m.World.Specification.PirateSpec.TauntInterval
	} else if now+1e-9 >= npc.TauntAfter {
		m.chat(npc, m.World.Specification.PirateDialog.Taunt)
		npc.TauntAfter = now + m.World.Specification.PirateSpec.TauntInterval
	}
}

/*
collecting includes the pause after surrender, when the loot is already claimed.
*/
func (npc *pirate) collecting() bool {
	return npc.State == collecting || npc.CollectAfter > 0
}

/*
ItemsCollected reacts to actual pickups before the next decision can prune
collected items. Cargo still waiting to be released is not treated as stolen.
*/
func (m *Manager) ItemsCollected(events []protocol.SimulationEvent) {
	for _, event := range events {
		pickup, ok := event.(protocol.ItemCollected)

		if !ok {
			continue
		}

		var collector ai.Player

		m.Environment.Players(func(p ai.Player) {
			if p.ObserverID() == pickup.By {
				collector = p
			}
		})

		if collector == nil || !collector.Connected() || collector.Ship().Dead || collector.Ship().DockedTo != nil || collector.Ship().TransitTime != 0 {
			continue
		}

		for _, npc := range m.Pirates {
			if npc.Defeated || npc.ship.Dead || npc.ship.DockedTo != nil || !npc.CargoAccepted || !npc.collecting() || !slices.ContainsFunc(npc.loot, func(item simulation.Entity) bool { return item.Base().ID == pickup.ItemID }) {
				continue
			}

			m.cargoDemand(npc, false)

			if npc.victim.AccountID() != collector.AccountID() {
				npc.victim.SetEncounterAfter(m.World.Tick + uint64(m.World.Specification.PirateSpec.EncounterCooldown/m.World.Specification.Simulation.SimulationStep))
			}

			npc.victim, npc.VictimShipID = collector, collector.Ship().ID
			npc.VictimVisible = m.seesPlayer(npc, collector)
			npc.Destination = collector.Ship().Position
			npc.VictimReleasingCargo = collector.Ship().ReleasingCargo()
			npc.State, npc.ThinkAfter, npc.Countdown = waiting, 0, -1
			npc.CollectAfter, npc.AttackAfter, npc.TauntAfter = 0, 0, 0
			npc.CargoAccepted, npc.SearchExpired, npc.Following = false, false, false
			npc.SpawnedAt = float64(m.World.Tick) * m.World.Specification.Simulation.SimulationStep
			npc.ReDemandAfter = npc.SpawnedAt + m.World.Specification.PirateSpec.LootTheftDelay
			clear(npc.aggressors)
			npc.Input.Fire = false
			npc.ship.NPCState = stateNames[npc.State]
			m.chat(npc, m.World.Specification.PirateDialog.LootStolen)
		}
	}
}
