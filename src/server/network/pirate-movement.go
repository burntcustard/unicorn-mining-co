package network

import (
	"math"
	"slices"

	ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func (s *GameSession) pirateInput(npc *pirate) protocol.Input {
	ship, world := npc.ship, s.World
	rules := &world.Specification.PirateSpec
	victim := npc.victim.ship
	input := protocol.Input{AutogunActive: true, CargoHatch: true}

	enemy := ai.NearestEnemy(ship, npc.aggressors)
	now := float64(world.Tick) * world.Specification.Simulation.SimulationStep

	if enemy == nil && npc.state >= pirateCollecting {
		npc.attackAfter = 0
	}

	if enemy != nil && npc.state != pirateFighting && npc.attackAfter == 0 && npc.tauntAfter == 0 {
		s.beginPirateAttack(npc, now, s.pirateRetaliationDialog(npc, *enemy.PlayerID))
	}

	announcing := now+1e-9 < npc.attackAfter
	input.CargoHatch = !announcing
	s.pirateCombatDialog(npc, enemy != nil && !announcing, now)

	if enemy != nil && !announcing {
		if npc.state != pirateStranded {
			npc.state = pirateFighting
		}

		npc.collectAfter = 0
		target := enemy.Base()
		// Lead kinetic shots with the target's relative motion.
		flight := Vec.Distance(ship.Position, target.Position) / world.Specification.ModuleSpecs["cannonSm"].Projectile.Speed
		aim := Vec.AddScaled(target.Position, Vec.Subtract(target.Velocity, ship.Velocity), min(flight, rules.AimPredictionTime))
		input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: target.Position, Velocity: target.Velocity, PassDistance: rules.PassDistance, TargetID: target.ID})
		angle := math.Remainder(math.Atan2(aim.Y-ship.Position.Y, aim.X-ship.Position.X)-ship.Rotation, 2*math.Pi)
		input.Fire = math.Abs(angle) < rules.AimTolerance && Vec.DistanceSquared(ship.Position, target.Position) < rules.FiringDistance*rules.FiringDistance
		return input
	}

	if npc.state == pirateStranded {
		return input
	}

	if npc.collectAfter > 0 {
		input.AutogunActive, input.CargoHatch = false, false
		input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: npc.destination, Waiting: true})
		return input
	}

	if npc.state == pirateWaiting || announcing {
		if enemy == nil && !npc.victimVisible {
			input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: npc.destination, Waiting: true})
			return input
		}

		target := victim

		if announcing && enemy != nil {
			target = enemy
		}

		distance := Vec.Distance(ship.Position, target.Position)

		if distance > rules.FollowStartDistance {
			npc.following = true
		} else if distance <= rules.FollowDistance+8 && Vec.Length(target.Velocity) < 10 && Vec.Length(Vec.Subtract(ship.Velocity, target.Velocity)) < 10 {
			npc.following = false
		}

		input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: target.Position, Velocity: target.Velocity, TargetID: target.ID, FollowDistance: rules.FollowDistance, Waiting: !npc.following})
		return input
	}

	if npc.state == pirateSearch {
		input.Thrust, input.Turn = npc.pilot.Steer(ship, npc.search.Movement(ship))
		return input
	}

	if npc.state == piratePursuing {
		movement := ai.Movement{Position: npc.destination}

		if npc.victimVisible && (len(npc.aggressors) == 0 || npc.aggressors[npc.victim.playerID]) {
			movement.Velocity, movement.FollowDistance = victim.Velocity, rules.FollowDistance
			movement.TargetID = victim.ID
		}

		input.Thrust, input.Turn = npc.pilot.Steer(ship, movement)
		return input
	}

	if npc.state == pirateCollecting {
		npc.loot = slices.DeleteFunc(npc.loot, func(item simulation.Entity) bool {
			return !slices.Contains(victim.CargoContents, item) && (item.Base().Dead || !world.Entities.Has(item.Base().ID) && !s.regions.sleeping.Has(item.Base().ID))
		})

		var nearest simulation.Entity
		best := math.Inf(1)

		for _, item := range npc.loot {
			if world.Entities.Has(item.Base().ID) || s.regions.sleeping.Has(item.Base().ID) {
				if item == npc.lootTarget {
					nearest = item
					break
				}

				if d := Vec.DistanceSquared(ship.Position, item.Base().Position); d < best {
					nearest, best = item, d
				}
			}
		}

		npc.lootTarget = nearest

		if nearest != nil && len(ship.CargoContents) < ship.CargoSpace {
			input.CargoHatch = true
			input.AutogunActive = false
			input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: nearest.Base().Position, Velocity: nearest.Base().Velocity, IgnoreID: nearest.Base().ID, Collect: true})
			return input
		}

		full := len(ship.CargoContents) >= ship.CargoSpace

		if !full && victim.ReleasingCargo() && slices.ContainsFunc(npc.loot, func(item simulation.Entity) bool { return slices.Contains(victim.CargoContents, item) }) {
			input.AutogunActive = false
			input.CargoHatch = true
			return input
		}

		if full {
			s.pirateChat(npc, world.Specification.PirateDialog.CargoFull)
		} else if slices.ContainsFunc(ship.CargoContents, func(item simulation.Entity) bool { return item != npc.ammunition && item.Base().Price > 0 }) {
			s.pirateChat(npc, world.Specification.PirateDialog.SuccessfulHaul, "{player_name}", victim.Name)
		}

		npc.state = pirateReturning
	}

	if npc.state == pirateReturning {
		input.AutogunActive = false

		movement := ai.Movement{Position: npc.home.Position}

		if entity, ok := world.Entities.Get(npc.homeID); ok {
			if station, ok := entity.(*objects.Station); ok {
				movement = npc.pilot.DockingMovement(ship, station)
			}
		}

		input.Thrust, input.Turn = npc.pilot.Steer(ship, movement)
	}

	return input
}
