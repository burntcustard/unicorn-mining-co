package network

import (
	"bytes"
	"context"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func persistedSession(t *testing.T, path string) (*GameSession, *persistence.Store) {
	t.Helper()
	catalog, err := definitions.Load()

	if err != nil {
		t.Fatal(err)
	}

	s := NewGameSession(25, catalog)
	store, err := persistence.Open(path, "")

	if err != nil {
		t.Fatal(err)
	}

	if err := s.EnablePersistence(store); err != nil {
		store.Close(context.Background())
		t.Fatal(err)
	}

	return s, store
}

func committedSession(t *testing.T, s *GameSession) {
	t.Helper()

	if !s.flushChanges() {
		t.Fatal("persistence queue full")
	}

	deadline := time.Now().Add(4 * time.Second)

	for s.persistence.store.Committed() < s.persistence.sequence {
		if time.Now().After(deadline) {
			t.Fatal("commit timeout", s.persistence.store.Err())
		}

		time.Sleep(time.Millisecond)
	}
}

func TestProgressAndWorldSurviveRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	committedSession(t, s)
	s.sendSnapshot(p, nil, nil)

	if p.welcomePending {
		t.Fatal("welcome not released after commit")
	}

	token, id, shipID := p.profile.ID, p.playerID, p.shipID
	p.ship.Position = Vec.Create(1234, 2345)
	p.ship.Credits = 9876
	p.ship.Mounts()[0].Health -= 7
	p.ship.CargoContents = append(p.ship.CargoContents, objects.NewItem("diamond", simulation.ObjectProperties{World: s.World}, s.World.Specification))
	visits := []int64{10, 10, 10, 10, 10, 10, 10, 10, 10, 10}

	for _, stationID := range visits {
		s.progress([]protocol.SimulationEvent{protocol.Docked{PlayerID: id, DockedTo: stationID}})
	}

	if p.profile.UnlockedPaints&(1<<3) != 0 {
		t.Fatal("repeat visits unlocked green without three distinct stations")
	}

	visits = append(visits, 20, 30, 40, 10)

	for _, stationID := range visits[10:] {
		s.progress([]protocol.SimulationEvent{protocol.Docked{PlayerID: id, DockedTo: stationID}})
	}

	s.unlockPaint(p, 1)
	// A generated asteroid deletion must survive procedural regeneration.
	var asteroid *simulation.Asteroid

	s.World.Entities.ForEach(func(e simulation.Entity, _ int64) {
		if a, ok := e.(*simulation.Asteroid); ok && asteroid == nil {
			asteroid = a
		}
	})

	if asteroid == nil {
		t.Fatal("no generated asteroid")
	}

	asteroidID := asteroid.ID
	asteroid.Remove()
	itemID := simulation.EntityID(s.World)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &itemID, Position: p.ship.Position, Velocity: Vec.Create(3, 4)}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	// Leaving every region must save sleeping objects, not reset or discard them.
	s.Disconnect(socket)
	s.regions.Sync(s.World, nil)
	committedSession(t, s)

	nextEntityID, nextObjectID := s.World.NextEntityID, s.World.NextObjectID

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())

	if s.World.NextEntityID != nextEntityID || s.World.NextObjectID != nextObjectID {
		t.Fatal("restoring saved objects changed the persisted ID counters")
	}

	newItem := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World}, s.World.Specification)

	if newItem.ID >= nextObjectID || simulation.EntityID(s.World) != nextEntityID {
		t.Fatal("new objects reused pre-restart IDs")
	}

	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)
	p = s.playersBySocket[socket]

	if p.playerID != id || p.shipID != shipID || p.ship.Credits != 9876 || p.ship.Position != Vec.Create(1234, 2345) {
		t.Fatalf("lost identity/progress: %+v", p)
	}

	if p.profile.UnlockedPaints&(1<<1|1<<3) != 1<<1|1<<3 || !slices.Equal(p.profile.Visited, visits) || len(p.ship.CargoContents) != 1 {
		t.Fatal("lost unlocks, visits or cargo")
	}

	if s.World.Entities.Has(asteroidID) || s.regions.sleeping.Has(asteroidID) {
		t.Fatal("destroyed asteroid regenerated")
	}

	restored, ok := s.World.Entities.Get(itemID)

	if !ok {
		restored, ok = s.regions.sleeping.Get(itemID)
	}

	if !ok || restored.Base().Velocity != Vec.Create(3, 4) {
		t.Fatal("floating item lost movement")
	}

	if s.World.NextEntityID <= itemID {
		t.Fatal("entity IDs reused after restart")
	}

	committedSession(t, s)
	// More than 30 minutes offline no longer expires durable player records.
	s.Disconnect(socket)
	clock := s.now().Add(time.Hour)

	s.now = func() time.Time { return clock }

	s.World.Tick = 900
	s.Tick(1)
	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)

	if s.playersBySocket[socket].playerID != id {
		t.Fatal("long disconnect expired identity")
	}
}

func TestCargoTransferSavedAtomically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	committedSession(t, s)
	id := simulation.EntityID(s.World)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id, Position: p.ship.Position}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	committedSession(t, s)
	p.ship.CargoContents = append(p.ship.CargoContents, item)
	item.Remove()
	s.progress([]protocol.SimulationEvent{protocol.ItemCollected{By: p.playerID, ItemID: id}})
	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	var restored *playerRecord

	s.players.ForEach(func(p *playerRecord, _ string) { restored = p })

	if len(restored.ship.CargoContents) != 1 || restored.ship.CargoContents[0].Base().ID != id || s.regions.sleeping.Has(id) {
		t.Fatal("cargo duplicated or lost on restart")
	}
}

func TestCheckpointBudgetAndPlayedTime(t *testing.T) {
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	clock := time.Unix(100000, 0)

	s.now = func() time.Time { return clock }

	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	committedSession(t, s)
	before := s.persistence.sequence
	s.checkpoint()

	if s.persistence.sequence != before {
		t.Fatal("checkpoint wrote before 30 seconds")
	}

	s.persistence.nextCheckpoint = clock.Add(30 * time.Second)
	clock = clock.Add(30 * time.Second)
	count := s.World.Entities.Len()
	s.checkpoint()

	if len(s.persistence.checkpoint) != max(0, count-8) {
		t.Fatal("checkpoint copied whole world in one tick")
	}

	if p.profile.PlayedFor != 30 {
		t.Fatalf("playtime = %g", p.profile.PlayedFor)
	}

	s.Disconnect(socket)
	clock = clock.Add(time.Hour)
	s.capturePlayer(p)

	if p.profile.PlayedFor != 30 {
		t.Fatal("counted offline time")
	}
}

func TestLockedPaintRejected(t *testing.T) {
	catalog, _ := definitions.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	station := s.nearestStation(p.ship.Position)
	stationID := int64(station.ID)
	p.ship.DockedTo = &stationID
	before := objects.CaptureEntity(p.ship)
	s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "paint", Paint: 0}}, socket)
	a, _ := persistence.Encode(before)
	b, _ := persistence.Encode(objects.CaptureEntity(p.ship))

	if !bytes.Equal(a, b) {
		t.Fatal("client painted with a locked color")
	}

	s.unlockPaint(p, 0)
	s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "paint", Paint: 0}}, socket)

	if p.ship.Shades[0] != catalog.PaintColors[0][0] {
		t.Fatal("unlocked paint rejected")
	}
}

func TestDeadShipAndDrilledAsteroidSurviveRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	committedSession(t, s)
	token := p.profile.ID
	var asteroid *simulation.Asteroid

	s.World.Entities.ForEach(func(e simulation.Entity, _ int64) {
		if a, ok := e.(*simulation.Asteroid); ok && asteroid == nil {
			asteroid = a
		}
	})

	if asteroid == nil {
		t.Fatal("no asteroid")
	}

	asteroid.Segments()[0].Health -= 0.5
	health := asteroid.Segments()[0].Health
	asteroidID := asteroid.ID
	p.ship.Credits = 1234
	p.ship.Remove()
	s.progress(nil)
	s.regions.Sync(s.World, nil)
	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)
	p = s.playersBySocket[socket]

	if !p.ship.Dead || s.World.Entities.Has(p.shipID) || p.profile.UnlockedPaints&1 == 0 {
		t.Fatal("death state or red paint lost")
	}

	a, ok := s.World.Entities.Get(asteroidID)

	if !ok {
		a, ok = s.regions.sleeping.Get(asteroidID)
	}

	if !ok || a.(*simulation.Asteroid).Segments()[0].Health != health {
		t.Fatal("partial drilling reset")
	}

	oldShip := p.shipID
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.shipID == oldShip || p.ship.Dead || p.ship.Credits != 1234 || p.ship.DockedTo == nil {
		t.Fatal("saved dead player cannot respawn")
	}

	committedSession(t, s)
}

func TestWorldChangesSaveOnlyAffectedPlayers(t *testing.T) {
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	aSocket, bSocket := &benchmarkSocket{}, &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, aSocket)
	s.Receive(protocol.Control{Type: "hello"}, bSocket)
	a, b := s.playersBySocket[aSocket], s.playersBySocket[bSocket]
	committedSession(t, s)
	bSequence := b.saveSequence
	id := simulation.EntityID(s.World)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	s.progress(nil)

	if len(s.persistence.players) != 0 {
		t.Fatal("unrelated world creation caused every player to be copied")
	}

	committedSession(t, s)
	before := len(a.ship.Modules())
	var mounted bool

	for _, mount := range a.ship.Mounts() {
		if mount.Module != nil {
			mount.Health = 0
			mounted = true
			break
		}
	}

	if !mounted {
		t.Fatal("no fitted module")
	}

	a.ship.Update(s.World.Specification.Simulation.SimulationStep)
	s.progress(nil)

	if !s.persistence.players[a] || s.persistence.players[b] {
		t.Fatal("fracture did not mark only its owner")
	}

	committedSession(t, s)

	if len(a.ship.Modules()) != before-1 || b.saveSequence != bSequence {
		t.Fatal("module was not detached or unrelated player was saved")
	}

	saved, err := store.Load(25)

	if err != nil {
		t.Fatal(err)
	}

	for _, p := range saved.Players {
		if p.ID == a.profile.ID && len(p.Ship.Modules) != before-1 {
			t.Fatal("detached module restored in its owner")
		}
	}
}
