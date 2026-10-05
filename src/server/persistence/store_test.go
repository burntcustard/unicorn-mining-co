package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

const fixtureID = "12345678-9abc-4def-8012-3456789abcde"

func fixtureBatch(t testing.TB) Batch {
	t.Helper()
	catalog, err := definitions.Load()

	if err != nil {
		t.Fatal(err)
	}

	w := simulation.CreateWorld(25, catalog)
	id := int64(1)
	ship := objects.CreatePlayerShip(w, objects.Properties{ObjectProperties: simulation.ObjectProperties{PlayerID: &id}})
	return Batch{Sequence: 1, World: World{Seed: 25, GenerationDigest: GenerationDigest(catalog), RandomState: w.Random.State, NextEntityID: 1 << 32}, Players: []Player{{ID: fixtureID, FirstJoinedAt: time.Now().UTC(), LastSeenAt: time.Now().UTC(), Credits: 500, UnlockedPaints: DefaultPaints, Ship: objects.CaptureShip(ship)}}}
}

func BenchmarkSQLiteMovementBatch(b *testing.B) {
	s, err := Open(filepath.Join(b.TempDir(), "world.sqlite"), "")

	if err != nil {
		b.Fatal(err)
	}

	defer s.Close(context.Background())
	batch := fixtureBatch(b)
	catalog, _ := definitions.Load()
	w := simulation.CreateWorld(25, catalog)

	for i := 0; i < 8; i++ {
		a := simulation.CreateAsteroid(w, simulation.AsteroidProperties{Contents: []int{1, 2}}).LockGeometry()
		a.Segments()[0].Health -= 0.25
		batch.Entities = append(batch.Entities, Entity{ID: a.ID, State: objects.CaptureEntity(a)})
	}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		batch.World.Tick++
		batch.Players[0].Ship.Position[0]++

		for j := range batch.Entities {
			batch.Entities[j].State.Object.Rotation += 0.01
		}

		if err := s.save(context.Background(), batch); err != nil {
			b.Fatal(err)
		}
	}
}

func waitCommit(t *testing.T, s *Store, sequence uint64) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)

	for s.Committed() < sequence {
		if time.Now().After(deadline) {
			t.Fatalf("commit timeout: %v", s.Err())
		}

		time.Sleep(time.Millisecond)
	}
}

func TestSQLiteDurabilityAndBackup(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "world.sqlite")
	s, err := Open(path, filepath.Join(directory, "backups"))

	if err != nil {
		t.Fatal(err)
	}

	if other, err := Open(path, ""); err == nil {
		other.Close(context.Background())
		t.Fatal("two owners can overwrite the same world")
	}

	s.Start()
	batch := fixtureBatch(t)
	batch.World.Tick, batch.World.RandomState = 748, 123456.25
	batch.World.NextEntityID, batch.World.NextObjectID = 1<<32+100, -1000

	if !s.Submit(batch) {
		t.Fatal("queue rejected initial batch")
	}

	waitCommit(t, s, 1)

	if err := s.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, err = Open(path, filepath.Join(directory, "backups"))

	if err != nil {
		t.Fatal(err)
	}

	defer s.Close(context.Background())
	saved, err := s.Load(25)

	if err != nil || saved.World == nil || *saved.World != batch.World || len(saved.Players) != 1 || saved.Players[0].Visited == nil || len(saved.Players[0].Visited) != 0 || saved.Players[0].Credits != 500 {
		t.Fatalf("restart: %+v %v", saved, err)
	}

	if _, err := s.Load(26); err == nil {
		t.Fatal("seed mismatch was silently accepted")
	}

	if err := s.Backup(context.Background()); err != nil {
		t.Fatal(err)
	}

	files, _ := filepath.Glob(filepath.Join(directory, "backups", "*.sqlite"))

	if len(files) != 1 {
		t.Fatal("no completed backup")
	}

	backup, err := Open(files[0], "")

	if err != nil {
		t.Fatal(err)
	}

	copy, err := backup.Load(25)
	backup.Close(context.Background())

	if err != nil || copy.World == nil || *copy.World != batch.World || len(copy.Players) != 1 || copy.Players[0].Credits != 500 || copy.Players[0].ID != fixtureID {
		t.Fatal("backup cannot restore progress", err)
	}
}

func TestWholePlayerValues(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "world.sqlite"), "")

	if err != nil {
		t.Fatal(err)
	}

	defer s.Close(context.Background())
	batch := fixtureBatch(t)
	p := &batch.Players[0]
	p.Credits, p.PlayedFor = 500.6, 12.4

	if err := s.save(context.Background(), batch); err != nil {
		t.Fatal(err)
	}

	saved, err := s.Load(25)

	if err != nil {
		t.Fatal(err)
	}

	restored := saved.Players[0]

	if restored.Credits != 501 || restored.PlayedFor != 12 || restored.FirstJoinedAt.Nanosecond() != 0 || restored.LastSeenAt.Nanosecond() != 0 {
		t.Fatal("values were not stored as whole seconds/credits", restored)
	}

	var creditType, timeType, joinedType string
	var blob []byte

	if err := s.db.QueryRow("SELECT typeof(credits),typeof(played_for),typeof(first_joined_at),ship FROM players WHERE id=?", fixtureID).Scan(&creditType, &timeType, &joinedType, &blob); err != nil {
		t.Fatal(err)
	}

	var ship objects.SavedShip

	if err := json.Unmarshal(blob, &ship); err != nil {
		t.Fatal(err)
	}

	if creditType != "integer" || timeType != "integer" || joinedType != "integer" || p.Credits != 500.6 {
		t.Fatal("duplicated balance, fractional SQL value, or mutation of live mechanics")
	}

	if _, err := s.db.Exec("UPDATE players SET credits=1.5 WHERE id=?", fixtureID); err == nil {
		t.Fatal("fractional SQL balance accepted")
	}

}

func TestQueuedSavesCoalesceAtomically(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "world.sqlite"), "")

	if err != nil {
		t.Fatal(err)
	}

	defer s.Close(context.Background())

	if _, err := s.db.Exec(`CREATE TABLE commits(id INTEGER);
	CREATE TRIGGER count_insert AFTER INSERT ON world BEGIN INSERT INTO commits VALUES(1); END;
	CREATE TRIGGER count_update AFTER UPDATE ON world BEGIN INSERT INTO commits VALUES(1); END;`); err != nil {
		t.Fatal(err)
	}

	for i := 1; i <= cap(s.queue); i++ {
		batch := fixtureBatch(t)
		batch.Sequence, batch.World.Tick = uint64(i), uint64(i)
		batch.Players[0].Credits = float64(i)

		if i == 1 {
			batch.Entities = []Entity{{ID: 123, Generated: true, State: objects.SavedEntity{Object: objects.SavedObject{ID: 123, Position: Vec.Create(1, 2)}}}}
		}

		if i == cap(s.queue) {
			batch.Entities = []Entity{{ID: 123, Generated: true, Deleted: true}}
		}

		if !s.Submit(batch) {
			t.Fatal("queue rejected a batch within its capacity")
		}
	}

	if s.HasCapacity() || s.Submit(Batch{}) {
		t.Fatal("queue exceeded its bound")
	}

	s.Start()
	waitCommit(t, s, uint64(cap(s.queue)))
	saved, err := s.Load(25)

	if err != nil || saved.World.Tick != uint64(cap(s.queue)) || saved.Players[0].Credits != float64(cap(s.queue)) || len(saved.Entities) != 1 || !saved.Entities[0].Deleted {
		t.Fatal("coalescing lost final state", err)
	}

	var commits int

	if err := s.db.QueryRow("SELECT count(*) FROM commits").Scan(&commits); err != nil {
		t.Fatal(err)
	}

	if commits != 1 {
		t.Fatalf("backlog used %d commits instead of one", commits)
	}
}

func TestFailedTransactionRetriedAtomically(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "world.sqlite"), "")

	if err != nil {
		t.Fatal(err)
	}

	defer s.Close(context.Background())

	if _, err := s.db.Exec(`CREATE TRIGGER fail_save BEFORE INSERT ON entities BEGIN SELECT RAISE(ABORT,'injected disk failure'); END`); err != nil {
		t.Fatal(err)
	}

	s.Start()
	batch := fixtureBatch(t)
	batch.Entities = []Entity{{ID: 123, Generated: true, Deleted: true}}
	s.Submit(batch)
	deadline := time.Now().Add(3 * time.Second)

	for s.Err() == nil {
		if time.Now().After(deadline) {
			t.Fatal("storage failure not reported")
		}

		time.Sleep(time.Millisecond)
	}

	var count int

	if err := s.db.QueryRow("SELECT count(*) FROM players").Scan(&count); err != nil || count != 0 {
		t.Fatal("failed transaction partially saved credits", count, err)
	}

	if s.Committed() != 0 {
		t.Fatal("failed write acknowledged")
	}

	if _, err := s.db.Exec("DROP TRIGGER fail_save"); err != nil {
		t.Fatal(err)
	}

	waitCommit(t, s, 1)
	saved, err := s.Load(25)

	if err != nil || len(saved.Players) != 1 || len(saved.Entities) != 1 || !saved.Entities[0].Deleted {
		t.Fatal("retry lost part of atomic batch", err)
	}
}

func TestRejectCorruptionAndFutureSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")

	if err := os.WriteFile(path, []byte("not a database"), 0600); err != nil {
		t.Fatal(err)
	}

	if s, err := Open(path, ""); err == nil {
		s.Close(context.Background())
		t.Fatal("corrupt database accepted")
	}

	os.Remove(path)
	db, err := sql.Open("sqlite", path)

	if err != nil {
		t.Fatal(err)
	}

	if _, err := db.Exec("PRAGMA user_version=999"); err != nil {
		t.Fatal(err)
	}

	db.Close()

	if s, err := Open(path, ""); err == nil {
		s.Close(context.Background())
		t.Fatal("future database schema accepted")
	}
}
