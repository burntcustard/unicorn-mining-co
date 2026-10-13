package network

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

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

	if p.profile.DisplayName != name || p.ship.Name != name || s.World.Players.Has(p.playerID) {
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

	if p.profile.DisplayName != name || p.ship.Name != name || s.identityPreview(token)[0] != name {
		t.Fatal("name lost after reconnect and restart")
	}

	committedSession(t, s)
	s.Receive(protocol.Control{Type: "play"}, socket)
	p.ship.Remove()
	s.Receive(protocol.Control{Type: "respawn"}, socket)

	if p.ship.Name != name {
		t.Fatal("replacement ship lost its player name")
	}
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

	if p.profile.DisplayName != name || p.ship.Name != name {
		t.Fatal("16 Unicode characters rejected or existing name overwritten")
	}
}
