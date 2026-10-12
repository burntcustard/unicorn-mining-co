// Drive the real session with client-encoded packets and controlled ID drift.
package main

import (
	"encoding/hex"
	"encoding/json"
	"io"
	"os"

	"github.com/burntcustard/unicorn-mining-co/src/server/network"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

type socket struct {
	packets  []string
	buffered int
}

func (s *socket) IsOpen() bool { return true }

func (s *socket) BufferedBytes() int { return s.buffered }

func (s *socket) Terminate() {}

func (s *socket) CloseWith(uint16, string) {}

func (s *socket) SendBinary(data []byte) error {
	s.packets = append(s.packets, hex.EncodeToString(data))
	return nil
}

func main() {
	catalog, err := specs.Load()

	if err != nil {
		panic(err)
	}

	session := network.NewGameSession(25, catalog)
	socket := &socket{packets: []string{}}
	decoder := json.NewDecoder(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)

	for {
		var command struct {
			Kind    string
			Packets []string
		}

		if err := decoder.Decode(&command); err == io.EOF {
			return
		} else if err != nil {
			panic(err)
		}

		switch command.Kind {
		case "setup":
			session.Receive(protocol.Control{Type: "hello"}, socket)
			player, _ := session.World.Players.Get(1)
			entity, _ := session.World.Entities.Get(player.ShipID)

			ship := entity.(interface{ ShipBase() *objects.Ship }).ShipBase()

			id := simulation.EntityID(session.World)
			station := objects.NewStation("corral-5", objects.Properties{ObjectProperties: simulation.ObjectProperties{World: session.World, ID: &id, Position: ship.Position}}, catalog)
			simulation.AddEntity(session.World, station)
			ship.DockedTo = &id
			*player.Credits = 10000
			itemID := simulation.EntityID(session.World)
			ship.CargoContents = append(ship.CargoContents,
				objects.NewItem("gold", simulation.ObjectProperties{World: session.World, ID: &itemID}, catalog),
				modules.Create("autogun", simulation.ObjectProperties{World: session.World}, catalog))
			// A rejected request forces a full load of the controlled dock state.
			session.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "buyStock"}}, socket)
		case "drift":
			session.World.NextEntityID += 100
		case "block":
			socket.buffered = network.MaxSnapshotBuffer + 1
		case "unblock":
			socket.buffered = 0
		case "takeStock":
			player, _ := session.World.Players.Get(1)
			entity, _ := session.World.Entities.Get(player.ShipID)

			ship := entity.(interface{ ShipBase() *objects.Ship }).ShipBase()

			station := ship.TradeStation()
			station.CargoContents = station.CargoContents[1:]
		case "tick":
			session.Tick(1)
		}

		for _, packet := range command.Packets {
			data, err := hex.DecodeString(packet)

			if err != nil {
				panic(err)
			}

			message, err := protocol.DecodeClientControl(data, catalog.Protocol, catalog.Simulation.SimulationStep)

			if err != nil {
				panic(err)
			}

			session.Receive(message, socket)
		}

		if err := encoder.Encode(socket.packets); err != nil {
			panic(err)
		}

		socket.packets = socket.packets[:0]
	}
}
