package network

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestProfileNameSurvivesReconnectRestartAndRespawn(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "prepare"}, socket)
	p := s.playersBySocket[socket]
	token := p.profile.ID
	committedSession(t, s)
	s.sendSnapshot(p, nil, nil)
	before := socket.packets
	name := "aé🦄 <&>\x00"
	s.Receive(protocol.Control{Type: "profile", DisplayName: name}, socket)

	if p.profile.DisplayName != name || p.ship.TargetLabel != name || p.ship.Name != "Mustang" || s.World.Players.Has(p.playerID) {
		t.Fatal("profile creation changed the name or entered the world")
	}

	if socket.packets != before {
		t.Fatal("profile acknowledged before persistence commit")
	}

	committedSession(t, s)
	s.sendSnapshot(p, nil, nil)

	if socket.packets != before+1 {
		t.Fatal("saved profile was not acknowledged")
	}

	if s.identityPreview(token)[0] != name {
		t.Fatal("menu identity omitted the profile name")
	}

	s.Disconnect(socket)
	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "prepare", PlayerToken: token}, socket)
	p = s.playersBySocket[socket]

	if p.profile.DisplayName != name || p.ship.TargetLabel != name || p.ship.Name != "Mustang" || s.identityPreview(token)[0] != name {
		t.Fatal("name lost after reconnect and restart")
	}

	committedSession(t, s)
	s.Receive(protocol.Control{Type: "play"}, socket)
	p.ship.Remove()
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.ship.Name != "Mustang" || p.ship.TargetLabel != name {
		t.Fatal("replacement ship did not use its model name")
	}
}

func TestPlayerTargetLabelFollowsPilotedShip(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "prepare"}, socket)
	s.Receive(protocol.Control{Type: "profile", DisplayName: "Pilot"}, socket)
	s.Receive(protocol.Control{Type: "play"}, socket)
	p := s.playersBySocket[socket]
	dockHangarPlayer(s, p)
	batch := NewBinarySnapshotBatch(catalog)
	fields := catalog.Protocol.BinaryFieldIDs

	check := func(ship *objects.Ship, name string, label any) {
		t.Helper()
		batch.Begin(nil)
		record := batch.prepared(ship)

		if record.fields[fields.Name].wire != name || record.fields[fields.TargetLabel].wire != label {
			t.Fatalf("replicated name=%v label=%v; want %q and %v", record.fields[fields.Name].wire, record.fields[fields.TargetLabel].wire, name, label)
		}
	}

	first := p.ship
	hangarAction(t, s, p, "RENAME", first.ID, "First Ship")
	check(first, "First Ship", "Pilot")
	p.profile.Credits = 100000
	hangarAction(t, s, p, "BUY", 0, "kestrel")
	second := p.ship
	check(first, "First Ship", nil)
	check(second, "Kestrel", "Pilot")
	hangarAction(t, s, p, "PILOT", first.ID, "")
	check(first, "First Ship", "Pilot")
	check(second, "Kestrel", nil)

	npc := objects.CreateShip(s.World, objects.Properties{})
	npc.Name = "NPC Ship"
	check(npc, "NPC Ship", nil)
}

func TestProfileNameValidationAndOwnership(t *testing.T) {
	t.Parallel()

	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "profile", DisplayName: "unconnected"}, socket)

	if s.players.Len() != 0 {
		t.Fatal("unauthenticated profile creation")
	}

	s.Receive(protocol.Control{Type: "prepare"}, socket)
	p := s.playersBySocket[socket]

	for _, name := range []string{"", strings.Repeat("a", 17), strings.Repeat("🦄", 17), string([]byte{255})} {
		s.Receive(protocol.Control{Type: "profile", DisplayName: name}, socket)

		if p.profile.DisplayName != "" {
			t.Fatalf("invalid name accepted: %q", name)
		}
	}

	name := strings.Repeat("🦄", 16)
	s.Receive(protocol.Control{Type: "profile", DisplayName: name}, socket)
	s.Receive(protocol.Control{Type: "profile", DisplayName: "replacement"}, socket)

	if p.profile.DisplayName != name || p.ship.Name != "Mustang" {
		t.Fatal("16 Unicode characters rejected or existing name overwritten")
	}
}
