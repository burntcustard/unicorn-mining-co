package network

import (
	"math"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

// Transient audio comes from the authoritative events, including actions that
// begin and finish between snapshots. UI actions never enter this stream.
func (s *GameSession) worldSounds(events []protocol.SimulationEvent) []protocol.WorldSound {
	var sounds []protocol.WorldSound

	playerSound := func(effect byte, by int64) {
		s.players.ForEach(func(p *playerRecord, _ string) {
			if p.playerID == by {
				sounds = append(sounds, protocol.WorldSound{Effect: effect, ID: p.shipID, By: by, Position: p.ship.Position})
			}
		})
	}

	owner := func(id int64) int64 {
		var by int64

		if entity, ok := s.World.Entities.Get(id); ok && entity.Base().PlayerID != nil {
			by = *entity.Base().PlayerID
		}

		s.players.ForEach(func(p *playerRecord, _ string) {
			if p.shipID == id {
				by = p.playerID
			}
		})

		return by
	}

	for index, event := range events {
		switch event := event.(type) {
		case protocol.ItemCollected:
			playerSound(2, event.By)
		case protocol.ModuleChanged:
			switch event.Module {
			case "cargoHatch":
				effect := byte(1)

				if event.Active {
					effect = 0
				}

				playerSound(effect, event.PlayerID)
			case "shieldGenerator":
				effect := byte(7)

				if event.Active {
					effect = 6
				}

				playerSound(effect, event.PlayerID)
			case "searchLight":
				playerSound(9, event.PlayerID)
			}
		case protocol.CollisionEvent:
			if event.Impact >= 40 {
				for side, id := range []int64{event.A, event.B} {
					by := owner(id)

					if event.Damage[side] > 0 && by != 0 {
						sounds = append(sounds, protocol.WorldSound{Effect: 3, ID: id, By: by, Position: event.Position})
					}
				}
			}
		case protocol.AsteroidSplit, protocol.AsteroidDestroyed:
			var id, by int64

			switch event := event.(type) {
			case protocol.AsteroidSplit:
				id = event.AsteroidID
			case protocol.AsteroidDestroyed:
				id, by = event.AsteroidID, event.By
			}

			position := Vec.Vector{}
			found := false
			gap := math.MaxInt

			// Match the nearest event on this asteroid, so simultaneous miners keep
			// separate attribution. Collision records can follow their fracture.
			for candidateIndex, candidate := range events {
				delta := candidateIndex - index

				if delta < 0 {
					delta = -delta
				}

				if delta >= gap {
					continue
				}

				var contact Vec.Vector
				var contactBy int64
				match := false

				switch candidate := candidate.(type) {
				case protocol.DrillDamage:
					match, contact, contactBy = candidate.TargetID == id, candidate.Position, candidate.By
				case protocol.LaserDamage:
					match, contact, contactBy = candidate.TargetID == id, candidate.Position, candidate.By
				case protocol.CollisionEvent:
					match, contact = candidate.A == id || candidate.B == id, candidate.Position

					if candidate.A == id {
						contactBy = owner(candidate.B)
					} else {
						contactBy = owner(candidate.A)
					}
				}

				if match {
					position, found, gap = contact, true, delta

					if _, destroyed := event.(protocol.AsteroidDestroyed); !destroyed {
						by = contactBy
					}
				}
			}

			if !found {
				if entity, ok := s.World.Entities.Get(id); ok {
					position, found = entity.Base().Position, true
				}
			}

			if found {
				sounds = append(sounds, protocol.WorldSound{Effect: 4, ID: id, By: by, Position: position})
			}
		}
	}

	return sounds
}

func (s *GameSession) sendWorldSounds(events []protocol.SimulationEvent) {
	sounds := s.worldSounds(events)

	if len(sounds) == 0 {
		return
	}

	reach := s.World.Specification.Simulation.Replication.EntityUnload

	s.players.ForEach(func(p *playerRecord, _ string) {
		if p.socket == nil || !p.socket.IsOpen() || p.needsLoad || p.welcomePending || !s.World.Players.Has(p.playerID) || p.socket.BufferedBytes() > MaxSnapshotBuffer {
			return
		}

		var nearby []protocol.WorldSound

		for _, sound := range sounds {
			dx, dy := sound.Position.X-p.ship.Position.X, sound.Position.Y-p.ship.Position.Y

			if sound.By == p.playerID || dx*dx+dy*dy <= reach*reach {
				nearby = append(nearby, sound)
			}
		}

		if len(nearby) > 0 {
			s.sendControl(p.socket, protocol.ServerControl{Type: "sounds", Sounds: nearby})
		}
	})
}
