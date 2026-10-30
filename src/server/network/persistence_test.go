package network

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
	"time"
)

func persistedSession(t *testing.T, path string) (*GameSession, *persistence.Store) {
	t.Helper()
	catalog, err := specs.Load()

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
	t.Parallel()

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
	// Exercise unlock progression even while all paints are available by default.
	p.profile.UnlockedPaints &^= 1<<0 | 1<<3
	p.ship.Position = Vec.Create(1234, 2345)
	p.profile.Credits = 9876
	p.ship.Fuel = 3.25
	p.ship.Mounts()[0].Health -= 7
	p.ship.CargoContents = append(p.ship.CargoContents, objects.NewItem("diamond", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World))}, s.World.Specification))
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

	s.unlockPaint(p, 0)
	// A returning player keeps the paint selection saved in their profile.
	p.profile.UnlockedPaints &^= 1 << 4
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

	// Reproduce a database saved before ammunition was appended to ItemIDs.
	previousCatalog := s.World.Specification
	previousCatalog.ItemIDs = previousCatalog.ItemIDs[:5]
	db, err := sql.Open("sqlite", path)

	if err != nil {
		t.Fatal(err)
	}

	_, err = db.Exec("UPDATE world SET generation_digest = ?", persistence.GenerationDigest(previousCatalog))
	closeErr := db.Close()

	if err != nil || closeErr != nil {
		t.Fatal(err, closeErr)
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

	if p.ship.Fuel != 3.25 {
		t.Fatal("fuel did not survive restart")
	}

	if p.playerID != id || p.shipID != shipID || p.profile.Credits != 9876 || p.ship.Position != Vec.Create(1234, 2345) {
		t.Fatalf("lost identity/progress: %+v", p)
	}

	if p.profile.UnlockedPaints != persistence.DefaultPaints&^(1<<4) || !slices.Equal(p.profile.Visited, visits) || len(p.ship.CargoContents) != 1 {
		t.Fatal("lost unlocks, visits or cargo")
	}

	if s.World.Entities.Has(asteroidID) || s.regions.Sleeping.Has(asteroidID) {
		t.Fatal("destroyed asteroid regenerated")
	}

	restored, ok := s.World.Entities.Get(itemID)

	if !ok {
		restored, ok = s.regions.Sleeping.Get(itemID)
	}

	if !ok || restored.Base().Velocity != Vec.Create(3, 4) {
		t.Fatal("floating item lost movement")
	}

	if s.World.NextEntityID <= itemID {
		t.Fatal("entity IDs reused after restart")
	}

	committedSession(t, s)
	saved, err := store.Load(25)

	if err != nil {
		t.Fatal(err)
	}

	if saved.World.GenerationDigest != persistence.GenerationDigest(s.World.Specification) {
		t.Fatal("compatible world digest was not upgraded")
	}

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
	t.Parallel()

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

	if len(restored.ship.CargoContents) != 1 || restored.ship.CargoContents[0].Base().ID != id || s.regions.Sleeping.Has(id) {
		t.Fatal("cargo duplicated or lost on restart")
	}
}

func TestCheckpointBudgetAndPlayedTime(t *testing.T) {
	t.Parallel()

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
		t.Fatal("checkpoint wrote before one minute")
	}

	s.persistence.nextCheckpoint = clock.Add(time.Minute)
	clock = clock.Add(time.Minute)
	count := s.World.Entities.Len()
	s.checkpoint()
	s.flushBackgroundChanges()

	if len(s.persistence.checkpoint) != max(0, count-8) {
		t.Fatal("checkpoint copied whole world in one tick")
	}

	if p.profile.PlayedFor != 60 {
		t.Fatalf("playtime = %g", p.profile.PlayedFor)
	}

	s.Disconnect(socket)
	clock = clock.Add(time.Hour)
	s.capturePlayer(p)

	if p.profile.PlayedFor != 60 {
		t.Fatal("counted offline time")
	}
}

func TestCheckpointSnapshotsContinueBeforeBackgroundCommit(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	defer store.Close(context.Background())
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	committedSession(t, s)
	s.sendSnapshot(p, nil, nil)
	socket.acknowledge(s)
	db, err := sql.Open("sqlite", path)

	if err != nil {
		t.Fatal(err)
	}

	defer db.Close()
	tx, err := db.Begin()

	if err != nil {
		t.Fatal(err)
	}

	defer tx.Rollback()

	if _, err := tx.Exec("UPDATE world SET tick=tick WHERE id=1"); err != nil {
		t.Fatal(err)
	}

	p.ship.Position.X += 10
	s.persistence.nextFlush = s.now()
	s.persistence.nextCheckpoint = s.now()
	s.checkpoint()
	s.flushBackgroundChanges()

	if store.Committed() >= s.persistence.sequence {
		t.Fatal("fixture must hold the checkpoint commit")
	}

	before := socket.packets
	s.World.Tick++
	s.sendSnapshot(p, nil, nil)

	if socket.packets == before {
		t.Fatal("a background checkpoint interrupted snapshot delivery")
	}

	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}

	committedSession(t, s)
	saved, err := store.Load(25)

	if err != nil || len(saved.Players) != 1 || saved.Players[0].Ship.Position != objects.CaptureShip(p.ship).Position {
		t.Fatal("background checkpoint did not persist the ship", err)
	}
}

func TestCheckpointPreservesAccountCommitBarrier(t *testing.T) {
	for _, order := range []string{"before", "after"} {
		t.Run(order, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "world.sqlite")
			s, store := persistedSession(t, path)
			defer store.Close(context.Background())
			socket := &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			p := s.playersBySocket[socket]
			committedSession(t, s)
			s.sendSnapshot(p, nil, nil)
			socket.acknowledge(s)
			db, err := sql.Open("sqlite", path)

			if err != nil {
				t.Fatal(err)
			}

			defer db.Close()
			tx, err := db.Begin()

			if err != nil {
				t.Fatal(err)
			}

			defer tx.Rollback()

			if _, err := tx.Exec("UPDATE world SET tick=tick WHERE id=1"); err != nil {
				t.Fatal(err)
			}

			s.persistence.nextCheckpoint = s.now()

			if order == "after" {
				s.checkpoint()
				s.persistence.checkpointPlayers = []*playerRecord{p}
			}

			p.profile.Credits++
			s.requirePlayerCommit(p)
			s.checkpoint()
			s.flushBackgroundChanges()
			before := socket.packets
			s.sendSnapshot(p, nil, nil)

			if socket.packets != before {
				t.Fatal("checkpoint released uncommitted account state")
			}

			if err := tx.Rollback(); err != nil {
				t.Fatal(err)
			}

			committedSession(t, s)
			s.sendSnapshot(p, nil, nil)

			if socket.packets == before {
				t.Fatal("committed account state was not released")
			}
		})
	}
}

func TestDefaultPaintsAndLockedPaintRejected(t *testing.T) {
	t.Parallel()

	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]

	availablePaints := uint16(1<<len(catalog.PaintColors) - 1)

	if p.profile.UnlockedPaints&availablePaints != availablePaints {
		t.Fatal("not all paints are unlocked by default")
	}

	// Preserve coverage of the lock checks and unlock action.
	p.profile.UnlockedPaints &^= 1
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

	module := p.ship.Modules()[0]

	for paint := range catalog.PaintColors {
		s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "paint", Paint: int64(paint)}}, socket)

		if !slices.Equal(p.ship.Shades, catalog.PaintColors[paint]) {
			t.Fatal("default hull paint rejected", paint)
		}

		s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "paint", Paint: int64(paint), ModuleID: module.Base().ID, HasModuleID: true}}, socket)

		if !slices.Equal(module.Base().Shades, catalog.PaintColors[paint]) {
			t.Fatal("default module paint rejected", paint)
		}
	}
}

func TestDeadShipAndDrilledAsteroidSurviveRestart(t *testing.T) {
	t.Parallel()

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
	p.profile.Credits = 1234
	spare := modules.Create("searchLight", simulation.ObjectProperties{World: s.World}, s.World.Specification)
	p.ship.CargoContents = append(p.ship.CargoContents, spare)

	for _, segment := range p.ship.Segments {
		if segment.Core {
			objects.Damage(segment, 10000)
		}
	}

	s.Tick(1)

	if !p.ship.Dead || spare.Base().ID <= 0 {
		t.Fatal("fatal damage must release inventory with a world entity ID")
	}

	spareID := spare.Base().ID
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
		a, ok = s.regions.Sleeping.Get(asteroidID)
	}

	if !ok || a.(*simulation.Asteroid).Segments()[0].Health != health {
		t.Fatal("partial drilling reset")
	}

	debris, ok := s.World.Entities.Get(spareID)

	if !ok {
		debris, ok = s.regions.Sleeping.Get(spareID)
	}

	if !ok || debris.(simulation.Module).ModuleBase().Type != "searchLight" {
		t.Fatal("released inventory did not survive restarting")
	}

	oldShip := p.shipID
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.shipID == oldShip || p.ship.Dead || p.profile.Credits != 1234 || p.ship.DockedTo == nil {
		t.Fatal("saved dead player cannot respawn")
	}

	committedSession(t, s)
}

func TestWorldChangesSaveOnlyAffectedPlayers(t *testing.T) {
	t.Parallel()

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

	_, aDirty := s.persistence.players[a]
	_, bDirty := s.persistence.players[b]

	if !aDirty || bDirty {
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

func TestModuleStateSurvivesReconnectAndRestart(t *testing.T) {
	t.Parallel()

	for _, active := range []bool{false, true} {
		for _, restart := range []string{"reconnect", "disconnect-restart", "shutdown"} {
			t.Run(restart+"/"+map[bool]string{false: "closed", true: "open"}[active], func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "world.sqlite")
				s, store := persistedSession(t, path)
				socket := &benchmarkSocket{}
				s.Receive(protocol.Control{Type: "hello"}, socket)
				p := s.playersBySocket[socket]
				token := p.profile.ID
				committedSession(t, s)
				// Save an animation in progress, including a hatch closing.
				p.ship.SetModuleActive("searchLight", true)
				p.ship.SetModuleActive("cargoHatch", true)
				p.ship.UpdateModules(0.1)
				p.ship.SetModuleActive("searchLight", active)
				p.ship.SetModuleActive("cargoHatch", active)
				expected := p.ship.ModuleStates()

				if restart == "shutdown" {
					if err := s.shutdownPersistence(context.Background()); err != nil {
						t.Fatal(err)
					}
				} else {
					s.Disconnect(socket)
				}

				committedSession(t, s)

				if restart != "reconnect" {
					if err := store.Close(context.Background()); err != nil {
						t.Fatal(err)
					}

					s, store = persistedSession(t, path)
				}

				defer store.Close(context.Background())
				socket = &benchmarkSocket{}
				s.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)
				p = s.playersBySocket[socket]
				actual := p.ship.ModuleStates()

				for i, state := range expected {
					kind := s.World.Specification.ModuleIDs[state.Type]

					if kind != "searchLight" && kind != "cargoHatch" {
						continue
					}

					if len(state.Segments) == 0 || !slices.Equal(state.Segments, actual[i].Segments) {
						t.Fatalf("%s activation/progress lost: %v -> %v", kind, state.Segments, actual[i].Segments)
					}
				}

				// The first simulation tick must not overwrite the saved toggles.
				s.Tick(1)

				for _, kind := range []string{"searchLight", "cargoHatch"} {
					if p.ship.ModuleActive(kind) != active {
						t.Fatalf("%s reset on first tick", kind)
					}
				}
			})
		}
	}
}

func npcShip(t testing.TB, manager interface{ ForEachShip(func(*objects.Ship)) }) *objects.Ship {
	t.Helper()
	var ship *objects.Ship

	manager.ForEachShip(func(current *objects.Ship) {
		if ship != nil {
			t.Fatal("expected one NPC")
		}

		ship = current
	})

	if ship == nil {
		t.Fatal("missing NPC ship")
	}

	return ship
}

func npcState(t testing.TB, data []byte, changes map[string]any) []byte {
	t.Helper()
	var fields map[string]json.RawMessage

	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}

	for key, value := range changes {
		encoded, err := json.Marshal(value)

		if err != nil {
			t.Fatal(err)
		}

		fields[key] = encoded
	}

	result, err := json.Marshal(fields)

	if err != nil {
		t.Fatal(err)
	}

	return result
}

func persistedPirate(t testing.TB, s *GameSession, victim *playerRecord) *objects.Ship {
	t.Helper()

	for range 7 {
		item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World))}, s.World.Specification)
		item.Mined = true
		victim.ship.CargoContents = append(victim.ship.CargoContents, item)
	}

	s.sectors[s.currentSector].pirates.Dispatch()
	return npcShip(t, s.sectors[s.currentSector].pirates)
}

func TestPirateBehaviorAndMechanicsSurviveRestart(t *testing.T) {
	for state, name := range []string{"Pursuing", "Waiting", "Fighting", "Search", "Collecting", "Returning", "Docked", "Stranded"} {
		if state == 0 || state == 2 || state == 6 {
			continue
		}

		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "world.sqlite")
			s, store := persistedSession(t, path)
			socket, aggressorSocket := &benchmarkSocket{}, &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			s.Receive(protocol.Control{Type: "hello"}, aggressorSocket)
			victim, aggressor := s.playersBySocket[socket], s.playersBySocket[aggressorSocket]
			s.World.Tick = 4200
			ship := persistedPirate(t, s, victim)
			victim.pirateAfter = 9000
			ship.Name = "Blackbird"
			ship.Position, ship.Velocity = Vec.Create(500, 700), Vec.Create(12, 23)
			ship.Rotation, ship.Spin = .4, -.15
			ship.Fuel, ship.StoredPower = 2.5, .75
			ship.Launching, ship.Forward, ship.Turn = .2, .4, -.5

			for _, segment := range ship.Segments {
				if segment.Hull {
					segment.Health -= 2
					break
				}
			}

			ship.SetModuleActive("cargoHatch", true)
			ship.UpdateModules(.1)
			item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World)), Position: Vec.Create(800, 900)}, s.World.Specification)
			simulation.AddEntity(s.World, item)
			cargo := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World))}, s.World.Specification)
			victim.ship.CargoContents = append(victim.ship.CargoContents, cargo)
			s.savePlayer(victim)
			manager := s.sectors[s.currentSector].pirates

			data := npcState(t, manager.Capture()[0].State, map[string]any{
				"State": state, "Credits": 123, "Search": ai.Search{Origin: Vec.Create(150, 230), Heading: .5, Angle: 12}, "Destination": Vec.Create(200, 300),
				"WarnedAt": 130, "ThinkAfter": 141, "SearchStartedAt": 135, "AttackAfter": 148, "TauntAfter": 150, "CollectAfter": 146, "ReDemandAfter": 145,
				"Countdown": 2, "Following": true, "PlayerSeen": true, "CargoAccepted": true, "Aggressors": []string{victim.profile.ID, aggressor.profile.ID},
				"Input": protocol.Input{Thrust: .4, Turn: -.5, CargoHatch: true}, "Loot": []int64{item.ID, cargo.ID}, "LootTarget": item.ID,
			})

			manager.Pirates = nil

			if err := manager.Restore(ship, data); err != nil {
				t.Fatal(err)
			}

			manager.DispatchAt = s.World.Tick + 17
			wantShip, wantController := objects.CaptureEntity(ship), manager.Capture()[0]
			victimAccount := victim.profile.ID
			committedSession(t, s)

			if err := store.Close(context.Background()); err != nil {
				t.Fatal(err)
			}

			s, store = persistedSession(t, path)
			defer store.Close(context.Background())
			manager = s.sectors[s.currentSector].pirates

			if s.World.Tick != 4200 || manager.DispatchAt != 4217 || len(manager.Capture()) != 1 {
				t.Fatal("pirate or paused simulation timer was lost")
			}

			ship = npcShip(t, manager)
			victim, _ = s.players.Get(victimAccount)

			if victim.pirateAfter != 9000 || ship.Name != "Blackbird" || !ship.Hostile || ship.NPCState != name || !s.World.Players.Has(*ship.PlayerID) {
				t.Fatal("NPC identity, observer or encounter cooldown was lost")
			}

			actual := objects.CaptureEntity(ship)

			if actual.Object.Position != wantShip.Object.Position || actual.Object.Velocity != wantShip.Object.Velocity || actual.Object.Spin != wantShip.Object.Spin || actual.Launching != wantShip.Launching || actual.Fuel != wantShip.Fuel || actual.StoredPower != wantShip.StoredPower || !reflect.DeepEqual(actual.HullHealth, wantShip.HullHealth) || !reflect.DeepEqual(actual.Modules, wantShip.Modules) {
				t.Fatal("NPC motion, fuel, equipment or module animation was reset")
			}

			if len(ship.CargoContents) != 1 || ship.CargoContents[0].(*objects.Item).Rounds == nil || victim.ship.CargoContents[len(victim.ship.CargoContents)-1].Base().ID != cargo.ID {
				t.Fatal("NPC ammunition or victim cargo was lost")
			}

			if actual := manager.Capture()[0]; !reflect.DeepEqual(actual, wantController) {
				t.Fatalf("NPC account references, loot references, behavior or encounter timers changed across shutdown:\n%s\n%s", wantController.State, actual.State)
			}
		})
	}
}

func TestPirateNPCAggressorsSurviveRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	firstSocket, secondSocket := &benchmarkSocket{}, &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, firstSocket)
	s.Receive(protocol.Control{Type: "hello"}, secondSocket)
	firstVictim, secondVictim := s.playersBySocket[firstSocket], s.playersBySocket[secondSocket]
	// Restart must resolve stable ship IDs, not accidentally retain these observers.
	s.nextPlayerID = 1000
	first := persistedPirate(t, s, firstVictim)

	for range 7 {
		item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World))}, s.World.Specification)
		item.Mined = true
		secondVictim.ship.CargoContents = append(secondVictim.ship.CargoContents, item)
	}

	manager := s.sectors[s.currentSector].pirates
	manager.DispatchAt = 0
	manager.Dispatch()
	var second *objects.Ship

	manager.ForEachShip(func(ship *objects.Ship) {
		if ship != first {
			second = ship
		}
	})

	if second == nil {
		t.Fatal("second pirate did not launch")
	}

	first.Launching, second.Launching = 0, 0

	manager.Hits([]protocol.SimulationEvent{
		protocol.CollisionEvent{By: firstVictim.playerID, B: first.ID, Damage: [2]float64{0, 3}},
		protocol.CollisionEvent{By: *second.PlayerID, B: first.ID, Damage: [2]float64{0, 3}},
		protocol.CollisionEvent{By: *first.PlayerID, B: second.ID, Damage: [2]float64{0, 3}},
	})

	want := manager.Capture()

	var saved struct {
		Aggressors     []string
		AggressorShips []int64
	}

	if err := json.Unmarshal(want[0].State, &saved); err != nil {
		t.Fatal(err)
	}

	if !slices.Equal(saved.Aggressors, []string{firstVictim.profile.ID}) || !slices.Equal(saved.AggressorShips, []int64{second.ID}) {
		t.Fatal("human and NPC aggressors were not captured with stable identities")
	}

	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	manager = s.sectors[s.currentSector].pirates

	manager.ForEachShip(func(ship *objects.Ship) {
		if *ship.PlayerID >= 1000 {
			t.Fatal("test did not reassign the NPC observer identity")
		}
	})

	if got := manager.Capture(); !reflect.DeepEqual(got, want) {
		t.Fatalf("NPC or human hostility changed across restart:\n%v\n%v", want, got)
	}
}

func TestCollectorTripAndDispatchSurviveRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	s.World.Tick = 12345
	home := s.nearestStation(Vec.Vector{})
	manager := s.sectors[s.currentSector].collectors
	item := map[string]any{"ID": 123456, "Position": Vec.Create(200, 300), "Name": "Gold", "Taken": false}
	dispatch, _ := json.Marshal(map[int64]any{int64(home.ID): map[string]any{"Home": home, "CheckAt": 14000, "Seen": map[int64]bool{123456: true}, "Queue": [][]any{{item}}, "LaunchAt": 12450}})

	if err := manager.RestoreDispatch(dispatch); err != nil {
		t.Fatal(err)
	}

	playerID := s.nextPlayerID
	s.nextPlayerID++
	ship := objects.CreatePlayerShip(s.World, objects.Properties{DefinitionID: "finch", ObjectProperties: simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World)), PlayerID: &playerID, Position: Vec.Create(200, 350)}})
	ship.Name = "Sweep"
	ship.Velocity, ship.Fuel = Vec.Create(17, 23), 2
	data, _ := json.Marshal(map[string]any{"Home": home, "HomeID": int64(home.ID), "State": "Inspecting", "Items": []any{item}, "TargetID": 123456, "AttemptStartedAt": 400, "ThinkAfter": 411.6, "Missing": 2, "Inspect": map[string]any{"ID": 654321, "Position": Vec.Create(210, 350), "Name": "Diamond", "ArrivedAt": 409, "Announced": true}, "Inspected": map[int64]bool{123: true}, "HullSegments": 7, "Modules": 4})
	simulation.AddEntity(s.World, ship)

	if err := manager.Restore(ship, data); err != nil {
		t.Fatal(err)
	}

	cargo := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World))}, s.World.Specification)
	ship.CargoContents = append(ship.CargoContents, cargo)
	want, wantDispatch := manager.Capture()[0], manager.CaptureDispatch()

	if err := s.shutdownPersistence(context.Background()); err != nil {
		t.Fatal(err)
	}

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	manager = s.sectors[s.currentSector].collectors

	if s.World.Tick != 12345 || len(manager.Capture()) != 1 || string(manager.CaptureDispatch()) != string(wantDispatch) {
		t.Fatal("station grace interval or queued launch timer changed during shutdown")
	}

	ship = npcShip(t, manager)

	if actual := manager.Capture()[0]; !reflect.DeepEqual(actual, want) || ship.Velocity != Vec.Create(17, 23) || ship.Fuel != 2 || ship.Name != "Sweep" || len(ship.CargoContents) != 1 || ship.CargoContents[0].Base().ID != cargo.ID {
		t.Fatal("collector trip, inspection, physical state or cargo was lost")
	}

	if !s.World.Players.Has(*ship.PlayerID) || !s.World.Entities.Has(ship.ID) || s.regions.Sleeping.Has(ship.ID) {
		t.Fatal("restored collector did not resume as an active observer without players")
	}
}

func TestNPCCargoAndDespawnSaveAtomically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	ship := persistedPirate(t, s, s.playersBySocket[socket])
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World))}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	committedSession(t, s)
	item.Remove()
	ship.CargoContents = append(ship.CargoContents, item)
	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	ship = npcShip(t, s.sectors[s.currentSector].pirates)

	if len(ship.CargoContents) != 2 || ship.CargoContents[1].Base().ID != item.ID || s.regions.Sleeping.Has(item.ID) || s.World.Entities.Has(item.ID) {
		t.Fatal("NPC pickup duplicated or lost the collected item")
	}

	s.World.Entities.Delete(ship.ID)
	s.World.Players.Delete(*ship.PlayerID)
	s.sectors[s.currentSector].pirates.Pirates = nil
	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())

	if len(s.sectors[s.currentSector].pirates.Capture()) != 0 || s.World.Entities.Has(ship.ID) || s.regions.Sleeping.Has(ship.ID) {
		t.Fatal("despawned NPC returned as a controller or uncontrolled ship")
	}
}

func TestIdleCollectorTimerUsesBackgroundSave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	clock := s.now()

	s.now = func() time.Time { return clock }

	home := s.nearestStation(Vec.Vector{})
	manager := s.sectors[s.currentSector].collectors
	data, _ := json.Marshal(map[int64]any{int64(home.ID): map[string]any{"Home": home, "CheckAt": 6000, "Seen": map[int64]bool{42: true}}})

	if err := manager.RestoreDispatch(data); err != nil {
		t.Fatal(err)
	}

	committedSession(t, s)
	before := s.persistence.sequence
	s.World.Tick = 600
	manager.Stations[int64(home.ID)].CheckAt = 6600
	clock = clock.Add(29 * time.Second)
	s.flushBackgroundChanges()

	if s.persistence.sequence != before {
		t.Fatal("idle NPC state saved before the existing background interval")
	}

	clock = clock.Add(time.Second)
	s.flushBackgroundChanges()

	if s.persistence.sequence != before+1 {
		t.Fatal("idle dispatch timer was not saved without player or entity changes")
	}

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())

	if s.World.Tick != 600 || s.sectors[s.currentSector].collectors.Stations[int64(home.ID)].CheckAt != 6600 {
		t.Fatal("idle timer state did not survive restart")
	}
}
