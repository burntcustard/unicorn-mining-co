package network

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestTemporaryWorldObjectsNeverQueueSaveWork(t *testing.T) {
	t.Parallel()
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	committedSession(t, s)
	decay := 6.0

	for i := 0; i < 100; i++ {
		shot := objects.NewProjectile("autogun", simulation.ObjectProperties{World: s.World}, s.World.Specification)
		fragment := simulation.CreateAsteroid(s.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Decay: &decay}})

		for _, entity := range []simulation.Entity{shot, fragment} {
			simulation.AddEntity(s.World, entity)
			s.regions.onSleep(entity)

			if len(s.persistence.entities) != 0 {
				t.Fatal("temporary object queued a save at creation or sleep")
			}

			entity.Base().Remove()

			if len(s.persistence.entities) != 0 {
				t.Fatal("never-saved temporary object queued a SQL deletion")
			}
		}
	}
}

func TestTemporaryFilteringPreservesPermanentWorldAndPlayers(t *testing.T) {
	t.Parallel()
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	committedSession(t, s)
	p.ship.Fuel = 12.5
	s.savePlayer(p)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: Vec.Create(100, 100)}, s.World.Specification)
	ship := objects.CreatePlayerShip(s.World, objects.Properties{Position: Vec.Create(200, 100)})
	station := objects.CreateStation(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: s.World, Position: Vec.Create(300, 100)}}, s.World.Specification)
	asteroid := simulation.CreateAsteroid(s.World, simulation.AsteroidProperties{Position: Vec.Create(400, 100), Contents: []int{1, 2}})
	permanent := []simulation.Entity{item, ship, station, asteroid}

	for _, entity := range permanent {
		simulation.AddEntity(s.World, entity)
	}

	committedSession(t, s)

	for _, entity := range permanent {
		entity.Base().Position.X += 1000
		s.World.EntityChanged(entity, false)
	}

	decay := 6.0

	temporary := []simulation.Entity{
		objects.NewProjectile("autogun", simulation.ObjectProperties{World: s.World}, s.World.Specification),
		simulation.CreateAsteroid(s.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Decay: &decay}}),
		objects.CreateWreckage(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: s.World}}, []objects.WreckageSegment{{Radius: 10, Health: 2}}, s.World.Specification),
	}

	for _, entity := range temporary {
		simulation.AddEntity(s.World, entity)
	}

	s.persistence.nextCheckpoint = s.now()
	s.checkpoint()

	for len(s.persistence.checkpoint) > 0 {
		s.checkpoint()
	}

	if err := s.shutdownPersistence(context.Background()); err != nil {
		t.Fatal(err)
	}

	committedSession(t, s)
	saved, err := store.Load(25)

	if err != nil {
		t.Fatal(err)
	}

	if len(saved.Players) != 1 || saved.Players[0].Ship.Fuel != 12.5 {
		t.Fatal("temporary filtering lost player state")
	}

	found := map[int64]objects.SavedEntity{}

	for _, entity := range saved.Entities {
		if !entity.Deleted {
			if entity.State.Object.Kind == "projectile" || entity.State.Object.Decay > 0 {
				t.Fatal("checkpoint or shutdown saved a temporary object")
			}

			found[entity.ID] = entity.State
		}
	}

	for _, entity := range permanent {
		if found[entity.Base().ID].Object.Position.X != entity.Base().Position.X {
			t.Fatalf("permanent %s lost its changed position", entity.Base().Kind)
		}
	}
}

func TestSavedObjectBecomingTemporaryCannotResurrect(t *testing.T) {
	for _, generated := range []bool{false, true} {
		t.Run(map[bool]string{false: "runtime", true: "generated"}[generated], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "world.sqlite")
			s, store := persistedSession(t, path)
			socket := &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			var asteroid *simulation.Asteroid

			if generated {
				s.World.Entities.ForEach(func(e simulation.Entity, id int64) {
					if a, ok := e.(*simulation.Asteroid); ok && s.regions.managed.Has(id) && asteroid == nil {
						asteroid = a
					}
				})
			} else {
				asteroid = simulation.CreateAsteroid(s.World, simulation.AsteroidProperties{Position: Vec.Create(100, 100)})
				simulation.AddEntity(s.World, asteroid)
			}

			if asteroid == nil {
				t.Fatal("fixture has no asteroid")
			}

			s.World.EntityChanged(asteroid, false)
			committedSession(t, s)
			id, position := asteroid.ID, asteroid.Position
			asteroid.Decay = 6
			s.World.EntityChanged(asteroid, false)
			committedSession(t, s)

			if err := store.Close(context.Background()); err != nil {
				t.Fatal(err)
			}

			s, store = persistedSession(t, path)
			defer store.Close(context.Background())
			s.regions.Sync(s.World, []Vec.Vector{position})

			if s.World.Entities.Has(id) || s.regions.sleeping.Has(id) {
				t.Fatal("temporary object reappeared after restart or generation")
			}
		})
	}
}

func TestLegacyTemporaryRowsAreRemovedOnRestore(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	committedSession(t, s)
	decay := 6.0
	shot := objects.NewProjectile("autogun", simulation.ObjectProperties{World: s.World}, s.World.Specification)
	fragment := simulation.CreateAsteroid(s.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Decay: &decay}})
	var records []persistence.Entity

	for _, e := range []simulation.Entity{shot, fragment} {
		records = append(records, persistence.Entity{SectorID: s.currentSector, ID: e.Base().ID, State: objects.CaptureEntity(e)})
	}

	s.persistence.sequence++

	if !store.Submit(persistence.Batch{Sequence: s.persistence.sequence, World: s.worldRecord(), Entities: records}) {
		t.Fatal("could not create legacy records")
	}

	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	committedSession(t, s)

	for _, e := range []simulation.Entity{shot, fragment} {
		if s.regions.sleeping.Has(e.Base().ID) || s.World.Entities.Has(e.Base().ID) {
			t.Fatal("legacy temporary object restored into gameplay")
		}
	}

	saved, err := store.Load(25)

	if err != nil || len(saved.Entities) != 0 {
		t.Fatal("obsolete temporary rows remain in the database", err)
	}
}

func TestQueuedPermanentObjectStillQueuesDeletionBeforeCommit(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	defer store.Close(context.Background())
	db, err := sql.Open("sqlite", path)

	if err != nil {
		t.Fatal(err)
	}

	defer db.Close()
	tx, err := db.Begin()

	if err != nil {
		t.Fatal(err)
	}

	defer tx.Rollback()

	if _, err = tx.Exec("UPDATE world SET tick=tick WHERE id=1"); err != nil {
		t.Fatal(err)
	}

	id := simulation.EntityID(s.World)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id}, s.World.Specification)
	simulation.AddEntity(s.World, item)

	if !s.flushChanges() || store.Committed() >= s.persistence.sequence {
		t.Fatal("fixture did not queue an uncommitted permanent object")
	}

	item.Remove()

	if pending, exists := s.persistence.entities[id]; !exists || !pending.deleted {
		t.Fatal("queued creation lost its later deletion before commit")
	}

	if !s.flushChanges() {
		t.Fatal("deletion queue blocked")
	}

	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}

	committedSession(t, s)
	saved, err := store.Load(25)

	if err != nil || len(saved.Entities) != 0 {
		t.Fatal("removed permanent object survived its queued deletion", err)
	}
}

func TestTemporaryGeneratedObjectKeepsItsLiveLifetime(t *testing.T) {
	t.Parallel()
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	var asteroid *simulation.Asteroid

	s.World.Entities.ForEach(func(e simulation.Entity, id int64) {
		if a, ok := e.(*simulation.Asteroid); ok && s.regions.managed.Has(id) && asteroid == nil {
			asteroid = a
		}
	})

	if asteroid == nil {
		t.Fatal("fixture has no generated asteroid")
	}

	id, position := asteroid.ID, asteroid.Position
	asteroid.Decay = 6
	s.World.EntityChanged(asteroid, false)
	s.persistence.checkpoint = []simulation.Entity{asteroid}
	s.checkpoint()
	committedSession(t, s)
	s.regions.Sync(s.World, []Vec.Vector{position})

	if !s.World.Entities.Has(id) || asteroid.Dead {
		t.Fatal("save filtering shortened a generated object's live lifetime")
	}

	saved, err := store.Load(25)

	if err != nil {
		t.Fatal(err)
	}

	deleted := false

	for _, e := range saved.Entities {
		if e.ID == id {
			deleted = e.Generated && e.Deleted
		}
	}

	if !deleted {
		t.Fatal("temporary generated object needs a restart tombstone")
	}

	asteroid.Remove()
	s.regions.Sync(s.World, []Vec.Vector{position})

	if s.World.Entities.Has(id) || s.regions.sleeping.Has(id) {
		t.Fatal("actual deletion did not remove the generated object")
	}
}
