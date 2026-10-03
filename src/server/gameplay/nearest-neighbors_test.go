package gameplay

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"testing"
)

func TestNearestObjectLimitAndRecovery(t *testing.T) {
	old := limitCollisionNeighbors
	limitCollisionNeighbors = true
	t.Cleanup(func() { limitCollisionNeighbors = old })
	catalog, err := definitions.Load()
	if err != nil {
		t.Fatal(err)
	}
	g := NewGameCollisions(catalog)
	entities := utilities.NewOrderedMap[int64, simulation.Entity]()
	for i := range 10 {
		radius := 0.2
		if i == 0 {
			radius = 12
		}
		o := simulation.NewGameObject(simulation.ObjectProperties{ID: new(int64(i + 1)), Position: Vec.Create(float64(i), 0), Radius: &radius, Physics: new(false)}, catalog.Simulation)
		entities.Set(o.ID, o)
	}
	step := func() []collision.Contact {
		g.CapturePoses(entities)
		return g.Step(entities, 0, nil)
	}
	contacts := step()
	center, _ := entities.Get(1)
	far, _ := entities.Get(10)
	if center.Base().CollisionState.(*BodyRecord).Body.Neighborhood.Count != 8 {
		t.Fatal("center did not select eight game objects")
	}
	for _, contact := range contacts {
		if contact.Collider.Owner == far || contact.Other.Owner == far {
			t.Fatal("ninth object was checked")
		}
	}
	first, _ := entities.Get(2)
	first.Base().Position.X = 100
	contacts = step()
	found := false
	for _, contact := range contacts {
		found = found || contact.Collider.Owner == far || contact.Other.Owner == far
	}
	if !found {
		t.Fatal("deferred collision was not reconsidered next update")
	}
}

func BenchmarkNearestObjectCollisions(b *testing.B) {
	catalog, err := definitions.Load()
	if err != nil {
		b.Fatal(err)
	}
	old := limitCollisionNeighbors
	b.Cleanup(func() { limitCollisionNeighbors = old })
	for _, count := range []int{16, 32, 64} {
		for _, limit := range []bool{false, true} {
			b.Run(fmt.Sprintf("%d/limit=%t", count, limit), func(b *testing.B) {
				limitCollisionNeighbors = limit
				g := NewGameCollisions(catalog)
				entities := utilities.NewOrderedMap[int64, simulation.Entity]()
				for i := range count {
					o := simulation.NewGameObject(simulation.ObjectProperties{ID: new(int64(i + 1)), Radius: new(8.0), Health: new(1e9)}, catalog.Simulation)
					entities.Set(o.ID, o)
				}
				for b.Loop() {
					entities.ForEach(func(e simulation.Entity, id int64) {
						e.Base().Position = Vec.Create(float64((id-1)%8)*6, float64((id-1)/8)*6)
					})
					g.CapturePoses(entities)
					events := []protocol.SimulationEvent{}
					g.Step(entities, 1.0/30, &events)
				}
			})
		}
	}
}
