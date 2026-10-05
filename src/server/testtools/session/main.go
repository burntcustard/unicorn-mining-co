// Executes the same session actions as tests/parity/session.test.ts.
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/network"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"os"
)

type socket struct {
	packets []string
	open    bool
	buffer  int
	code    uint16
}

func (s *socket) IsOpen() bool { return s.open }

func (s *socket) BufferedBytes() int { return s.buffer }

func (s *socket) SendBinary(data []byte) error {
	s.packets = append(s.packets, hex.EncodeToString(data))
	return nil
}

func (s *socket) Terminate() { s.open = false }

func (s *socket) CloseWith(code uint16, _ string) { s.open = false; s.code = code }

type action struct {
	Kind   string
	Socket int
	Packet string
	Ticks  uint64
	Buffer int
}

func main() {
	var actions []action

	if err := json.NewDecoder(os.Stdin).Decode(&actions); err != nil {
		panic(err)
	}

	catalog, err := definitions.Load()

	if err != nil {
		panic(err)
	}

	session := network.NewGameSession(25, catalog)
	sockets := map[int]*socket{}

	for _, a := range actions {
		s := sockets[a.Socket]

		if s == nil {
			s = &socket{open: true}
			sockets[a.Socket] = s
		}

		switch a.Kind {
		case "receive":
			data, err := hex.DecodeString(a.Packet)

			if err != nil {
				panic(err)
			}

			message, err := protocol.DecodeClientControl(data, catalog.Protocol, catalog.Simulation.SimulationStep)

			if err != nil {
				panic(err)
			}

			session.Receive(message, s)
		case "dockSetup":
			player, _ := session.World.Players.Get(1)
			e, _ := session.World.Entities.Get(player.ShipID)

			ship := e.(interface{ ShipBase() *objects.Ship }).ShipBase()

			id := int64(999)
			ship.DockedTo = &id
			*player.Credits = 10000
			health := ship.HullHealth()
			health[0] = 1
			ship.SetHullHealth(health)
			itemID := int64(123456)
			ship.CargoContents = append(ship.CargoContents, objects.NewItem("diamond", simulation.ObjectProperties{ID: &itemID}, catalog))
		case "destroy":
			player, _ := session.World.Players.Get(1)
			session.World.Entities.Delete(player.ShipID)
		case "ackLatest":
			if len(s.packets) > 0 {
				data, _ := hex.DecodeString(s.packets[len(s.packets)-1])

				if data[1] == 0x4d {
					at := 4

					read := func() uint64 {
						var value uint64
						shift := 0

						for {
							b := data[at]
							at++
							value |= uint64(b&127) << shift

							if b&128 == 0 {
								return value
							}

							shift += 7
						}
					}

					read()
					read()

					if data[3]&4 != 0 {
						read()
					}

					if data[3]&8 != 0 {
						read()
					}

					if data[3]&16 != 0 {
						session.Receive(protocol.Control{Type: "snapshotAck", Sequence: read()}, s)
					}
				}
			}
		case "tick":
			session.Tick(a.Ticks)
		case "disconnect":
			session.Disconnect(s)
		case "buffer":
			s.buffer = a.Buffer
		case "reconnect":
			// Take the random token from the previous welcome, as a browser does.
			old := sockets[a.Buffer]
			data, _ := hex.DecodeString(old.packets[0])
			offset := 4

			for range 3 {
				for data[offset]&128 != 0 {
					offset++
				}

				offset++
			}

			b := data[offset : offset+16]
			token := fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
			session.Receive(protocol.Control{Type: "hello", PlayerToken: token}, s)
		}
	}

	result := map[int]any{}

	for id, s := range sockets {
		result[id] = map[string]any{"packets": s.packets, "code": s.code}
	}

	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		panic(err)
	}
}
