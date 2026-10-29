package network

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

func TestPersistenceSkipsRemovedDefinitions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	committedSession(t, s)
	profile := s.capturePlayer(p)
	profile.Credits = 4321
	removedMount := profile.Ship.Modules[0].Mount
	profile.Ship.Modules[0].Type = "retired-module"

	profile.Ship.Cargo = []objects.SavedCargo{
		{ID: 1001, Type: "retired-module", Module: true},
		{ID: 1002, Type: "diamond"},
	}

	retired := profile
	retired.ID = "12345678-9abc-4def-8012-3456789abcde"
	retired.Ship.ID = simulation.EntityID(s.World)
	retired.Ship.Type = "retired-ship"
	removedID := simulation.EntityID(s.World)
	s.persistence.sequence++

	batch := persistence.Batch{
		Sequence: s.persistence.sequence,
		World:    s.worldRecord(),
		Players:  []persistence.Player{profile, retired},
		Entities: []persistence.Entity{{SectorID: s.currentSector, ID: removedID, State: objects.SavedEntity{
			Object: objects.SavedObject{ID: removedID}, ModuleType: "retired-module",
		}}},
	}

	if !store.Submit(batch) {
		t.Fatal("could not queue saved fixture")
	}

	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	restored, ok := s.players.Get(profile.ID)

	if !ok || restored.ship.ID != profile.Ship.ID || restored.profile.Credits != 4321 || restored.ship.Mounts()[removedMount].Module != nil || len(restored.ship.CargoContents) != 1 || restored.ship.CargoContents[0].Base().ID != 1002 {
		t.Fatal("restart must preserve the account, ship and remaining possessions")
	}

	if _, exists := s.regions.sleeping.Get(removedID); exists {
		t.Fatal("the removed world module must not be restored")
	}

	restored, ok = s.players.Get(retired.ID)

	if !ok || !restored.ship.Dead || objects.CaptureShip(restored.ship).Type != "mustang" || restored.profile.Credits != retired.Credits {
		t.Fatal("a removed hull must preserve its account and allow starter-ship respawn")
	}

	committedSession(t, s)
	saved, err := store.Load(s.worldSeed)

	if err != nil {
		t.Fatal(err)
	}

	for _, entity := range saved.Entities {
		if entity.ID == removedID && !entity.Deleted {
			t.Fatal("removed definitions must not remain active in the next saved world")
		}
	}
}
