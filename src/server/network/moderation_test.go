package network

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type moderationSocket struct {
	soundSocket
	closeCode   uint16
	closeReason string
}

func (socket *moderationSocket) CloseWith(code uint16, reason string) {
	socket.closeCode, socket.closeReason = code, reason
}

func namedPlayer(s *GameSession, name string) (*playerRecord, *moderationSocket) {
	socket := &moderationSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	s.Receive(protocol.Control{Type: "profile", DisplayName: name}, socket)
	socket.frames = nil
	return s.playersBySocket[socket], socket
}

func runChatCommand(s *GameSession, p *playerRecord, command string) {
	p.chatAt = time.Time{}
	s.Receive(protocol.Control{Type: "chat", Channel: 1, Text: command}, p.socket)
}

func chatReplies(t *testing.T, s *GameSession, socket *moderationSocket) []string {
	t.Helper()
	var messages []string

	for _, frame := range socket.frames {
		if len(frame) < 5 || frame[1] != 0x43 || int(frame[3]) != s.World.Specification.Protocol.ControlMessageIDs["chat"] {
			continue
		}

		reader := bytes.NewReader(frame[5:])
		var parts []string

		for range 3 {
			length, err := binary.ReadUvarint(reader)

			if err != nil || length > 960 {
				t.Fatal("invalid chat string length", err)
			}

			data := make([]byte, length)

			if _, err := io.ReadFull(reader, data); err != nil {
				t.Fatal(err)
			}

			if !utf8.Valid(data) || utf8.RuneCount(data) > 240 {
				t.Fatal("invalid chat text")
			}

			parts = append(parts, string(data))
		}

		if parts[0] != "System" || reader.Len() != 0 {
			t.Fatal("invalid command response")
		}

		messages = append(messages, parts[2])
	}

	return messages
}

func TestPlayerRoleCommands(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	owner, ownerSocket := namedPlayer(s, "burntcustard")
	admin, adminSocket := namedPlayer(s, "Other Admin")
	user, userSocket := namedPlayer(s, "Pilot")

	if owner.profile.Role != persistence.RoleOwner || admin.profile.Role != persistence.RoleUser || user.profile.Role != persistence.RoleUser {
		t.Fatal("initial player roles are incorrect")
	}

	position := user.ship.Position

	for _, command := range []string{"/admin Other Admin", "/unadmin burntcustard", "/ban Other Admin", "/pardon Other Admin", "/tp 100 200"} {
		runChatCommand(s, user, command)
	}

	if admin.profile.Role != persistence.RoleUser || owner.profile.Role != persistence.RoleOwner || admin.profile.Banned || user.ship.Position != position || len(chatReplies(t, s, userSocket)) != 5 {
		t.Fatal("a user acquired moderation permissions")
	}

	if len(ownerSocket.frames) != 0 || len(adminSocket.frames) != 0 {
		t.Fatal("permission errors were broadcast")
	}

	runChatCommand(s, owner, "/admin other admin")
	runChatCommand(s, admin, "/tp 100 200")
	runChatCommand(s, owner, "/tp -100 -200")

	if admin.profile.Role != persistence.RoleAdmin || admin.ship.Position != Vec.Create(100, 200) || owner.ship.Position != Vec.Create(-100, -200) {
		t.Fatal("an owner could not promote an admin or the admin could not teleport")
	}

	runChatCommand(s, admin, "/admin Pilot")
	runChatCommand(s, user, "/unadmin Other Admin")

	if user.profile.Role != persistence.RoleAdmin || admin.profile.Role != persistence.RoleUser {
		t.Fatal("admins could not add and remove other admins")
	}

	position = admin.ship.Position
	runChatCommand(s, admin, "/tp 300 400")

	if admin.ship.Position != position {
		t.Fatal("a demoted admin retained teleport access")
	}

	for _, command := range []string{"/admin burntcustard", "/unadmin burntcustard", "/ban burntcustard", "/pardon burntcustard"} {
		runChatCommand(s, user, command)
	}

	if owner.profile.Role != persistence.RoleOwner || owner.profile.Banned || owner.socket != ownerSocket {
		t.Fatal("an admin changed or banned the owner")
	}

	duplicate, _ := namedPlayer(s, "Other Admin")
	runChatCommand(s, owner, "/admin Other Admin")

	if duplicate.profile.Role != persistence.RoleUser || admin.profile.Role != persistence.RoleUser {
		t.Fatal("an ambiguous player name was modified")
	}

	for _, command := range []string{"/admin", "/unadmin", "/ban", "/pardon", "/ban Missing"} {
		ownerSocket.frames = nil
		runChatCommand(s, owner, command)

		if len(chatReplies(t, s, ownerSocket)) != 1 {
			t.Fatal("invalid command did not receive a private response", command)
		}
	}
}

func TestAdminSelfBan(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	admin, socket := namedPlayer(s, "Admin")
	admin.profile.Role = persistence.RoleAdmin
	runChatCommand(s, admin, "/ban Admin")

	if !admin.profile.Banned || admin.socket != nil || socket.closeCode != 4003 {
		t.Fatal("self-ban failed to disconnect and retain the account")
	}
}

func TestBanPardonAndRolesSurviveRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	owner, _ := namedPlayer(s, "burntcustard")
	admin, _ := namedPlayer(s, "Admin")
	target, targetSocket := namedPlayer(s, "Pilot")
	destination := s.sectors[target.sectorID].portals[0].DestinationSector
	s.relocatePlayer(target, destination, sectorArrival{position: Vec.Create(123, -456)})
	runChatCommand(s, owner, "/admin Admin")
	runChatCommand(s, admin, "/ban Pilot")
	token, shipID, credits := target.profile.ID, target.shipID, target.profile.Credits
	position := target.ship.Position
	sector := target.sectorID

	if !target.profile.Banned || target.socket != nil || targetSocket.closeCode != 4003 || targetSocket.closeReason != bannedMessage || target.shipID != shipID || target.profile.Credits != credits || target.ship.Dead {
		t.Fatal("ban failed to disconnect and retain the player")
	}

	// The old socket cannot keep issuing commands while its close is pending.
	s.Receive(protocol.Control{Type: "chat", Text: "/admin Pilot"}, targetSocket)

	if target.profile.Role != persistence.RoleUser {
		t.Fatal("banned socket retained command access")
	}

	for _, kind := range []string{"hello", "prepare"} {
		socket := &moderationSocket{}
		s.Receive(protocol.Control{Type: kind, PlayerToken: token}, socket)

		if socket.closeCode != 4003 || socket.closeReason != bannedMessage || s.playersBySocket[socket] != nil || len(socket.frames) != 0 {
			t.Fatal("banned player connected", kind)
		}
	}

	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	owner, _ = s.players.Get(owner.profile.ID)
	admin, _ = s.players.Get(admin.profile.ID)
	target, _ = s.players.Get(token)

	if owner.profile.Role != persistence.RoleOwner || admin.profile.Role != persistence.RoleAdmin || !target.profile.Banned || target.profile.Credits != credits || target.shipID != shipID || target.sectorID != sector || target.ship.Position != position {
		t.Fatal("restart lost roles, ban, or player data")
	}

	blocked := &moderationSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: token}, blocked)

	if blocked.closeCode != 4003 {
		t.Fatal("restart allowed a banned player to reconnect")
	}

	adminSocket := &moderationSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: admin.profile.ID}, adminSocket)
	runChatCommand(s, admin, "/pardon pilot")
	committedSession(t, s)
	socket := &moderationSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)

	if target.profile.Banned || s.playersBySocket[socket] != target || socket.closeCode != 0 || target.shipID != shipID {
		t.Fatal("pardoned player could not reconnect with the original data")
	}

	// Both actions must work when the player is offline, too.
	s.Disconnect(socket)
	runChatCommand(s, admin, "/ban Pilot")

	if !target.profile.Banned {
		t.Fatal("could not ban an offline player")
	}

	runChatCommand(s, admin, "/pardon Pilot")
	committedSession(t, s)
}

func TestInitialOwnerIsAssignedToSavedAccount(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	owner, _ := namedPlayer(s, "burntcustard")
	owner.profile.Role = persistence.RoleUser
	s.savePlayer(owner)
	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	owner, _ = s.players.Get(owner.profile.ID)
	duplicate, _ := namedPlayer(s, "BURNTCUSTARD")

	if owner.profile.Role != persistence.RoleOwner || duplicate.profile.Role != persistence.RoleUser {
		t.Fatal("owner bootstrap failed or a duplicate name gained ownership")
	}
}

func TestListChatCommand(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	requester, socket := namedPlayer(s, "Pilot")
	other, otherSocket := namedPlayer(s, "Other")
	offline, offlineSocket := namedPlayer(s, "Offline")
	s.Disconnect(offlineSocket)
	menuSocket := &moderationSocket{}
	s.Receive(protocol.Control{Type: "prepare"}, menuSocket)
	s.Receive(protocol.Control{Type: "profile", DisplayName: "Menu"}, menuSocket)
	destination := s.sectors[other.sectorID].portals[0].DestinationSector
	s.relocatePlayer(other, destination, sectorArrival{position: Vec.Create(123, -456)})
	requester.ship.Position = Vec.Create(-12, 34)
	otherSocket.frames, offlineSocket.frames, menuSocket.frames, socket.frames = nil, nil, nil, nil

	for _, role := range []persistence.PlayerRole{persistence.RoleUser, persistence.RoleAdmin, persistence.RoleOwner, persistence.RoleUser} {
		requester.profile.Role = role
		socket.frames = nil
		runChatCommand(s, requester, "/list")
		response := strings.Join(chatReplies(t, s, socket), "\n")

		if role == persistence.RoleUser {
			if response != "Players online: 2\nOther\nPilot" {
				t.Fatal("user list must contain only online player names", response)
			}

			continue
		}

		if !strings.Contains(response, "Players online: 2\n") || !strings.Contains(response, "Pilot — ") || !strings.Contains(response, "(-12, 34)") || !strings.Contains(response, "Other — ") || !strings.Contains(response, "(123, -456)") || strings.Contains(response, offline.profile.DisplayName) || strings.Contains(response, "Menu") {
			t.Fatal("player list omitted online players or included inactive players", response)
		}

		for _, sector := range s.sectorMap.Sectors {
			if sector.ID == destination && !strings.Contains(response, sector.Name) {
				t.Fatal("list did not show the remote player's sector name")
			}
		}
	}

	if len(otherSocket.frames)+len(offlineSocket.frames)+len(menuSocket.frames) != 0 {
		t.Fatal("player list was broadcast")
	}

	for index := range 12 {
		namedPlayer(s, fmt.Sprintf("Pilot %02d 🦄", index))
	}

	requester.profile.Role = persistence.RoleAdmin
	requester.ship.Position = Vec.Create(1e300, -1e300)
	socket.frames = nil
	runChatCommand(s, requester, "/list")
	replies := chatReplies(t, s, socket)
	response := strings.Join(replies, "\n")

	if len(replies) < 2 || !strings.HasPrefix(response, "Players online: 14\n") || strings.Count(response, "\n") != 14 || !strings.Contains(response, "(1e+300, -1e+300)") {
		t.Fatal("long player list was truncated or lost line breaks", response)
	}
}
