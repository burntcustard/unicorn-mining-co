package network

import (
	"context"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestWorldAndGameplayChangesCoalesceForThirtySeconds(t *testing.T) {
	t.Parallel()
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	clock := time.Unix(100000, 0)

	s.now = func() time.Time { return clock }

	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: Vec.Create(100, 100)}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	committedSession(t, s)
	before := s.persistence.sequence
	began := clock

	for i := 1; i < 30; i++ {
		clock = began.Add(time.Duration(i) * time.Second)
		item.Position.X = float64(i)
		s.World.EntityChanged(item, false)

		if !s.persistenceReady() || !s.flushBackgroundChanges() {
			t.Fatal("background save blocked gameplay")
		}

		if s.persistence.sequence != before {
			t.Fatal("background change submitted before thirty seconds")
		}
	}

	clock = began.Add(30 * time.Second)
	item.Position.X = 30
	s.World.EntityChanged(item, false)

	if !s.persistenceReady() || !s.flushBackgroundChanges() || s.persistence.sequence != before+1 {
		t.Fatal("background changes were not submitted at their deadline")
	}

	committedSession(t, s)
	saved, err := store.Load(25)

	if err != nil {
		t.Fatal(err)
	}

	found := false

	for _, e := range saved.Entities {
		if e.ID == item.ID {
			found = e.State.Object.Position.X == 30
		}
	}

	if !found {
		t.Fatal("background batch did not retain the latest position")
	}

	// A collection may roll back after a crash, but inventory and removal
	// must still reach the database together.
	clock = clock.Add(time.Millisecond)
	p.ship.CargoContents = append(p.ship.CargoContents, item)
	item.Remove()
	s.savePlayer(p)
	before = s.persistence.sequence

	if !s.persistenceReady() || !s.flushBackgroundChanges() || s.persistence.sequence != before {
		t.Fatal("ordinary collection bypassed the background deadline")
	}

	clock = clock.Add(30 * time.Second)

	if !s.flushBackgroundChanges() || s.persistence.sequence != before+1 {
		t.Fatal("collection missed the next save opportunity")
	}

	committedSession(t, s)
	saved, err = store.Load(25)

	if err != nil {
		t.Fatal(err)
	}

	if len(saved.Players) != 1 || len(saved.Players[0].Ship.Cargo) != 1 {
		t.Fatal("collected inventory was not committed")
	}

	for _, e := range saved.Entities {
		if e.ID == item.ID {
			t.Fatal("collected item remains in the world")
		}
	}
}

func TestShutdownFlushesDeferredWorldChanges(t *testing.T) {
	t.Parallel()
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: Vec.Create(100, 100)}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	committedSession(t, s)
	item.Position.X = 200
	s.World.EntityChanged(item, false)
	before := s.persistence.sequence

	if !s.persistenceReady() || s.persistence.sequence != before {
		t.Fatal("background fixture was not deferred")
	}

	if err := s.shutdownPersistence(context.Background()); err != nil {
		t.Fatal(err)
	}

	committedSession(t, s)
	saved, err := store.Load(25)

	if err != nil {
		t.Fatal(err)
	}

	for _, e := range saved.Entities {
		if e.ID == item.ID && e.State.Object.Position.X == 200 {
			return
		}
	}

	t.Fatal("shutdown lost the deferred world change")
}

func BenchmarkWorldChangePersistence(b *testing.B) {
	for _, name := range []string{"background", "gameplay-update", "immediate-account"} {
		b.Run(name, func(b *testing.B) {
			catalog, err := specs.Load()

			if err != nil {
				b.Fatal(err)
			}

			s := NewGameSession(25, catalog)
			store, err := persistence.Open(filepath.Join(b.TempDir(), "world.sqlite"), "")

			if err != nil {
				b.Fatal(err)
			}

			if err = s.EnablePersistence(store); err != nil {
				b.Fatal(err)
			}

			defer store.Close(context.Background())
			began := time.Unix(100000, 0)
			clock := began

			s.now = func() time.Time { return clock }

			socket := &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			p := s.playersBySocket[socket]
			items := make([]*objects.Item, 32)

			for i := range items {
				items[i] = objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: Vec.Create(float64(i*100), 100)}, catalog)
				simulation.AddEntity(s.World, items[i])
			}

			wait := func() {
				deadline := time.Now().Add(4 * time.Second)

				for store.Committed() < s.persistence.sequence {
					if time.Now().After(deadline) {
						b.Fatal("commit timeout", store.Err())
					}

					time.Sleep(10 * time.Microsecond)
				}
			}

			s.flushChanges()
			wait()
			before := s.persistence.sequence
			var cpuBefore, cpuAfter syscall.Rusage
			syscall.Getrusage(syscall.RUSAGE_SELF, &cpuBefore)
			b.ReportAllocs()
			b.ResetTimer()

			for i := 0; i < b.N; i++ {
				clock = began.Add(time.Duration(i+1) * time.Second / 30)
				s.World.Tick++

				for _, item := range items {
					item.Position.X++
					s.World.EntityChanged(item, false)
				}

				if name != "background" {
					p.profile.Credits++
					s.savePlayer(p)
				}

				if name == "immediate-account" {
					s.persistence.players[p] = true
				}

				if !s.persistenceReady() || !s.flushBackgroundChanges() {
					b.Fatal("queue blocked")
				}

				wait()
			}

			if !s.flushChanges() {
				b.Fatal("final flush blocked")
			}

			wait()
			b.StopTimer()
			syscall.Getrusage(syscall.RUSAGE_SELF, &cpuAfter)
			cpuNS := (cpuAfter.Utime.Nano() + cpuAfter.Stime.Nano()) - (cpuBefore.Utime.Nano() + cpuBefore.Stime.Nano())
			b.ReportMetric(float64(cpuNS)/float64(b.N), "cpu-ns/update")
			b.ReportMetric(float64(s.persistence.sequence-before)/float64(b.N), "batches/update")
		})
	}
}

func TestCheckpointCaptureYieldsToNewerGameplayChange(t *testing.T) {
	t.Parallel()
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	asteroid := simulation.CreateAsteroid(s.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(100, 100)}, Contents: []int{1, 2}})
	simulation.AddEntity(s.World, asteroid)
	committedSession(t, s)
	s.persistence.checkpoint = []simulation.Entity{asteroid}
	s.checkpoint()
	captured := s.persistence.entities[asteroid.ID].state

	if captured == nil {
		t.Fatal("checkpoint did not copy within its tick budget")
	}

	asteroid.Position.X = 200
	asteroid.Segments()[0].Health--

	if captured.Object.Position.X != 100 {
		t.Fatal("checkpoint state aliases the live world")
	}

	s.World.EntityChanged(asteroid, false)
	s.savePlayer(p)

	if !s.persistenceReady() {
		t.Fatal("player commit blocked")
	}

	committedSession(t, s)
	saved, err := store.Load(25)

	if err != nil {
		t.Fatal(err)
	}

	for _, e := range saved.Entities {
		if e.ID == asteroid.ID {
			if e.State.Object.Position.X != 200 || len(e.State.AsteroidSegments) == 0 || e.State.AsteroidSegments[0].Health != asteroid.Segments()[0].Health {
				t.Fatal("checkpoint masked newer gameplay state")
			}

			return
		}
	}

	t.Fatal("changed asteroid missing")
}
