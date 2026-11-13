package network

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestAddingModulesPreservesSavedWorldAndPlayer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	p.profile.Credits = 12345
	p.ship.Mounts()[0].Health -= 7
	p.ship.CargoContents = append(p.ship.CargoContents, modules.Create("searchLight", simulation.ObjectProperties{World: s.World}, s.World.Specification))
	want := objects.CaptureShip(p.ship)
	worldShip := objects.CaptureEntity(p.ship)
	token := p.profile.ID
	s.Disconnect(socket)
	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	catalog.ModuleIDs = append([]string{"new-module"}, catalog.ModuleIDs...)
	catalog.ModuleSpecs["new-module"] = catalog.ModuleSpecs["searchLight"]
	store, err = persistence.Open(path, "")

	if err != nil {
		t.Fatal(err)
	}

	defer store.Close(context.Background())
	restarted := NewGameSession(25, catalog)

	if err := restarted.EnablePersistence(store); err != nil {
		t.Fatal("adding a module prevented loading the saved world", err)
	}

	socket = &benchmarkSocket{}
	restarted.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)
	p = restarted.playersBySocket[socket]

	if p == nil || p.profile.Credits != 12345 || !reflect.DeepEqual(objects.CaptureShip(p.ship), want) {
		t.Fatal("adding a module changed saved player progress, equipment, or cargo")
	}

	restored, err := objects.RestoreEntity(worldShip, restarted.World)

	if err != nil {
		t.Fatal("adding a module prevented restoring a saved world entity", err)
	}

	got := objects.CaptureEntity(restored)

	if !reflect.DeepEqual(got.ModuleTypes, worldShip.ModuleTypes) || len(got.CargoContents) != len(worldShip.CargoContents) || got.CargoContents[0].ModuleType != "searchLight" {
		t.Fatal("adding a module changed fitted modules or cargo in a world entity")
	}
}
