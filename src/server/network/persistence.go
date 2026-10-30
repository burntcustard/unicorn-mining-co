package network

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

type changedEntity struct {
	entity             simulation.Entity
	generated, deleted bool
	state              *objects.SavedEntity
}

type sessionPersistence struct {
	generationDigest  string
	store             *persistence.Store
	sequence          uint64
	entities          map[int64]changedEntity
	storedEntities    map[int64]bool
	npcs              map[int64]string
	players           map[*playerRecord]bool // True only for an immediate account or moderation commit.
	checkpoint        []simulation.Entity
	checkpointPlayers []*playerRecord
	nextCheckpoint    time.Time
	nextFlush         time.Time
	flushDeadline     time.Time
	tickStarted       time.Time
}

// EnablePersistence restores before accepting connections, skipping removed
// definitions while preserving saved accounts and the remaining world.
func (s *GameSession) EnablePersistence(store *persistence.Store) error {
	saved, err := store.Load(s.worldSeed)

	if err != nil {
		return err
	}

	stored := map[int64]bool{}
	npcs := map[int64]string{}
	var discarded []persistence.Entity

	if saved.World != nil {
		w := saved.World

		if !persistence.CompatibleGenerationDigest(s.World.Specification, w.GenerationDigest) {
			return fmt.Errorf("world generation rules changed; use a fresh world database before starting")
		}

		s.World.Tick, s.World.Random.State = w.Tick, w.RandomState
		s.World.NextEntityID, s.World.NextObjectID = w.NextEntityID, w.NextObjectID
		previous := s.currentSector

		for id, state := range w.Sectors {
			s.activateSector(id)
			s.World.Tick, s.World.Random.State = state.Tick, state.RandomState
			s.World.NextEntityID, s.World.NextObjectID = state.NextEntityID, state.NextObjectID
		}

		s.activateSector(previous)

		for _, e := range saved.Entities {
			s.activateSector(e.SectorID)

			if !e.Deleted && transientWorldObject(e.State.Object.Kind, e.State.Object.Decay) {
				discarded = append(discarded, persistence.Entity{SectorID: e.SectorID, ID: e.ID, Generated: e.Generated, Deleted: true})

				if e.Generated {
					s.regions.Procedural.Remove(uint32(e.ID))
				}

				continue
			}

			if e.Deleted {
				if e.Generated {
					s.regions.Procedural.Remove(uint32(e.ID))
				}

				continue
			}

			entity, err := objects.RestoreEntity(e.State, s.World)

			if err != nil {
				return fmt.Errorf("restore entity %d: %w", e.ID, err)
			}

			if entity == nil {
				discarded = append(discarded, persistence.Entity{SectorID: e.SectorID, ID: e.ID, Generated: e.Generated, Deleted: true})

				if e.Generated {
					s.regions.Procedural.Remove(uint32(e.ID))
				}

				continue
			}

			s.regions.Sleeping.Set(e.ID, entity)

			if !e.Generated {
				stored[e.ID] = true
			}

			if e.Generated {
				s.regions.Managed.Set(e.ID, true)
			}
		}

		for _, profile := range saved.Players {
			s.activateSector(profile.SectorID)
			id := s.nextPlayerID
			s.nextPlayerID++
			ship, err := objects.RestoreShip(profile.Ship, s.World, id)

			if err != nil {
				return fmt.Errorf("restore player %s: %w", profile.ID, err)
			}

			if ship == nil {
				// A removed hull leaves the account ready to respawn in a starter ship.
				ship = objects.CreatePlayerShip(s.World, objects.Properties{ObjectProperties: simulation.ObjectProperties{ID: &profile.Ship.ID, PlayerID: &id}})
				ship.Dead = true
			}

			now := s.now()

			p := &playerRecord{sectorID: s.currentSector, profile: profile, playerID: id, ship: ship, shipID: ship.ID, hiddenShip: !ship.Dead, disconnectedAt: &now,
				inputs: make([]queuedInputs, s.World.Specification.Simulation.MaxPredictionTicks+1), binaryReplication: NewBinaryReplicationManager(s.World.Specification)}

			ship.Fly(0, 0)

			if profile.DisplayName != "" {
				ship.Name = p.profile.DisplayName
			}

			p.profile.Ship = objects.SavedShip{}
			s.registerPlayer(p)
		}

		for _, e := range saved.Entities {
			s.activateSector(e.SectorID)

			if e.Deleted || e.State.Object.LocalMovementParent == 0 {
				continue
			}

			entity, ok := s.regions.Sleeping.Get(e.ID)
			parent, hasParent := s.regions.Sleeping.Get(e.State.Object.LocalMovementParent)

			if ok && hasParent {
				entity.Base().LocalMovementParent = parent
			}
		}

		if err := s.restoreNPCs(w.Sectors, npcs); err != nil {
			return err
		}
	} else {
		// Procedural IDs are uint32; runtime objects occupy a separate range.
		s.World.NextEntityID = s.nextEntityID
	}

	s.persistence = &sessionPersistence{generationDigest: persistence.GenerationDigest(s.World.Specification), store: store, entities: map[int64]changedEntity{}, storedEntities: stored, npcs: npcs, players: map[*playerRecord]bool{}, nextCheckpoint: s.now().Add(3 * time.Minute), nextFlush: s.now().Add(30 * time.Second), flushDeadline: s.now().Add(time.Minute)}

	s.activateSector(s.World.Specification.StartingSectorID)

	for _, runtime := range s.sectors {
		s.attachSectorPersistence(runtime)
	}

	s.assignInitialOwner()
	store.Start()

	if len(discarded) > 0 {
		batch := persistence.Batch{Sequence: s.persistence.sequence + 1, World: s.worldRecord(), Entities: discarded}

		if !store.Submit(batch) {
			return fmt.Errorf("could not queue removal of obsolete temporary world records")
		}

		s.persistence.sequence = batch.Sequence
	}

	return nil
}

func (s *GameSession) worldRecord() persistence.World {
	states := map[string]persistence.SectorState{}

	for id, runtime := range s.sectors {
		w := runtime.world
		states[id] = persistence.SectorState{Tick: w.Tick, RandomState: w.Random.State, NextEntityID: w.NextEntityID, NextObjectID: w.NextObjectID, PirateDispatchAt: runtime.pirates.DispatchAt, NPCs: append(runtime.pirates.Capture(), runtime.collectors.Capture()...), NPCDispatch: runtime.collectors.CaptureDispatch()}
	}

	s.players.ForEach(func(p *playerRecord, _ string) {
		if p.pirateAfter == 0 {
			return
		}

		state := states[p.sectorID]

		if state.PirateCooldowns == nil {
			state.PirateCooldowns = map[string]uint64{}
		}

		state.PirateCooldowns[p.profile.ID] = p.pirateAfter
		states[p.sectorID] = state
	})

	return persistence.World{Sectors: states, Seed: s.worldSeed, GenerationDigest: s.persistence.generationDigest, Tick: s.World.Tick, RandomState: s.World.Random.State, NextEntityID: s.World.NextEntityID, NextObjectID: s.World.NextObjectID}
}

func (s *GameSession) accountTime(p *playerRecord) {
	if p.socket == nil {
		return
	}

	now := s.now()

	if !p.playedAt.IsZero() {
		p.profile.PlayedFor += max(0, now.Sub(p.playedAt).Seconds())
		p.playedAt = now
	}

	p.profile.LastSeenAt = now
}

func (s *GameSession) savePlayer(p *playerRecord) {
	if s.persistence != nil {
		if _, pending := s.persistence.players[p]; !pending {
			s.persistence.players[p] = false
		}
	}
}

func (s *GameSession) requirePlayerCommit(p *playerRecord) {
	if s.persistence != nil {
		s.persistence.players[p] = true
	}
}

func (s *GameSession) capturePlayer(p *playerRecord) persistence.Player {
	s.accountTime(p)

	profile := p.profile
	profile.SectorID = p.sectorID
	profile.Visited = slices.Clone(profile.Visited)
	profile.Ship = objects.CaptureShip(p.ship)
	return profile
}

func (s *GameSession) flushChanges() bool {
	persist := s.persistence

	if persist == nil {
		return true
	}

	if !persist.store.HasCapacity() {
		return false
	}

	started := time.Now()
	batch := persistence.Batch{Sequence: persist.sequence + 1, World: s.worldRecord()}

	for p := range persist.players {
		batch.Players = append(batch.Players, s.capturePlayer(p))
	}

	for id, change := range persist.entities {
		e := persistence.Entity{SectorID: s.sectorForWorld(change.entity.Base().World), ID: id, Generated: change.generated, Deleted: change.deleted}

		if !e.Deleted {
			if change.state != nil {
				e.State = *change.state
			} else {
				e.State = objects.CaptureEntity(change.entity)
			}
		}

		batch.Entities = append(batch.Entities, e)
	}

	npcs := s.captureNPCShips(&batch)

	if !persist.store.Submit(batch) {
		return false
	}

	for _, entity := range batch.Entities {
		if entity.Deleted {
			delete(persist.storedEntities, entity.ID)
		} else if !entity.Generated {
			persist.storedEntities[entity.ID] = true
		}
	}

	persist.sequence = batch.Sequence
	persist.npcs = npcs
	persist.nextFlush = s.now().Add(30 * time.Second)
	persist.flushDeadline = s.now().Add(time.Minute)

	for p, critical := range persist.players {
		if critical {
			p.saveSequence = batch.Sequence
		}
	}

	clear(persist.players)
	clear(persist.entities)
	s.recordSave(time.Since(started), len(batch.Players), len(batch.Entities))
	return true
}

func (s *GameSession) persistenceReady() bool {
	persist := s.persistence

	if persist == nil {
		return true
	}

	if persist.store.Err() != nil {
		return false
	}

	for _, immediate := range persist.players {
		if immediate {
			return s.flushChanges()
		}
	}

	return len(persist.players)+len(persist.entities) == 0 || persist.store.HasCapacity()
}

// Ordinary gameplay may roll back after a crash. Copy one coherent batch after
// a quiet tick, with a deadline so continuous load cannot starve saving.
func (s *GameSession) flushBackgroundChanges() bool {
	persist := s.persistence

	if persist == nil {
		return true
	}

	for _, immediate := range persist.players {
		if immediate {
			return s.flushChanges()
		}
	}

	deadline := !s.now().Before(persist.flushDeadline)
	due := !s.now().Before(persist.nextFlush) || len(persist.entities) >= 256
	spare := persist.tickStarted.IsZero() || time.Since(persist.tickStarted) < time.Duration(s.World.Specification.Simulation.SimulationStep*float64(time.Second)/2)

	if !deadline && (!due || !spare) {
		return len(persist.players)+len(persist.entities) == 0 || persist.store.HasCapacity()
	}

	return s.flushChanges()
}

func (s *GameSession) checkpoint() {
	persist := s.persistence

	if persist == nil {
		return
	}

	if !s.now().Before(persist.nextCheckpoint) && len(persist.checkpoint)+len(persist.checkpointPlayers) == 0 {
		for _, runtime := range s.sectors {
			persist.checkpoint = runtime.world.Entities.AppendValues(persist.checkpoint)
		}

		s.players.ForEach(func(p *playerRecord, _ string) {
			if p.socket != nil {
				persist.checkpointPlayers = append(persist.checkpointPlayers, p)
			}
		})

		persist.nextCheckpoint = s.now().Add(3 * time.Minute)
	}

	// Spread copying across ticks rather than serializing the world at once.
	for budget := 0; budget < 8 && len(persist.checkpoint) > 0; budget++ {
		e := persist.checkpoint[0]
		persist.checkpoint[0] = nil
		persist.checkpoint = persist.checkpoint[1:]

		if e.Base().PlayerID != nil || e.Base().Dead || e.Base().Kind == "jumpGate" || e.Base().Kind == "wormhole" {
			continue
		}

		if transientWorldObject(e.Base().Kind, e.Base().Decay) {
			s.recordWorldChange(e, s.sectors[s.sectorForWorld(e.Base().World)].regions.Managed.Has(e.Base().ID), false)
			continue
		}

		if _, pending := persist.entities[e.Base().ID]; !pending {
			// Capture checkpoint records within the per-tick budget, so a later
			// batched write does not copy a whole second of checkpoints at once.
			state := objects.CaptureEntity(e)
			persist.entities[e.Base().ID] = changedEntity{entity: e, generated: s.sectors[s.sectorForWorld(e.Base().World)].regions.Managed.Has(e.Base().ID), state: &state}
		}
	}

	if len(persist.checkpointPlayers) > 0 {
		p := persist.checkpointPlayers[0]
		persist.checkpointPlayers[0] = nil
		persist.checkpointPlayers = persist.checkpointPlayers[1:]

		// Periodic pose/fuel saves must not pause delivery while SQLite commits.
		// A pending gameplay change still retains its durability barrier.
		if _, pending := persist.players[p]; !pending {
			persist.players[p] = false
		}
	}

}

func (s *GameSession) shutdownPersistence(ctx context.Context) error {
	if s.persistence == nil {
		return nil
	}

	// At shutdown the owner is stopped, so copying remaining active mechanics
	// cannot contend with simulation. Sleeping records are saved when unloaded.
	for _, runtime := range s.sectors {
		runtime.world.Entities.ForEach(func(e simulation.Entity, id int64) {
			if e.Base().PlayerID == nil && e.Base().Kind != "jumpGate" && e.Base().Kind != "wormhole" {
				s.recordWorldChange(e, runtime.regions.Managed.Has(id), false)
			}
		})

	}

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
	mask := uint16(1 << index)

	if p.profile.UnlockedPaints&mask != 0 {
		return
	}

	p.profile.UnlockedPaints |= mask
	p.progressPending = true
	s.savePlayer(p)
}

func (s *GameSession) progress(events []protocol.SimulationEvent) {
	for _, event := range events {
		switch e := event.(type) {
		case protocol.ItemCollected:
			if p := s.playersByID[e.By]; p != nil {
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
			if p := s.playersByID[e.PlayerID]; p != nil {
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

	s.sectorPlayers(func(p *playerRecord, _ string) {
		if p.ship.Dead {
			s.unlockPaint(p, 0)
		}
	})
}

func (s *GameSession) attachSectorPersistence(runtime *sectorRuntime) {
	runtime.world.EntityChanged = func(e simulation.Entity, deleted bool) {
		if runtime.world.Loading || e.Base().Kind == "jumpGate" || e.Base().Kind == "wormhole" {
			return
		}

		if transientWorldObject(e.Base().Kind, e.Base().Decay) {
			s.recordWorldChange(e, runtime.regions.Managed.Has(e.Base().ID), deleted)
			return
		}

		if e.Base().PlayerID != nil {
			s.sectorPlayers(func(p *playerRecord, _ string) {
				if p.shipID == e.Base().ID {
					s.savePlayer(p)
				}
			})

			return
		}

		generated := runtime.regions.Managed.Has(e.Base().ID)

		s.recordWorldChange(e, generated, deleted)
	}

	runtime.regions.OnSleep = func(e simulation.Entity) {
		s.recordWorldChange(e, runtime.regions.Managed.Has(e.Base().ID), false)
	}

}

// Lifetime-limited world objects disappear at restart. Cargo and player state
// remain durable; this filter applies only to independent world records.
func transientWorldObject(kind string, decay float64) bool {
	return kind == "projectile" || decay > 0
}

func (s *GameSession) recordWorldChange(entity simulation.Entity, generated, deleted bool) {
	o := entity.Base()

	if deleted && generated {
		s.sectors[s.sectorForWorld(o.World)].regions.Procedural.Remove(uint32(o.ID))
	}

	// A restart tombstone must not remove a still-living generated object from
	// the active region. Its normal removal callback updates that live registry.
	deleted = deleted || transientWorldObject(o.Kind, o.Decay)

	if deleted && !generated && !s.persistence.storedEntities[o.ID] {
		// A never-saved runtime object needs no SQL deletion. Drop any pending
		// creation too, rather than accumulating work for short-lived objects.
		delete(s.persistence.entities, o.ID)
		return
	}

	s.persistence.entities[o.ID] = changedEntity{entity: entity, generated: generated, deleted: deleted}
}

/*
Capture NPC mechanics in the same transaction as controller state and item
transfers. Only a due save calls this; idle ticks do not copy ships or cargo.
*/
func (s *GameSession) captureNPCShips(batch *persistence.Batch) map[int64]string {
	npcs := map[int64]string{}

	for sector, state := range batch.World.Sectors {
		for _, npc := range state.NPCs {
			entity, ok := s.sectors[sector].world.Entities.Get(npc.ID)

			if ok {
				batch.Entities = append(batch.Entities, persistence.Entity{SectorID: sector, ID: npc.ID, State: objects.CaptureEntity(entity)})
				npcs[npc.ID] = sector
			}
		}
	}

	for id, sector := range s.persistence.npcs {
		if _, active := npcs[id]; !active {
			batch.Entities = append(batch.Entities, persistence.Entity{SectorID: sector, ID: id, Deleted: true})
		}
	}

	return npcs
}

/*
Restore controller records alongside their ordinary saved ships. Roles own the
semantic JSON; the session owns entity loading and observer identity.
*/
func (s *GameSession) restoreNPCs(sectors map[string]persistence.SectorState, npcs map[int64]string) error {
	for sector, state := range sectors {
		s.activateSector(sector)
		runtime := s.sectors[sector]
		runtime.pirates.DispatchAt = state.PirateDispatchAt

		if err := runtime.collectors.RestoreDispatch(state.NPCDispatch); err != nil {
			return fmt.Errorf("restore collector dispatch in %s: %w", sector, err)
		}

		for account, tick := range state.PirateCooldowns {
			if p, ok := s.players.Get(account); ok {
				p.pirateAfter = tick
			}
		}

		// Assign every observer before restoring references between NPCs.
		ships := make([]*objects.Ship, len(state.NPCs))

		for index, saved := range state.NPCs {
			npcs[saved.ID] = sector
			entity, ok := runtime.regions.Sleeping.Get(saved.ID)

			if !ok {
				continue
			}

			ship, ok := entity.(*objects.Ship)

			if !ok {
				return fmt.Errorf("NPC %d is not a ship", saved.ID)
			}

			playerID := s.nextPlayerID
			s.nextPlayerID++
			ship.PlayerID = &playerID
			ships[index] = ship
		}

		for index, saved := range state.NPCs {
			ship := ships[index]

			if ship == nil {
				continue
			}

			simulation.AddEntity(runtime.world, ship)
			var err error

			switch saved.Kind {
			case "pirate":
				err = runtime.pirates.Restore(ship, saved.State)
			case "collector":
				err = runtime.collectors.Restore(ship, saved.State)
			default:
				err = fmt.Errorf("unknown saved NPC kind %q", saved.Kind)
			}

			if err != nil {
				return fmt.Errorf("restore %s %d: %w", saved.Kind, saved.ID, err)
			}

			runtime.regions.Sleeping.Delete(ship.ID)
		}
	}

	return nil
}

/*
Shutdown queues the current simulation state. Close the persistence store after
this returns to drain its queue and wait for the final transaction to commit.
*/
func (s *GameSession) Shutdown(ctx context.Context) error { return s.shutdownPersistence(ctx) }
