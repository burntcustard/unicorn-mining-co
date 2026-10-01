package simulation

import (
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
	"math/rand/v2"
	"testing"
)

func TestPackedObserversMatchScalar(t *testing.T) {
	random := rand.New(rand.NewPCG(13, 41))
	for _, count := range []int{0, 1, 3, 4, 7, 8, 9, 16, 31, 32, 65} {
		for _, origin := range []float64{0, 1e7, -2e7, 1e12} {
			var schedule movementSchedule
			for range count {
				position := Vec.Create(origin+random.Float64()*4000, origin+random.Float64()*4000)
				schedule.positions = append(schedule.positions, position)
				schedule.observerX = append(schedule.observerX, position.X)
				schedule.observerY = append(schedule.observerY, position.Y)
			}
			for trial := 0; trial < 1000; trial++ {
				position := Vec.Create(origin+random.Float64()*5000, origin+random.Float64()*5000)
				radius := random.Float64() * 2e6
				if count > 0 && trial%3 == 0 {
					radius = Vec.DistanceSquared(position, schedule.positions[trial%count])
					if trial%2 == 0 {
						radius = math.Nextafter(radius, 0)
					}
				}
				if schedule.withinObservers(position, radius) != schedule.withinObserversScalar(position, radius) {
					t.Fatalf("count=%d origin=%g trial=%d radius=%g", count, origin, trial, radius)
				}
			}
		}
	}
}
