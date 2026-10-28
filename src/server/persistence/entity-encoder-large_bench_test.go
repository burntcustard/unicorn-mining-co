package persistence

import (
	"math"
	"syscall"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func BenchmarkLargeAsteroidEncoding(b *testing.B) {
	catalog, err := specs.Load()

	if err != nil {
		b.Fatal(err)
	}

	for _, size := range []struct {
		name   string
		radius float64
		points int
	}{{"radius160", 160, 13}, {"radius300", 300, simulation.PointCountFor(300, catalog.RegionGeneration.AsteroidPointCountScale)}} {
		world := simulation.CreateWorld(25, catalog)
		asteroid := simulation.CreateAsteroid(world, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Radius: &size.radius}, Contents: []int{1, 2, 3, 4}, PointCount: size.points}).LockGeometry()
		asteroid.Segments()[0].Health -= 0.25

		for _, changing := range []bool{false, true} {
			mode := "static"

			if changing {
				mode = "changing"
			}

			for _, variant := range []string{"fresh", "reused"} {
				b.Run(size.name+"/"+mode+"/"+variant, func(b *testing.B) {
					state := objects.CaptureEntity(asteroid)

					encode := func(state objects.SavedEntity) ([]byte, error) { return Encode(state) }

					if variant == "reused" {
						encoder, err := newEntityEncoder()

						if err != nil {
							b.Fatal(err)
						}

						encode = encoder.Encode
					}

					data, err := encode(state)

					if err != nil {
						b.Fatal(err)
					}

					b.SetBytes(int64(len(data)))
					b.ReportAllocs()
					var before, after syscall.Rusage
					var encodedBytes int64

					if err := syscall.Getrusage(syscall.RUSAGE_SELF, &before); err != nil {
						b.Fatal(err)
					}

					b.ResetTimer()

					for i := 0; i < b.N; i++ {
						if changing {
							state.Object.Position.X = float64(i % 10000)
							state.Object.Position.Y = float64((i * 7) % 10000)
							state.Object.Rotation = float64(i%360) * math.Pi / 180
							state.AsteroidSegments[0].Health = state.AsteroidSegments[0].MaxHealth * (0.5 + float64(i%257)/1024)
						}

						data, err := encode(state)

						if err != nil {
							b.Fatal(err)
						}

						encodedEntityBenchmark = data
						encodedBytes += int64(len(data))
					}

					b.StopTimer()

					if err := syscall.Getrusage(syscall.RUSAGE_SELF, &after); err != nil {
						b.Fatal(err)
					}

					cpu := (after.Utime.Sec-before.Utime.Sec+after.Stime.Sec-before.Stime.Sec)*1e9 +
						(after.Utime.Usec-before.Utime.Usec+after.Stime.Usec-before.Stime.Usec)*1e3
					b.ReportMetric(float64(cpu)/float64(b.N), "cpu-ns/op")
					b.ReportMetric(float64(encodedBytes)/float64(b.N), "encoded-B/op")
					b.ReportMetric(float64(len(state.AsteroidSegments)), "segments")
					b.ReportMetric(float64(size.points), "points")
				})
			}
		}
	}
}
