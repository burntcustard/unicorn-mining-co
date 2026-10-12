package network

import (
	"testing"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

type activitySocket struct {
	benchmarkSocket
	closeCode uint16
}

func (s *activitySocket) CloseWith(code uint16, _ string) { s.closeCode = code }

func TestDockedPlayerActivity(t *testing.T) {
	for _, kind := range []string{"activity", "snapshotAck", "none"} {
		t.Run(kind, func(t *testing.T) {
			catalog, err := specs.Load()

			if err != nil {
				t.Fatal(err)
			}

			s := NewGameSession(25, catalog)
			clock := time.Unix(100000, 0)

			s.now = func() time.Time { return clock }

			socket := &activitySocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			p := s.playersBySocket[socket]
			station := s.nearestStation(p.ship.Position)
			stationID := int64(station.ID)
			p.ship.DockedTo = &stationID
			input, sequence := p.lastInput, p.lastSequence
			credits, modules, cargo := p.profile.Credits, len(p.ship.Modules()), len(p.ship.CargoContents)

			for visit := range 3 {
				clock = clock.Add(4 * time.Minute)

				if kind == "activity" {
					packet := []byte{0x55, 0x43, 1, byte(catalog.Protocol.ControlMessageIDs["activity"])}
					message, err := protocol.DecodeClientControl(packet, catalog.Protocol, catalog.Simulation.SimulationStep)

					if err != nil {
						t.Fatal(err)
					}

					s.Receive(message, socket)
				} else if kind == "snapshotAck" {
					s.Receive(protocol.Control{Type: "snapshotAck", Sequence: socket.sequence}, socket)
				}

				if p.lastInput != input || p.lastSequence != sequence || p.profile.Credits != credits || len(p.ship.Modules()) != modules || len(p.ship.CargoContents) != cargo {
					t.Fatal("activity must preserve controls, credits, modules, and cargo")
				}

				s.Tick(30)

				if visit == 0 || kind == "activity" {
					if p.socket != socket || socket.closeCode != 0 {
						t.Fatal("docked player was disconnected while recently active")
					}
				} else {
					if p.socket != nil || socket.closeCode != 4002 {
						t.Fatal("an unattended docked player must still time out despite snapshot acknowledgments")
					}

					return
				}
			}

			clock = clock.Add(5*time.Minute + time.Millisecond)
			s.Tick(30)

			if p.socket != nil || socket.closeCode != 4002 {
				t.Fatal("docked player must time out after interaction stops")
			}
		})
	}
}
