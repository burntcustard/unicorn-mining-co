package network

import (
	"fmt"
	"strings"

	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
)

const initialOwnerName = "burntcustard"
const bannedMessage = "Sorry, you have been banned. Contact john@burnt.io if you think this was a mistake"

func (p *playerRecord) canModerate() bool {
	return p.profile.Role == persistence.RoleAdmin || p.profile.Role == persistence.RoleOwner
}

// Bootstrap only an unambiguous account.
// Subsequent permissions belong to its private ID.
func (s *GameSession) assignInitialOwner() {
	var candidate *playerRecord
	owners, matches := 0, 0

	s.players.ForEach(func(p *playerRecord, _ string) {
		if p.profile.Role == persistence.RoleOwner {
			owners++
		}

		if strings.EqualFold(p.profile.DisplayName, initialOwnerName) {
			candidate = p
			matches++
		}
	})

	if owners == 0 && matches == 1 {
		candidate.profile.Role = persistence.RoleOwner
		s.savePlayer(candidate)
	}
}

func (s *GameSession) moderationCommand(p *playerRecord, command, name string, channel byte) {
	reply := func(text string) { s.replyChat(p, channel, text) }

	if name == "" {
		reply(fmt.Sprintf("Usage: %s playername", command))
		return
	}

	var target *playerRecord
	matches := 0

	s.players.ForEach(func(candidate *playerRecord, _ string) {
		if strings.EqualFold(candidate.profile.DisplayName, name) {
			target = candidate
			matches++
		}
	})

	if matches == 0 {
		reply("Player not found.")
		return
	}

	if matches > 1 {
		reply("More than one player has that name; no changes were made.")
		return
	}

	if target.profile.Role == persistence.RoleOwner {
		reply("Owners cannot be changed by this command.")
		return
	}

	switch command {
	case "/admin":
		target.profile.Role = persistence.RoleAdmin
		reply(fmt.Sprintf("%s is now an admin.", target.profile.DisplayName))
	case "/unadmin":
		target.profile.Role = persistence.RoleUser
		reply(fmt.Sprintf("%s is now a user.", target.profile.DisplayName))
	case "/ban":
		target.profile.Banned = true
		reply(fmt.Sprintf("%s has been banned.", target.profile.DisplayName))

		if socket := target.socket; socket != nil {
			target.stats.endReason = "banned"
			s.Disconnect(socket)
			socket.CloseWith(4003, bannedMessage)
		}

	case "/pardon":
		target.profile.Banned = false
		reply(fmt.Sprintf("%s has been pardoned.", target.profile.DisplayName))
	}

	s.savePlayer(target)
	s.flushChanges()
}
