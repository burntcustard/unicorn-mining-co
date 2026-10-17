package network

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

func (s *GameSession) chat(p *playerRecord, message protocol.Control) {
	text := strings.TrimSpace(message.Text)

	if text == "" || s.now().Sub(p.chatAt) < 500*time.Millisecond {
		return
	}

	p.chatAt = s.now()

	fields := strings.Fields(text)

	switch fields[0] {
	case "/tp", "/admin", "/unadmin", "/ban", "/pardon":
		if !p.canModerate() {
			s.replyChat(p, message.Channel, "Only admins and owners can use this command.")
			return
		}

		if fields[0] == "/tp" {
			s.teleportCommand(p, fields, message.Channel)
		} else {
			s.moderationCommand(p, fields[0], strings.TrimSpace(strings.TrimPrefix(text, fields[0])), message.Channel)
		}

		return
	case "/list":
		if len(fields) != 1 {
			s.replyChat(p, message.Channel, "Usage: /list")
			return
		}

		s.listCommand(p, message.Channel)
		return
	}

	response := protocol.ServerControl{Type: "chat", Channel: message.Channel, Sender: p.profile.DisplayName, Text: text}

	s.players.ForEach(func(recipient *playerRecord, _ string) {
		if recipient.socket != nil && !recipient.playedAt.IsZero() && (message.Channel == 1 || recipient.sectorID == p.sectorID) {
			s.sendControl(recipient.socket, response)
		}
	})
}

func (s *GameSession) replyChat(p *playerRecord, channel byte, text string) {
	s.sendControl(p.socket, protocol.ServerControl{Type: "chat", Channel: channel, Sender: "System", Text: text})
}

func (s *GameSession) listCommand(p *playerRecord, channel byte) {
	var lines []string

	s.players.ForEach(func(player *playerRecord, _ string) {
		if player.socket == nil || !player.socket.IsOpen() || player.playedAt.IsZero() {
			return
		}

		name := player.profile.DisplayName

		if name == "" {
			name = "Unnamed player"
		}

		if !p.canModerate() {
			lines = append(lines, name)
			return
		}

		sectorName := player.sectorID

		for _, sector := range s.sectorMap.Sectors {
			if sector.ID == player.sectorID {
				sectorName = sector.Name
				break
			}
		}

		lines = append(lines, fmt.Sprintf("%s — %s (%g, %g)", name, sectorName, math.Round(player.ship.Position.X), math.Round(player.ship.Position.Y)))
	})

	slices.Sort(lines)
	text := fmt.Sprintf("Players online: %d", len(lines))

	for _, line := range lines {
		// Keep each player on one line within the existing chat packet limit.
		if utf8.RuneCountInString(text)+1+utf8.RuneCountInString(line) > 240 {
			s.replyChat(p, channel, text)
			text = line
		} else {
			text += "\n" + line
		}
	}

	s.replyChat(p, channel, text)
}

func (s *GameSession) teleportCommand(p *playerRecord, fields []string, channel byte) {
	reply := func(text string) {
		s.replyChat(p, channel, text)
	}

	if len(fields) != 3 {
		reply("Usage: /tp x y (for example, /tp -5804 -53070)")
		return
	}

	x, xerr := strconv.ParseFloat(strings.TrimSuffix(fields[1], ","), 64)
	y, yerr := strconv.ParseFloat(fields[2], 64)

	if xerr != nil || yerr != nil || math.IsNaN(x) || math.IsNaN(y) || math.IsInf(x, 0) || math.IsInf(y, 0) {
		reply("Coordinates must be finite numbers. Usage: /tp x y")
		return
	}

	if p.ship.Dead || p.ship.DockedTo != nil {
		reply("You must be flying a ship to teleport. Leave the station or respawn first.")
		return
	}

	p.ship.Fly(0, 0)
	p.ship.Firing = false
	p.ship.Launching = 0
	s.relocatePlayer(p, p.sectorID, sectorArrival{position: Vec.Create(x, y)})
	reply(fmt.Sprintf("Teleported to %g, %g.", x, y))
}

func (s *GameSession) requestGateAccess(p *playerRecord, id int64) {
	entity, ok := s.World.Entities.Get(id)

	if !ok || p.ship.Dead || p.ship.DockedTo != nil {
		return
	}

	gate, ok := entity.(*objects.JumpGate)

	if !ok {
		return
	}

	response := "Access granted. Enter the circle once the gate is fully open."

	if Vec.DistanceSquared(p.ship.Position, gate.Position) > gate.Spec.ApproachRadius*gate.Spec.ApproachRadius {
		response = "Please approach the gate before requesting access."
	} else {
		s.connectedPassage(gate.Passage)
		gate.RequestOpening(1)
		gate.CloseAfter = float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep + gate.Spec.OpeningDuration/1000
	}

	s.sendControl(p.socket, protocol.ServerControl{Type: "chat", Sender: gate.Name, Text: response})
}
