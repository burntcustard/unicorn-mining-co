package network

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestPersistenceRejectsUnknownDefinitions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	id := simulation.EntityID(s.World)
	s.persistence.sequence++

	batch := persistence.Batch{
		Sequence: s.persistence.sequence,
		World:    s.worldRecord(),
		Entities: []persistence.Entity{{SectorID: s.currentSector, ID: id, State: objects.SavedEntity{
			Object: objects.SavedObject{ID: id}, ModuleType: "retired-module",
		}}},
	}

	if !store.Submit(batch) {
		t.Fatal("could not queue saved fixture")
	}

	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	store, err := persistence.Open(path, "")

	if err != nil {
		t.Fatal(err)
	}

	defer store.Close(context.Background())
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	if err := NewGameSession(25, catalog).EnablePersistence(store); err == nil || !strings.Contains(err.Error(), "retired-module") {
		t.Fatal("invalid saved definition was accepted", err)
	}
}
