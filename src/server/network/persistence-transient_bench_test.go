package network

import (
	"context"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func BenchmarkTransientWorldPersistence(b *testing.B) {
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

	// The fake clock starts after session creation; establish its save schedule.
	s.persistence.nextFlush = clock.Add(time.Second)

	wait := func() {
		deadline := time.Now().Add(4 * time.Second)

		for store.Committed() < s.persistence.sequence {
			if time.Now().After(deadline) {
				b.Fatal("commit timeout", store.Err())
			}

			time.Sleep(10 * time.Microsecond)
		}
	}

	var cpuBefore, cpuAfter syscall.Rusage
	syscall.Getrusage(syscall.RUSAGE_SELF, &cpuBefore)
	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		clock = began.Add(time.Duration(i+1) * time.Second / 30)

		for j := 0; j < 8; j++ {
			decay := 6.0
			shot := objects.NewProjectile("autogun", simulation.ObjectProperties{World: s.World}, catalog)
			fragment := simulation.CreateAsteroid(s.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Decay: &decay}})

			for _, entity := range []simulation.Entity{shot, fragment} {
				simulation.AddEntity(s.World, entity)
				entity.Base().Remove()
			}
		}

		if !s.persistenceReady() || !s.flushBackgroundChanges() {
			b.Fatal("save queue blocked")
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
	b.ReportMetric(float64(s.persistence.sequence)/float64(b.N), "batches/update")
}
