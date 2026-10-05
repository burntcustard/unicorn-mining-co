// SQLite is a durable copy of the in-memory world. The background writer
// encodes and commits records; backups use a separate read connection.
package persistence

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/gob"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"log"
	"math"
	"modernc.org/sqlite"
	"os"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"time"
)

const SchemaVersion = 4
const DefaultPaints uint8 = 1<<2 | 1<<5 | 1<<6

type World struct {
	GenerationDigest string
	Seed             float64
	Tick             uint64
	RandomState      float64
	NextEntityID     int64
	NextObjectID     int64
}

func GenerationDigest(catalog definitions.Catalog) string {
	data, _ := json.Marshal(struct {
		Rules      definitions.RegionGeneration
		RegionSize float64
		ItemIDs    []string
	}{catalog.RegionGeneration, catalog.Simulation.RegionSize, catalog.ItemIDs})

	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

type Player struct {
	ID, DisplayName           string
	FirstJoinedAt, LastSeenAt time.Time
	// PlayedFor is connected playtime in seconds; fractions accumulate in memory.
	PlayedFor      float64
	Credits        float64
	UnlockedPaints uint8
	// Visited records docked-to craft IDs in chronological order, including repeats.
	Visited []int64
	Ship    objects.SavedShip
}

type Entity struct {
	ID                 int64
	Generated, Deleted bool
	State              objects.SavedEntity
}

type Batch struct {
	Sequence uint64
	World    World
	Players  []Player
	Entities []Entity
}

type SavedWorld struct {
	World    *World
	Players  []Player
	Entities []Entity
}

type storeError struct{ err error }

type Store struct {
	path            string
	db              *sql.DB
	lock            *os.File
	queue           chan Batch
	done            chan struct{}
	backupsDone     chan struct{}
	cancel          context.CancelFunc
	committed       atomic.Uint64
	failure         atomic.Pointer[storeError]
	backupDirectory string
}

func Encode(value any) ([]byte, error) {
	var b bytes.Buffer
	err := gob.NewEncoder(&b).Encode(value)
	return b.Bytes(), err
}

func Decode(data []byte, value any) error { return gob.NewDecoder(bytes.NewReader(data)).Decode(value) }

func Open(path, backupDirectory string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}

	lock, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)

	if err != nil {
		return nil, err
	}

	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		return nil, fmt.Errorf("database is in use by another game server: %w", err)
	}

	db, err := sql.Open("sqlite", path)

	if err != nil {
		lock.Close()
		return nil, err
	}

	db.SetMaxOpenConns(1)

	s := &Store{path: path, db: db, lock: lock, queue: make(chan Batch, 64), done: make(chan struct{}), backupsDone: make(chan struct{}), backupDirectory: backupDirectory}

	if err = s.initialize(); err != nil {
		db.Close()
		lock.Close()
		return nil, err
	}

	return s, nil
}

func (s *Store) initialize() error {
	for _, statement := range []string{"PRAGMA busy_timeout=1000", "PRAGMA journal_mode=WAL", "PRAGMA synchronous=FULL", "PRAGMA wal_autocheckpoint=1000"} {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}

	var version int

	if err := s.db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}

	if version != 0 && version != SchemaVersion {
		return fmt.Errorf("unsupported database schema %d; this server requires %d", version, SchemaVersion)
	}

	if version == SchemaVersion {
		return nil
	}

	tx, err := s.db.Begin()

	if err != nil {
		return err
	}

	defer tx.Rollback()

	if _, err = tx.Exec(`CREATE TABLE world (
  id INTEGER PRIMARY KEY CHECK(id=1), seed REAL NOT NULL,
  generation_digest TEXT NOT NULL, tick INTEGER NOT NULL,
  random_state REAL NOT NULL, next_entity_id INTEGER NOT NULL,
  next_object_id INTEGER NOT NULL
);
		CREATE TABLE entities (id INTEGER PRIMARY KEY, generated INTEGER NOT NULL, deleted INTEGER NOT NULL, state BLOB);`); err != nil {
		return err
	}

	if _, err = tx.Exec(`CREATE TABLE players (
  id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL DEFAULT '',
  first_joined_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  played_for INTEGER NOT NULL CHECK(typeof(played_for)='integer' AND played_for>=0),
  credits INTEGER NOT NULL CHECK(typeof(credits)='integer' AND credits>=0),
  unlocked_paints INTEGER NOT NULL CHECK(unlocked_paints BETWEEN 0 AND 127),
  visited TEXT NOT NULL, ship TEXT NOT NULL
 ) WITHOUT ROWID`); err != nil {
		return err
	}

	if _, err = tx.Exec(fmt.Sprintf("PRAGMA user_version=%d", SchemaVersion)); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Store) Load(seed float64) (SavedWorld, error) {
	var saved SavedWorld
	var data []byte
	var world World
	err := s.db.QueryRow("SELECT seed,generation_digest,tick,random_state,next_entity_id,next_object_id FROM world WHERE id=1").Scan(
		&world.Seed, &world.GenerationDigest, &world.Tick, &world.RandomState, &world.NextEntityID, &world.NextObjectID)

	if errors.Is(err, sql.ErrNoRows) {
		return saved, nil
	}

	if err != nil {
		return saved, err
	}

	if world.Seed != seed {
		return saved, fmt.Errorf("saved world seed differs; use a fresh world database before changing WORLD_SEED")
	}

	saved.World = &world

	rows, err := s.db.Query("SELECT id,display_name,first_joined_at,last_seen_at,played_for,credits,unlocked_paints,visited,ship FROM players ORDER BY id")

	if err != nil {
		return saved, err
	}

	for rows.Next() {
		var p Player
		var joined, seen int64
		var visits, ship []byte

		if err = rows.Scan(&p.ID, &p.DisplayName, &joined, &seen, &p.PlayedFor, &p.Credits, &p.UnlockedPaints, &visits, &ship); err != nil {
			break
		}

		p.FirstJoinedAt, p.LastSeenAt = time.Unix(joined, 0).UTC(), time.Unix(seen, 0).UTC()

		if err = json.Unmarshal(visits, &p.Visited); err != nil {
			break
		}

		if err = json.Unmarshal(ship, &p.Ship); err != nil {
			break
		}

		saved.Players = append(saved.Players, p)
	}

	if err == nil {
		err = rows.Err()
	}

	rows.Close()

	if err != nil {
		return saved, err
	}

	rows, err = s.db.Query("SELECT id,generated,deleted,state FROM entities ORDER BY id")

	if err != nil {
		return saved, err
	}

	defer rows.Close()

	for rows.Next() {
		var e Entity

		if err = rows.Scan(&e.ID, &e.Generated, &e.Deleted, &data); err != nil {
			return saved, err
		}

		if !e.Deleted {
			if err = Decode(data, &e.State); err != nil {
				return saved, err
			}

			if e.State.Object.ID != e.ID {
				return saved, fmt.Errorf("saved entity ID mismatch: %d", e.ID)
			}
		}

		saved.Entities = append(saved.Entities, e)
	}

	return saved, rows.Err()
}

func (s *Store) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	go s.run(ctx)
	go s.runBackups(ctx)
}

func (s *Store) Submit(batch Batch) bool {
	select {
	case s.queue <- batch:
		return true
	default:
		return false
	}
}

// The world owner can skip copying records while the bounded queue is full.
func (s *Store) HasCapacity() bool { return len(s.queue) < cap(s.queue) }

func (s *Store) Committed() uint64 { return s.committed.Load() }

func (s *Store) Err() error {
	if failure := s.failure.Load(); failure != nil {
		return failure.err
	}

	return nil
}

func (s *Store) run(ctx context.Context) {
	defer close(s.done)

	for {
		select {
		case <-ctx.Done():
			return
		case batch, ok := <-s.queue:
			if !ok {
				return
			}

			batch = s.coalesce(batch)

			for {
				err := s.save(ctx, batch)

				if err == nil {
					s.failure.Store(nil)
					s.committed.Store(batch.Sequence)
					break
				}

				if s.failure.Swap(&storeError{err}) == nil {
					log.Printf("SQLite writes failed; durable gameplay paused: %v", err)
				}

				timer := time.NewTimer(time.Second)

				select {
				case <-ctx.Done():
					timer.Stop()
					return
				case <-timer.C:
				}
			}
		}
	}
}

// Combine an existing backlog without delaying a save to wait for more work.
// Latest records supersede earlier ones, retaining every affected player/entity
// in the same atomic transaction and acknowledging only its final sequence.
func (s *Store) coalesce(first Batch) Batch {
	batches := []Batch{first}

drain:
	for range cap(s.queue) {
		select {
		case batch, ok := <-s.queue:
			if !ok {
				break drain
			}

			batches = append(batches, batch)
		default:
			break drain
		}
	}

	if len(batches) == 1 {
		return first
	}

	players := map[string]Player{}
	entities := map[int64]Entity{}

	for _, batch := range batches {
		for _, p := range batch.Players {
			players[p.ID] = p
		}

		for _, e := range batch.Entities {
			entities[e.ID] = e
		}
	}

	merged := batches[len(batches)-1]
	merged.Players, merged.Entities = nil, nil

	for _, p := range players {
		merged.Players = append(merged.Players, p)
	}

	for _, e := range entities {
		merged.Entities = append(merged.Entities, e)
	}

	return merged
}

func (s *Store) runBackups(ctx context.Context) {
	defer close(s.backupsDone)
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if s.backupDirectory != "" && s.Committed() > 0 {
				if err := s.Backup(ctx); err != nil && ctx.Err() == nil {
					log.Printf("SQLite backup failed: %v", err)
				}
			}
		}
	}
}

func (s *Store) save(ctx context.Context, batch Batch) error {
	// Encode outside the transaction, avoiding long-lived database locks.
	var err error

	type encodedPlayer struct {
		player       Player
		ship, visits []byte
	}

	players := make([]encodedPlayer, len(batch.Players))

	for i, p := range batch.Players {
		players[i].player = p

		if players[i].ship, err = json.Marshal(p.Ship); err != nil {
			return err
		}

		if p.Visited == nil {
			p.Visited = []int64{}
		}

		if players[i].visits, err = json.Marshal(p.Visited); err != nil {
			return err
		}
	}

	entities := make([][]byte, len(batch.Entities))

	for i, e := range batch.Entities {
		if !e.Deleted {
			if entities[i], err = Encode(e.State); err != nil {
				return err
			}
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)

	if err != nil {
		return err
	}

	defer tx.Rollback()

	w := batch.World

	if _, err = tx.ExecContext(ctx, `INSERT INTO world(id,seed,generation_digest,tick,random_state,next_entity_id,next_object_id)
  VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET seed=excluded.seed,generation_digest=excluded.generation_digest,tick=excluded.tick,random_state=excluded.random_state,next_entity_id=excluded.next_entity_id,next_object_id=excluded.next_object_id`,
		w.Seed, w.GenerationDigest, w.Tick, w.RandomState, w.NextEntityID, w.NextObjectID); err != nil {
		return err
	}

	for _, encoded := range players {
		p := encoded.player

		_, err = tx.ExecContext(ctx, `INSERT INTO players(id,display_name,first_joined_at,last_seen_at,played_for,credits,unlocked_paints,visited,ship)
  VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,last_seen_at=excluded.last_seen_at,played_for=excluded.played_for,credits=excluded.credits,unlocked_paints=excluded.unlocked_paints,visited=excluded.visited,ship=excluded.ship`,
			p.ID, p.DisplayName, p.FirstJoinedAt.Unix(), p.LastSeenAt.Unix(), int64(math.Round(p.PlayedFor)), int64(math.Round(p.Credits)), p.UnlockedPaints, string(encoded.visits), string(encoded.ship))

		if err != nil {
			return err
		}
	}

	for i, e := range batch.Entities {
		if e.Deleted && !e.Generated {
			if _, err = tx.ExecContext(ctx, "DELETE FROM entities WHERE id=?", e.ID); err != nil {
				return err
			}

			continue
		}

		if _, err = tx.ExecContext(ctx, `INSERT INTO entities(id,generated,deleted,state) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET generated=excluded.generated,deleted=excluded.deleted,state=excluded.state WHERE entities.state IS NOT excluded.state OR entities.generated!=excluded.generated OR entities.deleted!=excluded.deleted`, e.ID, e.Generated, e.Deleted, entities[i]); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) Close(ctx context.Context) error {
	var err error

	if s.cancel != nil {
		close(s.queue)

		select {
		case <-s.done:
		case <-ctx.Done():
			err = ctx.Err()
			s.cancel()
			<-s.done
		}

		s.cancel()
		<-s.backupsDone
	}

	if failure := s.Err(); failure != nil {
		err = errors.Join(err, failure)
	}

	err = errors.Join(err, s.db.Close(), s.lock.Close())
	return err
}

// Backup uses SQLite's online backup API, never copies a live WAL database.
// A separate, paced WAL reader avoids occupying the gameplay writer.
func (s *Store) Backup(ctx context.Context) error {
	if err := os.MkdirAll(s.backupDirectory, 0700); err != nil {
		return err
	}

	path := filepath.Join(s.backupDirectory, "world-"+time.Now().UTC().Format("20060102T150405.000000000")+".sqlite")
	db, err := sql.Open("sqlite", s.path)

	if err != nil {
		return err
	}

	db.SetMaxOpenConns(1)
	defer db.Close()
	conn, err := db.Conn(ctx)

	if err != nil {
		return err
	}

	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "PRAGMA query_only=ON"); err != nil {
		return err
	}

	if _, err := conn.ExecContext(ctx, "BEGIN"); err != nil {
		return err
	}

	defer conn.ExecContext(context.Background(), "ROLLBACK")
	// Pin a read snapshot so ongoing commits do not restart a large backup.
	var id int

	if err := conn.QueryRowContext(ctx, "SELECT id FROM world WHERE id=1").Scan(&id); err != nil {
		return err
	}

	err = conn.Raw(func(raw any) error {
		b, err := raw.(interface {
			NewBackup(string) (*sqlite.Backup, error)
		}).NewBackup(path + ".tmp")

		if err != nil {
			return err
		}

		for {
			if err := ctx.Err(); err != nil {
				b.Finish()
				return err
			}

			more, err := b.Step(128)

			if err != nil {
				b.Finish()
				return err
			}

			if !more {
				return b.Finish()
			}

			select {
			case <-ctx.Done():
				b.Finish()
				return ctx.Err()
			case <-time.After(2 * time.Millisecond):
			}
		}
	})

	if err != nil {
		os.Remove(path + ".tmp")
		return err
	}

	if err = os.Rename(path+".tmp", path); err != nil {
		return err
	}

	files, err := filepath.Glob(filepath.Join(s.backupDirectory, "world-*.sqlite"))

	if err != nil {
		return err
	}

	for len(files) > 12 {
		if err := os.Remove(files[0]); err != nil {
			return err
		}

		files = files[1:]
	}

	log.Printf("SQLite backup completed: %s", path)
	return nil
}
