package network

import (
	"bytes"
	"testing"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestTeleportChatCommand(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	a, b := &soundSocket{}, &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, a)
	s.Receive(protocol.Control{Type: "hello"}, b)
	p := s.playersBySocket[a]
	p.profile.Role = persistence.RoleAdmin
	destination := s.sectors[p.sectorID].passages[0].DestinationSector
	s.relocatePlayer(p, destination, sectorArrival{})
	world := p.ship.World

	for _, command := range []string{"/tp -5804 -53070", "  /tp 123.5, -456.25  "} {
		p.chatAt = time.Time{}
		p.ship.Velocity = Vec.Create(100, 200)
		p.ship.Spin, p.ship.Launching, p.ship.TransitTime = 1, 2, -1
		p.ship.TransitGate = 123
		a.frames, b.frames = nil, nil
		s.Receive(protocol.Control{Type: "chat", Channel: 1, Text: command}, a)

		if p.sectorID != destination || p.ship.World != world {
			t.Fatal("teleport changed the player's sector")
		}

		if p.ship.Velocity != (Vec.Vector{}) || p.ship.Spin != 0 || p.ship.Launching != 0 || p.ship.TransitTime != 0 || p.ship.TransitGate != 0 {
			t.Fatal("teleport retained movement or portal transit")
		}

		if len(a.frames) == 0 || len(b.frames) != 0 {
			t.Fatal("command response must be private even in global chat")
		}

		want := Vec.Create(-5804, -53070)

		if command[0] == ' ' {
			want = Vec.Create(123.5, -456.25)
		}

		if p.ship.Position != want {
			t.Fatalf("position %v, want %v", p.ship.Position, want)
		}
	}

	position := p.ship.Position

	for _, command := range []string{"/tp", "/tp 1", "/tp 1 2 3", "/tp nope 2", "/tp NaN 2", "/tp 1 +Inf", "/tp 1e999 2"} {
		p.chatAt = time.Time{}
		a.frames, b.frames = nil, nil
		s.Receive(protocol.Control{Type: "chat", Text: command}, a)

		if p.ship.Position != position || len(a.frames) != 1 || len(b.frames) != 0 {
			t.Fatalf("invalid command was not rejected privately: %s", command)
		}
	}

	station := int64(999)
	p.ship.DockedTo = &station
	p.chatAt = time.Time{}
	s.Receive(protocol.Control{Type: "chat", Text: "/tp 0 0"}, a)

	if p.ship.Position != position || p.ship.DockedTo == nil {
		t.Fatal("docked command moved the ship")
	}
}

func TestChatSenderRoles(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]

	for _, role := range []persistence.PlayerRole{persistence.RoleUser, persistence.RoleOwner, persistence.RoleAdmin} {
		p.profile.Role = role
		p.chatAt = time.Time{}
		socket.frames = nil
		s.Receive(protocol.Control{Type: "chat", Text: "Hello"}, socket)
		expected, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: p.profile.DisplayName, SenderRole: string(role), Text: "Hello"}, catalog.Protocol)

		if err != nil || len(socket.frames) != 1 || !bytes.Equal(socket.frames[0], expected) {
			t.Fatalf("chat lost authoritative role %s", role)
		}
	}
}
