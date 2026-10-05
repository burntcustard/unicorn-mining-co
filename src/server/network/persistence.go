package network

import (
	"context"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"slices"
	"time"
)

type changedEntity struct {
	entity             simulation.Entity
	generated, deleted bool
}

type sessionPersistence struct {
	generationDigest  string
	store             *persistence.Store
	sequence          uint64
	entities          map[int64]changedEntity
	players           map[*playerRecord]bool
	checkpoint        []simulation.Entity
	checkpointPlayers []*playerRecord
	nextCheckpoint    time.Time
}

// EnablePersistence restores before accepting connections. Corrupt or
// incompatible data fails startup rather than silently starting a new world.
func (s *GameSession) EnablePersistence(store *persistence.Store) error {
	saved, err := store.Load(s.worldSeed)

	if err != nil {
		return err
	}

	if saved.World != nil {
		w := saved.World

		if w.GenerationDigest != persistence.GenerationDigest(s.World.Specification) {
			return fmt.Errorf("world generation rules changed; use a fresh world database before starting")
		}

		s.World.Tick, s.World.Random.State = w.Tick, w.RandomState
		s.World.NextEntityID, s.World.NextObjectID = w.NextEntityID, w.NextObjectID

		for _, e := range saved.Entities {
			if e.Deleted {
				if e.Generated {
					s.regions.regions.Remove(uint32(e.ID))
				}

				continue
			}

			entity, err := objects.RestoreEntity(e.State, s.World)

			if err != nil {
				return fmt.Errorf("restore entity %d: %w", e.ID, err)
			}

			s.regions.sleeping.Set(e.ID, entity)

			if e.Generated {
				s.regions.managed.Set(e.ID, true)
			}
		}

		for _, profile := range saved.Players {
			id := s.nextPlayerID
			s.nextPlayerID++
			ship, err := objects.RestoreShip(profile.Ship, s.World, id)

			if err != nil {
				return fmt.Errorf("restore player %s: %w", profile.ID, err)
			}

			now := s.now()

			p := &playerRecord{profile: profile, playerID: id, ship: ship, shipID: ship.ID, hiddenShip: !ship.Dead, disconnectedAt: &now,
				inputs: make([]queuedInputs, s.World.Specification.Simulation.MaxPredictionTicks+1), binaryReplication: NewBinaryReplicationManager(s.World.Specification)}

			ship.Fly(0, 0)
			p.profile.Ship = objects.SavedShip{}
			s.players.Set(profile.ID, p)
		}

		for _, e := range saved.Entities {
			if e.Deleted || e.State.Object.LocalMovementParent == 0 {
				continue
			}

			entity, ok := s.regions.sleeping.Get(e.ID)
			parent, hasParent := s.regions.sleeping.Get(e.State.Object.LocalMovementParent)

			if ok && hasParent {
				entity.Base().LocalMovementParent = parent
			}
		}
	} else {
		// Procedural IDs are uint32; runtime objects occupy a separate range.
		s.World.NextEntityID = 1 << 32
	}

	s.persistence = &sessionPersistence{generationDigest: persistence.GenerationDigest(s.World.Specification), store: store, entities: map[int64]changedEntity{}, players: map[*playerRecord]bool{}, nextCheckpoint: s.now().Add(30 * time.Second)}

	s.World.EntityChanged = func(e simulation.Entity, deleted bool) {
		if s.World.Loading {
			return
		}

		if e.Base().PlayerID != nil {
			s.players.ForEach(func(p *playerRecord, _ string) {
				if p.shipID == e.Base().ID {
					s.persistence.players[p] = true
				}
			})

			return
		}

		generated := s.regions.managed.Has(e.Base().ID)

		if deleted && generated {
			s.regions.regions.Remove(uint32(e.Base().ID))
		}

		s.persistence.entities[e.Base().ID] = changedEntity{e, generated, deleted}
	}

	s.regions.onSleep = func(e simulation.Entity) {
		s.persistence.entities[e.Base().ID] = changedEntity{e, s.regions.managed.Has(e.Base().ID), false}
	}

	store.Start()
	return nil
}

func (s *GameSession) worldRecord() persistence.World {
	return persistence.World{Seed: s.worldSeed, GenerationDigest: s.persistence.generationDigest, Tick: s.World.Tick, RandomState: s.World.Random.State, NextEntityID: s.World.NextEntityID, NextObjectID: s.World.NextObjectID}
}

func (s *GameSession) accountTime(p *playerRecord) {
	if p.socket == nil {
		return
	}

	now := s.now()

	if !p.playedAt.IsZero() {
		p.profile.PlayedFor += max(0, now.Sub(p.playedAt).Seconds())
	}

	p.playedAt, p.profile.LastSeenAt = now, now
}

func (s *GameSession) savePlayer(p *playerRecord) {
	if s.persistence != nil {
		s.persistence.players[p] = true
	}
}

func (s *GameSession) capturePlayer(p *playerRecord) persistence.Player {
	s.accountTime(p)

	profile := p.profile
	profile.Visited = slices.Clone(profile.Visited)
	profile.Ship = objects.CaptureShip(p.ship)
	return profile
}

func (s *GameSession) flushChanges() bool {
	persist := s.persistence

	if persist == nil || len(persist.players)+len(persist.entities) == 0 {
		return true
	}

	if !persist.store.HasCapacity() {
		return false
	}

	batch := persistence.Batch{Sequence: persist.sequence + 1, World: s.worldRecord()}

	for p := range persist.players {
		batch.Players = append(batch.Players, s.capturePlayer(p))
	}

	for id, change := range persist.entities {
		e := persistence.Entity{ID: id, Generated: change.generated, Deleted: change.deleted}

		if !e.Deleted {
			e.State = objects.CaptureEntity(change.entity)
		}

		batch.Entities = append(batch.Entities, e)
	}

	if !persist.store.Submit(batch) {
		return false
	}

	persist.sequence = batch.Sequence

	for p := range persist.players {
		p.saveSequence = batch.Sequence
	}

	clear(persist.players)
	clear(persist.entities)
	return true
}

func (s *GameSession) persistenceReady() bool {
	return s.persistence == nil || s.persistence.store.Err() == nil && s.flushChanges()
}

func (s *GameSession) checkpoint() {
	persist := s.persistence

	if persist == nil {
		return
	}

	if !s.now().Before(persist.nextCheckpoint) && len(persist.checkpoint)+len(persist.checkpointPlayers) == 0 {
		persist.checkpoint = s.World.Entities.Values()

		s.players.ForEach(func(p *playerRecord, _ string) {
			if p.socket != nil {
				persist.checkpointPlayers = append(persist.checkpointPlayers, p)
			}
		})

		persist.nextCheckpoint = s.now().Add(30 * time.Second)
	}

	// Spread copying across ticks rather than serializing the world at once.
	for budget := 0; budget < 8 && len(persist.checkpoint) > 0; budget++ {
		e := persist.checkpoint[0]
		persist.checkpoint[0] = nil
		persist.checkpoint = persist.checkpoint[1:]

		if e.Base().PlayerID != nil || e.Base().Dead {
			continue
		}

		persist.entities[e.Base().ID] = changedEntity{e, s.regions.managed.Has(e.Base().ID), false}
	}

	if len(persist.checkpointPlayers) > 0 {
		p := persist.checkpointPlayers[0]
		persist.checkpointPlayers[0] = nil
		persist.checkpointPlayers = persist.checkpointPlayers[1:]
		persist.players[p] = true
	}

	s.flushChanges()
}

func (s *GameSession) shutdownPersistence(ctx context.Context) error {
	if s.persistence == nil {
		return nil
	}

	// At shutdown the owner is stopped, so copying remaining active mechanics
	// cannot contend with simulation. Sleeping records are saved when unloaded.
	s.World.Entities.ForEach(func(e simulation.Entity, id int64) {
		if e.Base().PlayerID == nil {
			s.persistence.entities[id] = changedEntity{e, s.regions.managed.Has(id), false}
		}
	})

	s.players.ForEach(func(p *playerRecord, _ string) { s.savePlayer(p) })

	for !s.flushChanges() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}

	return nil
}

func (s *GameSession) unlockPaint(p *playerRecord, index uint8) {
	mask := uint8(1 << index)

	if p.profile.UnlockedPaints&mask != 0 {
		return
	}

	p.profile.UnlockedPaints |= mask
	p.progressPending = true
	s.savePlayer(p)
}

func (s *GameSession) progress(events []protocol.SimulationEvent) {
	byID := func(id int64) *playerRecord {
		var found *playerRecord

		s.players.ForEach(func(p *playerRecord, _ string) {
			if p.playerID == id {
				found = p
			}
		})

		return found
	}

	for _, event := range events {
		switch e := event.(type) {
		case protocol.ItemCollected:
			if p := byID(e.By); p != nil {
				s.savePlayer(p)

				if e.Unlock != nil {
					for i, name := range []string{"RED", "ORANGE", "YELLOW", "GREEN", "CYAN"} {
						if name == *e.Unlock {
							s.unlockPaint(p, uint8(i))
						}
					}
				}
			}
		case protocol.Docked:
			if p := byID(e.PlayerID); p != nil {
				s.savePlayer(p)

				p.profile.Visited = append(p.profile.Visited, e.DockedTo)

				if p.profile.UnlockedPaints&(1<<3) == 0 {
					crafts := make(map[int64]bool, 3)

					for _, craftID := range p.profile.Visited {
						crafts[craftID] = true

						if len(crafts) == 3 {
							s.unlockPaint(p, 3)
							break
						}
					}
				}
			}
		}
	}

	s.players.ForEach(func(p *playerRecord, _ string) {
		if p.ship.Dead {
			s.unlockPaint(p, 0)
		}
	})
}
