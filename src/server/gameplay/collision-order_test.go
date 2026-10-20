package gameplay

import (
	"math/rand"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestCollisionBroadphaseSurvivesChangingBodyCounts(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	collisions := NewGameCollisions(catalog)
	random := rand.New(rand.NewSource(63))

	for iteration := range 300 {
		motions := make([]*BodyRecord, random.Intn(120))
		centers := make([]Vec.Vector, len(motions))
		radii := make([]float64, len(motions))

		for index := range motions {
			start := Vec.Create(float64(random.Intn(40))*40, float64(random.Intn(40))*40)
			position := Vec.Add(start, Vec.Create(float64(random.Intn(11)-5), float64(random.Intn(11)-5)))
			radius := float64(random.Intn(60))
			motions[index] = &BodyRecord{Object: &simulation.GameObject{Position: position, Physics: true}, SweepStart: simulation.Pose{Position: start}, Radius: radius}
			centers[index] = Vec.Scale(Vec.Add(start, position), .5)
			radii[index] = radius + Vec.Distance(start, position) + catalog.Simulation.Physics.WakeMargin
		}

		free := collisions.findFree(motions)

		for index := range motions {
			expected := true

			for other := range motions {
				if other != index && Vec.Distance(centers[index], centers[other]) <= radii[index]+radii[other] {
					expected = false
					break
				}
			}

			if free[index] != expected {
				t.Fatalf("population change %d with %d bodies misclassified body %d: free=%v expected=%v", iteration, len(motions), index, free[index], expected)
			}
		}
	}
}
