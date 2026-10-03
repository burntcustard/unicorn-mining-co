package network

import (
	"bytes"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

func TestNumericFieldCachePreservesCanonicalChanges(t *testing.T) {
	for _, id := range []int{1, 34, 65} {
		record := &binaryRecord{fields: make([]fieldState, 70), numberValues: make([]float64, 70)}
		reference := &binaryRecord{fields: make([]fieldState, 70)}
		for _, value := range []any{0., math.Copysign(0, -1), 2., 2., math.NaN(), math.Inf(1), 3., "changed", 3., nil, 3., math.Inf(-1), 0.} {
			if number, ok := value.(float64); ok {
				scalarNumber(record, id, number)
			} else {
				scalar(record, id, value)
			}
			scalar(reference, id, value)
			if record.revision != reference.revision || record.fields[id] != reference.fields[id] {
				t.Fatalf("field %d value %v: got %+v rev%d want %+v rev%d", id, value, record.fields[id], record.revision, reference.fields[id], reference.revision)
			}
		}
	}
}

func TestMembershipCacheSurvivesReorderReplacementAndEviction(t *testing.T) {
	catalog, err := definitions.Load()
	if err != nil {
		t.Fatal(err)
	}
	world := simulation.CreateWorld(25, catalog)
	objects := make([]*simulation.GameObject, 20)
	for i := range objects {
		id := int64(i + 1)
		objects[i] = simulation.NewGameObject(simulation.ObjectProperties{ID: &id}, catalog.Simulation)
		simulation.AddEntity(world, objects[i])
	}
	cached, reference := NewBinaryReplicationManager(catalog), NewBinaryReplicationManager(catalog)
	compare := func(initial bool) {
		world.Tick++
		options := SnapshotOptions{World: world, ShipID: 1}
		clear(reference.memberCache)
		var a, b []byte
		if initial {
			a = cached.encode(options, true)
			b = reference.Initial(options)
		} else {
			a = cached.Snapshot(options)
			b = reference.Snapshot(options)
		}
		if !bytes.Equal(a, b) {
			t.Fatalf("tick %d: ordinal cache changed packet", world.Tick)
		}
	}
	compare(true)
	compare(false)
	world.Entities.Delete(2)
	world.Entities.Set(2, objects[1])
	compare(false)
	replacement := simulation.NewGameObject(simulation.ObjectProperties{ID: &objects[3].ID, Position: Vec.Create(3, 4)}, catalog.Simulation)
	world.Entities.Set(replacement.ID, replacement)
	compare(false)
	objects[8].Position.X = catalog.Simulation.Replication.EntityUnload + 1000
	compare(false)
	if _, exists := cached.members[objects[8].ID]; exists {
		t.Fatal("far member retained")
	}
	objects[8].Position.X = 0
	compare(false)
	for i := 2; i < len(objects); i++ {
		world.Entities.Delete(objects[i].ID)
	}
	compare(false)
	compare(true)
	compare(false)
}

func TestPackedCadenceRetainsFallbackForForeignViews(t *testing.T) {
	for _, test := range []struct {
		interval int
		id       int64
	}{{8, 13}, {16, 13}, {65, 63}} {
		catalog, err := definitions.Load()
		if err != nil {
			t.Fatal(err)
		}
		worldCatalog := catalog
		worldCatalog.Simulation.BallisticReplicateEvery = test.interval
		world := simulation.CreateWorld(25, worldCatalog)
		object := simulation.NewGameObject(simulation.ObjectProperties{ID: &test.id}, catalog.Simulation)
		object.Ballistic = true
		object.Kind = "asteroid"
		simulation.AddEntity(world, object)
		manager := NewBinaryReplicationManager(catalog)
		options := SnapshotOptions{World: world, ShipID: test.id}
		manager.Initial(options)
		for tick := uint64(1); tick <= 32; tick++ {
			previous := manager.members[test.id].revision
			object.Spin = float64(tick)
			world.Tick = tick
			phase := uint64(test.id % int64(test.interval))
			due := replicationDue(tick+phase, tick-1+phase, max(catalog.Simulation.UpdateTiers["visible"].ReplicateEvery, catalog.Simulation.BallisticReplicateEvery))
			manager.Snapshot(options)
			if (manager.members[test.id].revision != previous) != due {
				t.Fatalf("interval %d id %d tick %d: cadence differs", test.interval, test.id, tick)
			}
		}
	}
}

func TestStationaryPlayerOmitsUnchangedFragments(t *testing.T) {
	catalog, err := definitions.Load()
	if err != nil {
		t.Fatal(err)
	}
	world := simulation.CreateWorld(25, catalog)
	id := int64(1)
	ship := objects.CreateShip(world, objects.Properties{PlayerID: &id})
	batch := NewBinarySnapshotBatch(catalog)
	batch.Begin(NewReplicationView(world))
	record := batch.prepared(ship)
	revision := record.revision
	for tick := 1; tick <= 90; tick++ {
		batch.Begin(NewReplicationView(world))
		record = batch.prepared(ship)
		if _, ok := batch.fragment(record, revision, nil); ok || len(batch.arena) != 0 {
			t.Fatalf("tick %d: unchanged player state must be omitted", tick)
		}
	}
	ship.DockedTo = &id
	batch.Begin(NewReplicationView(world))
	record = batch.prepared(ship)
	revision = record.revision
	if _, ok := batch.fragment(record, revision, nil); ok {
		t.Fatal("unchanged docked ships need no heartbeat")
	}
}
