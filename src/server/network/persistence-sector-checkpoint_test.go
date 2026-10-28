package network

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

func TestCheckpointIncludesConnectedPlayersInEverySector(t *testing.T) {
	t.Parallel()
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	clock := time.Unix(100000, 0)

	s.now = func() time.Time { return clock }

	a, b := &benchmarkSocket{}, &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, a)
	s.Receive(protocol.Control{Type: "hello"}, b)
	p := s.playersBySocket[b]
	portal := s.sectors[s.currentSector].portals[0]
	s.relocatePlayer(p, portal.DestinationSector, sectorArrival{})
	committedSession(t, s)
	clock = clock.Add(30 * time.Second)
	s.persistence.nextCheckpoint = clock
	s.checkpoint()
	s.activateSector(p.sectorID)
	s.checkpoint()
	committedSession(t, s)
	saved, err := store.Load(25)

	if err != nil {
		t.Fatal(err)
	}

	if len(saved.Players) != 2 {
		t.Fatal("missing connected players")
	}

	for _, profile := range saved.Players {
		if profile.PlayedFor != 30 {
			t.Fatalf("checkpoint omitted player in sector %s: played=%g", profile.SectorID, profile.PlayedFor)
		}
	}
}

func TestCheckpointCopyBudgetIsGlobalAcrossSectors(t *testing.T) {
	t.Parallel()
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	portal := s.sectors[s.currentSector].portals[0]
	s.relocatePlayer(s.playersBySocket[socket], portal.DestinationSector, sectorArrival{})
	committedSession(t, s)
	var entries []simulation.Entity

	for _, runtime := range s.sectors {
		entries = append(entries, runtime.world.Entities.Values()...)
	}

	if len(entries) < 20 {
		t.Fatal("fixture needs twenty active entities")
	}

	s.persistence.checkpoint = entries[:20]
	s.Tick(1)

	if len(s.persistence.checkpoint) != 12 {
		t.Fatalf("checkpoint exceeded its global eight-entry budget: remaining=%d", len(s.persistence.checkpoint))
	}
}
