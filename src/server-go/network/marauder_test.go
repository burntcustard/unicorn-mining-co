package network

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server-go/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server-go/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server-go/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server-go/vector"
)

func TestMarauderSectorDispatchAndPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	player := s.playersBySocket[socket]
	player.ship.Position = Vec.Create(60000, 0)
	manager := s.sectors[s.currentSector].marauders
	step := s.World.Specification.Simulation.SimulationStep
	interval := uint64(s.World.Specification.MarauderSpec.CheckInterval / step)
	s.World.Tick = interval
	manager.Dispatch()

	if len(manager.Capture()) != 0 {
		t.Fatal("first ping must not spawn")
	}

	// Another sector has its own clock and observation history.
	original := s.currentSector

	for _, sector := range s.sectorMap.Enabled {
		if sector == original {
			continue
		}

		restore := s.useSector(sector)
		s.World.Tick = interval * 2
		other := s.sectors[sector].marauders
		other.Dispatch()

		if len(other.Capture()) != 0 {
			t.Fatal("players in other sectors must not trigger marauders")
		}

		restore()
		break
	}

	s.World.Tick = interval * 2
	manager.Dispatch()
	ship := npcShip(t, manager)
	// Restore a nontrivial search/combat state through the public persistence API.
	data := npcState(t, manager.Capture()[0].State, map[string]any{"Visited": true, "CombatAt": s.World.Tick + 30, "TargetID": player.ship.ID})
	manager.Marauders = nil

	if err := manager.Restore(ship, data); err != nil {
		t.Fatal(err)
	}

	ship.Velocity = Vec.Create(12, 23)
	ship.Fuel = 2.5
	dispatch, controller := manager.CaptureDispatch(), manager.Capture()[0]
	s.savePlayer(player)
	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	manager = s.sectors[s.currentSector].marauders
	restored := npcShip(t, manager)

	if restored.ID != ship.ID || restored.Velocity != ship.Velocity || restored.Fuel != 2.5 || !restored.SuppressDrops || !restored.Hostile || !s.World.Players.Has(*restored.PlayerID) {
		t.Fatalf("marauder ship, observer or drop policy did not survive restart: id=%d/%d velocity=%v/%v fuel=%g drops=%v hostile=%v observer=%v", restored.ID, ship.ID, restored.Velocity, ship.Velocity, restored.Fuel, restored.SuppressDrops, restored.Hostile, s.World.Players.Has(*restored.PlayerID))
	}

	if !bytes.Equal(dispatch, manager.CaptureDispatch()) || !bytes.Equal(controller.State, manager.Capture()[0].State) {
		t.Fatal("marauder dispatch and controller state did not survive restart")
	}

	// Restored disconnected players cannot keep a marauder alive.
	manager.Update()

	if len(manager.Capture()) != 0 || s.World.Entities.Has(restored.ID) {
		t.Fatal("restored marauder should despawn without an active nearby player")
	}

	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())

	if s.World.Entities.Has(restored.ID) || s.regions.Sleeping.Has(restored.ID) || len(s.sectors[s.currentSector].marauders.Capture()) != 0 {
		t.Fatal("despawned marauder returned after restart")
	}
}

func TestMarauderDispatchRunsThroughSessionTicks(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	p.ship.Position = Vec.Create(60000, 0)
	simulation.AddEntity(s.World, p.ship)
	manager := s.sectors[s.currentSector].marauders

	// Exercise the ordinary session dispatch/update path without waiting ten minutes.
	if err := manager.RestoreDispatch([]byte(`{"CheckAt":0,"Seen":{}}`)); err != nil {
		t.Fatal(err)
	}

	s.Tick(1)

	if err := manager.RestoreDispatch([]byte(`{"CheckAt":0,"Seen":{"` + p.profile.ID + `":true}}`)); err != nil {
		t.Fatal(err)
	}

	s.Tick(1)
	ship := npcShip(t, manager)

	if ship.NPCState == "" || !s.World.Players.Has(*ship.PlayerID) {
		t.Fatal("session must dispatch and update marauders")
	}
}
