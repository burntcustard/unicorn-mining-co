package network

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestAsteroidRadarPositionsBeyondEntityLoad(t *testing.T) {
	t.Parallel()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ranges := catalog.Simulation.Replication
	radarRange := catalog.Simulation.ServerRegionRanges["asteroid"]
	positions := []float64{1000, ranges.EntityLoad + 1, ranges.EntityUnload, ranges.EntityUnload + 1, radarRange, radarRange + 1, 100}

	for i, x := range positions {
		id := int64(i + 2)
		object := simulation.NewGameObject(simulation.ObjectProperties{ID: &id, Position: Vec.Create(x, 0)}, catalog.Simulation)
		object.Kind = "asteroid"
		object.Dead = i == len(positions)-1
		simulation.AddEntity(world, object)
	}

	manager := NewBinaryReplicationManager(catalog)
	options := SnapshotOptions{World: world, ShipID: 1}
	packet := manager.Initial(options)

	if packet[3]&64 == 0 || len(manager.asteroidPositions) != 5 {
		t.Fatalf("initial radar positions: flags=%d positions=%v", packet[3], manager.asteroidPositions)
	}

	for _, id := range []int64{3, 4, 5, 6, 7} {
		if manager.members[id] != nil {
			t.Fatalf("distant asteroid %d loaded full geometry", id)
		}
	}

	if manager.asteroidPositions[2].X != ranges.EntityUnload {
		t.Fatal("radar does not reach its edge")
	}

	if manager.asteroidPositions[4].X != radarRange || radarRange <= ranges.EntityUnload {
		t.Fatal("radar omits asteroid centers beyond the visible map edge")
	}

	world.Tick += uint64(catalog.Simulation.BallisticReplicateEvery)
	packet = manager.Snapshot(options)

	if packet[3]&64 != 0 {
		t.Fatal("unchanged radar resent its position list")
	}

	object, _ := world.Entities.Get(3)
	object.Base().Position.Y = 1
	world.Tick++

	if manager.Snapshot(options)[3]&64 != 0 {
		t.Fatal("radar exceeded its refresh cadence")
	}

	world.Tick += uint64(catalog.Simulation.BallisticReplicateEvery)

	if manager.Snapshot(options)[3]&64 == 0 || manager.asteroidPositions[1].Y != 1 {
		t.Fatal("radar did not refresh a moving asteroid")
	}

	world.Entities.Clear()
	world.Tick += uint64(catalog.Simulation.BallisticReplicateEvery)

	if manager.Snapshot(options)[3]&64 == 0 || len(manager.asteroidPositions) != 0 {
		t.Fatal("empty radar did not clear previous positions")
	}

	if manager.Initial(options)[3]&64 == 0 {
		t.Fatal("reload omitted the authoritative radar list")
	}
}
