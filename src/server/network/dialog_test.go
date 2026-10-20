package network

import (
	"bytes"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
)

func TestDialogVariantsAreSharedByRecipients(t *testing.T) {
	s, _, socket := pirateEncounter(t)
	observer := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, observer)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	gate := s.sectors[s.currentSector].portals[0]
	state := s.World.Random.State

	for _, kind := range []string{"pirate", "gate"} {
		t.Run(kind, func(t *testing.T) {
			for range 64 {
				socket.frames, observer.frames = nil, nil
				lines := []string{"First variant", "Second variant"}
				sender, role := gate.Name, "friendly"

				if kind == "pirate" {
					s.pirateChat(npc, []string{"First {player}", "Second {player}"}, "{player}", "variant")
					sender, role = npc.ship.Name, "hostile"
				} else {
					s.gateChat(gate, lines)
				}

				if len(socket.frames) != 1 || len(observer.frames) != 1 || !bytes.Equal(socket.frames[0], observer.frames[0]) {
					t.Fatal("one selected variant must be sent identically to every recipient")
				}

				if !slices.ContainsFunc(lines, func(text string) bool {
					expected, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: sender, SenderRole: role, Text: text}, s.World.Specification.Protocol)
					return err == nil && bytes.Equal(socket.frames[0], expected)
				}) {
					t.Fatal("chat must contain one complete, formatted variant")
				}
			}
		})
	}

	if s.World.Random.State != state {
		t.Fatal("speech must not change the simulation's random sequence")
	}
}
