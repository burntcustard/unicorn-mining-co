package network

import (
	"context"
	"path/filepath"
	"runtime"
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

// Each operation covers nine one-minute or three three-minute checkpoints. This
// fixture measures persistence only: poses advance without physics, replication,
// or real-time waits. Match GOMAXPROCS, GOMEMLIMIT, and GOGC between candidates.
func BenchmarkCheckpointPersistence(b *testing.B) {
	const updatesPerOperation = 541 * 30

	for _, name := range []string{"checkpoint", "gameplay-update", "immediate-account"} {
		b.Run(name, func(b *testing.B) {
			catalog, err := specs.Load()

			if err != nil {
				b.Fatal(err)
			}

			s := NewGameSession(25, catalog)
			began := time.Unix(100000, 0)
			clock := began

			s.now = func() time.Time { return clock }

			store, err := persistence.Open(filepath.Join(b.TempDir(), "world.sqlite"), "")

			if err != nil {
				b.Fatal(err)
			}

			if err = s.EnablePersistence(store); err != nil {
				store.Close(context.Background())
				b.Fatal(err)
			}

			defer func() {
				if err := store.Close(context.Background()); err != nil {
					b.Error(err)
				}
			}()

			wait := func() {
				deadline := time.Now().Add(10 * time.Second)

				for store.Committed() < s.persistence.sequence {
					if err := store.Err(); err != nil {
						b.Fatal(err)
					}

					if time.Now().After(deadline) {
						b.Fatal("commit timeout")
					}

					time.Sleep(10 * time.Microsecond)
				}
			}

			players := make([]*playerRecord, 2)

			for i := range players {
				socket := &benchmarkSocket{}
				s.Receive(protocol.Control{Type: "hello"}, socket)
				players[i] = s.playersBySocket[socket]

				if players[i] == nil {
					b.Fatal("player initialization failed")
				}
			}

			// Keep the fixture size independent of nearby procedural generation.
			// No region loading or simulation runs after this setup.
			for _, sector := range s.sectors {
				sector.world.Entities.Clear()
				sector.regions.managed.Clear()
				sector.regions.sleeping.Clear()
			}

			for _, p := range players {
				s.World.Entities.Set(p.shipID, p.ship)
			}

			var stationary, moving []*objects.Item
			var spinning, damaged []*simulation.Asteroid

			for i := 0; i < 16; i++ {
				for _, items := range []*[]*objects.Item{&stationary, &moving} {
					id := simulation.EntityID(s.World)
					item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id, Position: Vec.Create(float64(i*300), 1000)}, catalog)
					simulation.AddEntity(s.World, item)
					*items = append(*items, item)
				}

				moving[i].Velocity = Vec.Create(3, 1)
				radius := 80.0
				generatedID := int64(1000000 + i)

				pristine := simulation.CreateAsteroid(s.World, simulation.AsteroidProperties{
					ObjectProperties: simulation.ObjectProperties{ID: &generatedID, Position: Vec.Create(float64(i*300), 2000), Radius: &radius, Spin: 0.05},
					Contents:         []int{1, 2}, PointCount: 11,
				}).LockGeometry()

				s.regions.managed.Set(pristine.ID, true)
				simulation.AddEntity(s.World, pristine)
				spinning = append(spinning, pristine)

				asteroid := simulation.CreateAsteroid(s.World, simulation.AsteroidProperties{
					ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(float64(i*300), 3000), Radius: &radius},
					Contents:         []int{1, 2}, PointCount: 11,
				})

				segments := asteroid.Segments()

				if len(segments) == 0 {
					b.Fatal("damaged asteroid needs a segment")
				}

				segments[0].Health *= 0.75
				asteroid.LockGeometry()
				simulation.AddEntity(s.World, asteroid)
				damaged = append(damaged, asteroid)
			}

			station := objects.CreateStation(objects.Properties{ObjectProperties: simulation.ObjectProperties{World: s.World, Position: Vec.Create(0, 4000)}}, catalog)
			simulation.AddEntity(s.World, station)

			if !s.flushChanges() {
				b.Fatal("initial flush blocked")
			}

			wait()
			stateBytes := 0

			s.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
				if entity.Base().PlayerID != nil {
					return
				}

				data, err := persistence.Encode(objects.CaptureEntity(entity))

				if err != nil {
					b.Fatal(err)
				}

				stateBytes += len(data)
			})

			before := s.persistence.sequence
			s.saveStats = saveStats{}
			var cpuBefore, cpuAfter syscall.Rusage
			var memoryBefore, memoryAfter runtime.MemStats
			runtime.ReadMemStats(&memoryBefore)
			syscall.Getrusage(syscall.RUSAGE_SELF, &cpuBefore)
			sweeps, tick := 0, 0
			b.ReportAllocs()
			b.ResetTimer()

			for operation := 0; operation < b.N; operation++ {
				// Drain a sweep that happens to begin on the final update too.
				for update := 0; update < updatesPerOperation || operation == b.N-1 && len(s.persistence.checkpoint)+len(s.persistence.checkpointPlayers) > 0; update++ {
					tick++
					clock = began.Add(time.Duration(tick) * time.Second / 30)
					s.World.Tick++

					// Motion normally reaches persistence through checkpoints, without
					// an EntityChanged callback for every pose update.
					for _, item := range moving {
						item.Position.X += item.Velocity.X / 30
						item.Position.Y += item.Velocity.Y / 30
					}

					for _, asteroid := range spinning {
						asteroid.Rotation += asteroid.Spin / 30
					}

					if tick%300 == 0 {
						item := stationary[(tick/300-1)%4]
						item.Mined = !item.Mined
						s.World.EntityChanged(item, false)
						// Partial segment damage also relies on periodic capture.
						damaged[(tick/300-1)%len(damaged)].Segments()[0].Health *= 0.999

						if name != "checkpoint" {
							players[1].profile.Credits++
							s.savePlayer(players[1])
						}

						if name == "immediate-account" {
							s.requirePlayerCommit(players[1])
						}
					}

					if !s.persistenceReady() {
						b.Fatal("save queue blocked")
					}

					nextCheckpoint := s.persistence.nextCheckpoint
					s.checkpoint()

					if !s.persistence.nextCheckpoint.Equal(nextCheckpoint) {
						sweeps++
					}

					if !s.flushBackgroundChanges() {
						b.Fatal("background save queue blocked")
					}

					// Compressed simulated time must not create an artificial writer
					// backlog that coalesces saves normally separated by seconds.
					wait()
				}
			}

			if !s.flushChanges() {
				b.Fatal("final flush blocked")
			}

			wait()
			b.StopTimer()
			syscall.Getrusage(syscall.RUSAGE_SELF, &cpuAfter)
			runtime.ReadMemStats(&memoryAfter)

			if sweeps < 3*b.N || len(s.persistence.checkpoint)+len(s.persistence.checkpointPlayers) != 0 {
				b.Fatal("fixture did not complete at least three checkpoints per operation")
			}

			updates := float64(tick)
			cpuNS := cpuAfter.Utime.Nano() + cpuAfter.Stime.Nano() - cpuBefore.Utime.Nano() - cpuBefore.Stime.Nano()
			b.ReportMetric(updates/float64(b.N), "updates/op")
			b.ReportMetric(float64(sweeps)/float64(b.N), "sweeps/op")
			b.ReportMetric(float64(stateBytes), "fixture-state-B")
			b.ReportMetric(float64(cpuNS)/updates, "cpu-ns/update")
			b.ReportMetric(float64(memoryAfter.TotalAlloc-memoryBefore.TotalAlloc)/updates, "B/update")
			b.ReportMetric(float64(memoryAfter.Mallocs-memoryBefore.Mallocs)/updates, "allocs/update")
			b.ReportMetric(float64(s.persistence.sequence-before)/updates, "batches/update")
			b.ReportMetric(float64(s.saveStats.entities)/updates, "entities/update")
			b.ReportMetric(float64(s.saveStats.players)/updates, "players/update")
			b.ReportMetric(float64(s.saveStats.capture.Nanoseconds())/updates, "capture-ns/update")
			b.ReportMetric(float64(s.saveStats.maxCapture.Nanoseconds()), "capture-max-ns")
		})
	}
}
