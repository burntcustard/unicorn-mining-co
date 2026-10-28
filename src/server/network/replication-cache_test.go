package network

import (
	"bytes"
	"fmt"
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func BenchmarkDormantPlayerTicks(b *testing.B) {
	catalog, err := specs.Load()

	if err != nil {
		b.Fatal(err)
	}

	for _, count := range []int{0, 1024, 8192} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			session := NewGameSession(25, catalog)
			sockets := make([]*benchmarkSocket, 32)

			for index := range sockets {
				sockets[index] = &benchmarkSocket{}
				session.Receive(protocol.Control{Type: "hello"}, sockets[index])
			}

			for index := range count {
				session.players.Set(fmt.Sprint(index), &playerRecord{sectorID: session.currentSector, hiddenShip: true, ship: session.playersBySocket[sockets[0]].ship})
			}

			b.ReportAllocs()
			b.ResetTimer()

			for range b.N {
				for _, socket := range sockets {
					session.Receive(protocol.Control{Type: "snapshotAck", Sequence: socket.sequence}, socket)
				}

				session.Tick(1)
			}
		})
	}
}

func BenchmarkAsteroidPreparation(b *testing.B) {
	catalog, err := specs.Load()

	if err != nil {
		b.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	asteroids := make([]*simulation.Asteroid, 256)

	for index := range asteroids {
		asteroid := simulation.CreateAsteroid(world, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Radius: new(120.0)}, Contents: []int{1, 2}}).LockGeometry()
		asteroid.Segments()[0].Health -= 0.25
		asteroids[index] = asteroid
	}

	batch := NewBinarySnapshotBatch(catalog)
	b.ReportAllocs()
	b.ResetTimer()

	for range b.N {
		batch.Begin(nil)

		for index, asteroid := range asteroids {
			if index < 32 {
				asteroid.Segments()[0].Health -= 1e-6
			}

			batch.prepared(asteroid)
		}
	}
}

func BenchmarkSparseReplication(b *testing.B) {
	catalog, err := specs.Load()

	if err != nil {
		b.Fatal(err)
	}

	session := NewGameSession(25, catalog)
	managers := make([]*BinaryReplicationManager, 32)
	options := make([]SnapshotOptions, len(managers))
	view := NewReplicationView(session.World)
	batch := NewBinarySnapshotBatch(catalog)

	for index := range managers {
		socket := &benchmarkSocket{}
		session.Receive(protocol.Control{Type: "hello"}, socket)
		ship := session.playersBySocket[socket].ship
		ship.Position = Vec.Create(float64(index)*10000, 0)
		managers[index] = NewBinaryReplicationManager(catalog)
		options[index] = SnapshotOptions{World: session.World, ShipID: ship.ID, ReplicationView: view, BinaryBatch: batch}
	}

	for index := range 4096 {
		id := int64(1000000 + index)
		object := simulation.NewGameObject(simulation.ObjectProperties{ID: &id, Position: Vec.Create(float64(index%32)*10000, float64(index/32)*20)}, catalog.Simulation)
		simulation.AddEntity(session.World, object)
	}

	b.ReportAllocs()
	b.ResetTimer()

	for range b.N {
		session.World.Tick++
		view.Reset()
		batch.Begin(view)

		for index, manager := range managers {
			manager.encode(options[index], false)
		}
	}
}

func TestSpatialReplicationMatchesOriginalScan(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	session := NewGameSession(25, catalog)
	world := session.World
	cached := make([]*BinaryReplicationManager, 32)
	reference := make([]*BinaryReplicationManager, len(cached))
	shipIDs := make([]int64, len(cached))

	for index := range cached {
		socket := &benchmarkSocket{}
		session.Receive(protocol.Control{Type: "hello"}, socket)
		ship := session.playersBySocket[socket].ship
		ship.Position = Vec.Create(float64(index)*10000, 0)
		shipIDs[index] = ship.ID
		cached[index] = NewBinaryReplicationManager(catalog)
		reference[index] = NewBinaryReplicationManager(catalog)
	}

	objects := make([]*simulation.GameObject, 1024)

	for index := range objects {
		id := int64(1000000 + index)
		object := simulation.NewGameObject(simulation.ObjectProperties{ID: &id, Position: Vec.Create(float64(index%32)*10000, float64(index/32)*20)}, catalog.Simulation)
		objects[index] = object
		simulation.AddEntity(world, object)
	}

	view, original := NewReplicationView(world), NewReplicationView(world)
	batch, originalBatch := NewBinarySnapshotBatch(catalog), NewBinarySnapshotBatch(catalog)
	var preparedChange func()

	compare := func() {
		t.Helper()
		world.Tick++
		view.Reset()
		original.Reset()
		view.Entities()
		original.Entities()

		if preparedChange != nil {
			preparedChange()
			preparedChange = nil
		}

		original.spatialPrepared, original.spatialUsable = true, false
		batch.Begin(view)
		originalBatch.Begin(original)

		for index := range cached {
			options := SnapshotOptions{World: world, ShipID: shipIDs[index], ReplicationView: view, BinaryBatch: batch}
			packet := cached[index].encode(options, false)
			options.ReplicationView, options.BinaryBatch = original, originalBatch

			if !bytes.Equal(packet, reference[index].encode(options, false)) {
				t.Fatalf("tick %d observer %d: spatial filtering changed the snapshot", world.Tick, index)
			}
		}
	}

	compare()
	compare()
	compare()

	if !view.spatialUsable {
		t.Fatal("stable sparse views must exercise spatial filtering")
	}

	for _, distance := range []float64{2500, 3000, math.Nextafter(3000, math.Inf(1)), -3000, 11000} {
		objects[0].Position = Vec.Create(distance, 0)
		compare()
	}

	objects[0].Kind = "station"
	compare()
	objects[0].Position.X = math.Nextafter(11000, math.Inf(1))
	compare()
	world.Entities.Delete(objects[1].ID)
	compare()
	world.Entities.Set(objects[1].ID, objects[1])
	compare()
	replacement := simulation.NewGameObject(simulation.ObjectProperties{ID: &objects[2].ID, Position: Vec.Create(-2999, 0)}, catalog.Simulation)
	world.Entities.Set(replacement.ID, replacement)
	compare()
	objects[3].Position.X = math.NaN()
	compare()
	objects[3].Position.X = 0
	compare()
	compare()

	preparedChange = func() {
		ship, _ := world.Entities.Get(shipIDs[0])
		ship.Base().Position.X = 1e8
	}

	compare()
}

func TestAsteroidSegmentWireReuseMatchesFreshCopies(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	asteroid := simulation.CreateAsteroid(world, simulation.AsteroidProperties{Contents: []int{1, 2}})
	segments := asteroid.Segments()
	segments[0].Contents = []int{1, 2}
	previous := copySegments(segments, nil)

	encode := func(value []protocol.AsteroidSegment) []byte {
		data, err := protocol.AppendField(nil, catalog.Protocol.BinaryFieldIDs.Segments, value, catalog.Protocol)

		if err != nil {
			t.Fatal(err)
		}

		return data
	}

	for _, change := range []struct {
		name   string
		mutate func()
	}{
		{"health", func() { segments[0].Health -= 0.25 }},
		{"contents", func() { segments[0].Contents[0]++ }},
		{"outline", func() { segments[0].ShapeOutline.Points[0][0] += 0.25 }},
		{"mass", func() { segments[0].Mass += 0.5 }},
		{"maxHealth", func() { segments[0].MaxHealth += 1 }},
		{"reorder", func() { segments[0], segments[1] = segments[1], segments[0] }},
		{"append", func() { segments = append(segments, segments[0]) }},
		{"remove", func() { segments = segments[1:] }},
		{"clear", func() { segments = nil }},
	} {
		t.Run(change.name, func(t *testing.T) {
			before := encode(previous)
			change.mutate()
			cached := copySegments(segments, previous)
			fresh := copySegments(segments, nil)

			if !bytes.Equal(encode(cached), encode(fresh)) {
				t.Fatal("reused segment data changed the wire payload")
			}

			if !bytes.Equal(before, encode(previous)) {
				t.Fatal("preparing new state mutated the previous snapshot")
			}

			if change.name == "health" && (&cached[0].Contents[0] != &previous[0].Contents[0] || &cached[0].ShapeOutline[0][0] != &previous[0].ShapeOutline[0][0]) {
				t.Fatal("health-only changes must reuse identical nested arrays")
			}

			previous = cached
		})
	}
}

func TestTickPlayerRosterPreservesVisibilityAndTravel(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	session := NewGameSession(25, catalog)
	connectedSocket, departingSocket, dormantSocket := &benchmarkSocket{}, &benchmarkSocket{}, &benchmarkSocket{}
	session.Receive(protocol.Control{Type: "prepare"}, connectedSocket)
	session.Receive(protocol.Control{Type: "hello"}, departingSocket)
	session.Receive(protocol.Control{Type: "prepare"}, dormantSocket)
	connected := session.playersBySocket[connectedSocket]
	departing := session.playersBySocket[departingSocket]
	session.Disconnect(departingSocket)
	session.Disconnect(dormantSocket)

	count := func() int {
		visited := 0

		session.sectorPlayers(func(*playerRecord, string) { visited++ })

		return visited
	}

	if count() != 3 {
		t.Fatal("ordinary traversal must retain saved players")
	}

	session.beginTickPlayers()

	if count() != 2 {
		t.Fatal("ticks must include connected and departing ships, not hidden disconnected records")
	}

	departing.sectorID = "other"

	if count() != 1 {
		t.Fatal("travel must immediately remove a player from the previous sector")
	}

	session.currentSector = "other"

	if count() != 1 {
		t.Fatal("travel must immediately expose a player in the destination sector")
	}

	session.endTickPlayers()

	if session.tickPlayersReady || len(session.tickPlayers) != 0 {
		t.Fatal("completed ticks must release the roster")
	}

	session.currentSector = connected.sectorID

	if count() != 2 {
		t.Fatal("out-of-tick traversal must still include hidden saved records")
	}
}

func TestNumericFieldCachePreservesCanonicalChanges(t *testing.T) {
	t.Parallel()

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
	t.Parallel()

	catalog, err := specs.Load()

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
	t.Parallel()

	for _, test := range []struct {
		interval int
		id       int64
	}{{8, 13}, {16, 13}, {65, 63}} {
		catalog, err := specs.Load()

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
	t.Parallel()

	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	id := int64(1)
	ship := objects.CreatePlayerShip(world, objects.Properties{PlayerID: &id})
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

func TestNPCStateIsReplicatedAndCleared(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{PlayerID: new(int64(1))})
	batch := NewBinarySnapshotBatch(catalog)

	for _, state := range []string{"Pursuing", "Waiting", "Fighting", "Collecting", ""} {
		ship.NPCState = state
		batch.Begin(NewReplicationView(world))
		record := batch.prepared(ship)
		value := record.fields[catalog.Protocol.BinaryFieldIDs.NPCState].wire

		if state == "" && value != nil || state != "" && value != state {
			t.Fatalf("NPC state %q replicated as %v", state, value)
		}
	}
}

func TestEntityReplicationLoadAndUnloadBoundaries(t *testing.T) {
	t.Parallel()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	id, radius := int64(2), 0.0
	object := simulation.NewGameObject(simulation.ObjectProperties{ID: &id, Radius: &radius}, catalog.Simulation)
	simulation.AddEntity(world, object)
	manager := NewBinaryReplicationManager(catalog)
	ranges := catalog.Simulation.Replication

	check := func(distance float64, expected bool) {
		t.Helper()
		object.Position.X = distance
		world.Tick++
		manager.Snapshot(SnapshotOptions{World: world, ShipID: 1})
		_, loaded := manager.members[id]

		if loaded != expected {
			t.Fatalf("distance %v: loaded=%v, want %v", distance, loaded, expected)
		}
	}

	check(ranges.EntityLoad+1, false)
	check(ranges.EntityLoad, true)
	check(ranges.EntityUnload, true)
	check(ranges.EntityUnload+1, false)
	check(ranges.EntityLoad+1, false)
	check(ranges.EntityLoad, true)
}
