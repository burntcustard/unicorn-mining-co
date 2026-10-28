package network

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestGameplaySaveUsesSpareTickTimeWithDeadline(t *testing.T) {
	for _, busy := range []bool{false, true} {
		t.Run(map[bool]string{false: "spare-time", true: "busy-deadline"}[busy], func(t *testing.T) {
			s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
			defer store.Close(context.Background())
			clock := time.Unix(100000, 0)

			s.now = func() time.Time { return clock }

			socket := &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			p := s.playersBySocket[socket]
			id := simulation.EntityID(s.World)
			item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id, Position: Vec.Create(100, 100)}, s.World.Specification)
			simulation.AddEntity(s.World, item)
			committedSession(t, s)
			s.sendSnapshot(p, nil, nil)
			socket.acknowledge(s)
			before := s.persistence.sequence
			p.ship.CargoContents = append(p.ship.CargoContents, item)
			item.Remove()
			s.savePlayer(p)
			packets := socket.packets
			s.sendSnapshot(p, nil, nil)

			if socket.packets == packets {
				t.Fatal("ordinary gameplay waited for a deferred save")
			}

			clock = clock.Add(29 * time.Second)

			if !s.persistenceReady() || !s.flushBackgroundChanges() || s.persistence.sequence != before {
				t.Fatal("ordinary gameplay did not coalesce for thirty seconds")
			}

			clock = clock.Add(time.Second)

			if busy {
				s.persistence.tickStarted = time.Now().Add(-time.Second)
			}

			if !s.flushBackgroundChanges() {
				t.Fatal("save queue blocked")
			}

			if busy {
				if s.persistence.sequence != before {
					t.Fatal("save ran in an already busy tick")
				}

				clock = clock.Add(30 * time.Second)

				if !s.flushBackgroundChanges() {
					t.Fatal("deadline save blocked")
				}
			}

			if s.persistence.sequence != before+1 {
				t.Fatal("deferred save missed its spare time or hard deadline")
			}

			committedSession(t, s)
			saved, err := store.Load(25)

			if err != nil || len(saved.Players) != 1 || len(saved.Players[0].Ship.Cargo) != 1 {
				t.Fatal("deferred inventory was not saved", err)
			}

			for _, entity := range saved.Entities {
				if entity.ID == item.ID {
					t.Fatal("deferred collection duplicated its world item")
				}
			}
		})
	}
}

func TestLargeDirtySetSavesBeforeTimer(t *testing.T) {
	t.Parallel()
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	committedSession(t, s)
	before := s.persistence.sequence

	for i := 0; i < 256; i++ {
		item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: Vec.Create(float64(i), 100)}, s.World.Specification)
		simulation.AddEntity(s.World, item)

		if i < 255 {
			if !s.flushBackgroundChanges() || s.persistence.sequence != before {
				t.Fatal("small dirty set saved early")
			}
		}
	}

	if !s.flushBackgroundChanges() || s.persistence.sequence != before+1 {
		t.Fatal("large dirty set kept growing until the timer")
	}
}

func TestCrashBeforeDeferredCollectionKeepsOldCoherentState(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	itemID := simulation.EntityID(s.World)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &itemID, Position: Vec.Create(100, 100)}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	committedSession(t, s)
	id := item.ID
	p.ship.CargoContents = append(p.ship.CargoContents, item)
	item.Remove()
	s.savePlayer(p)

	if !s.flushBackgroundChanges() {
		t.Fatal("deferred collection blocked")
	}

	// Stop without the session's graceful-shutdown flush, simulating a crash
	// before its deferred changes were submitted to the database worker.
	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())

	s.players.ForEach(func(p *playerRecord, _ string) {
		if len(p.ship.CargoContents) != 0 {
			t.Fatal("crash kept unsaved inventory")
		}
	})

	if !s.regions.sleeping.Has(id) && !s.World.Entities.Has(id) {
		t.Fatal("crash lost the world item before its collection was saved")
	}
}

func TestPeriodicCaptureDoesNotStartBeforeThreeMinutes(t *testing.T) {
	t.Parallel()
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	clock := time.Now()

	s.now = func() time.Time { return clock }

	s.persistence.nextCheckpoint = clock.Add(3 * time.Minute)
	clock = clock.Add(179 * time.Second)
	s.checkpoint()

	if len(s.persistence.checkpoint) != 0 {
		t.Fatal("world checkpoint started before three minutes")
	}

	clock = clock.Add(time.Second)
	s.checkpoint()

	if !s.persistence.nextCheckpoint.Equal(clock.Add(3 * time.Minute)) {
		t.Fatal("world checkpoint was not rescheduled after three minutes")
	}
}

func TestOwnerBootstrapRequestsImmediateCommit(t *testing.T) {
	t.Parallel()
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	committedSession(t, s)
	p.profile.DisplayName = initialOwnerName
	s.assignInitialOwner()
	s.savePlayer(p)

	if !s.persistence.players[p] {
		t.Fatal("owner-role assignment was deferred or downgraded by an ordinary save")
	}

	before := s.persistence.sequence

	if !s.persistenceReady() || s.persistence.sequence != before+1 {
		t.Fatal("owner-role assignment waited for the periodic timer")
	}

	committedSession(t, s)
	saved, err := store.Load(25)

	if err != nil || len(saved.Players) != 1 || saved.Players[0].Role != persistence.RoleOwner {
		t.Fatal("owner-role assignment was not committed", err)
	}
}
