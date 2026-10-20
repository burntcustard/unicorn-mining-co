package network

import (
	"bytes"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestGateClosingWarningAndBeamInterruption(t *testing.T) {
	for _, connected := range []bool{false, true} {
		for _, rotation := range []float64{0, .71} {
			catalog, _ := specs.Load()
			s := NewGameSession(25, catalog)
			a, b, remote := &soundSocket{}, &soundSocket{}, &soundSocket{}

			for _, socket := range []*soundSocket{a, b, remote} {
				s.Receive(protocol.Control{Type: "hello"}, socket)
			}

			p := s.playersBySocket[a]
			var gate *objects.Portal

			for _, portal := range s.sectors[p.sectorID].portals {
				if portal.Kind == "jumpGate" {
					gate = portal
					break
				}
			}

			if connected {
				s.connectedPortal(gate)
			}

			s.relocatePlayer(s.playersBySocket[remote], gate.DestinationSector, sectorArrival{})
			gate.Rotation = rotation
			gate.RequestExitOpening()
			gate.Advance((gate.Spec.OpeningDuration + gate.Spec.StateHoldDuration) / 1000)
			a.frames, b.frames, remote.frames = nil, nil, nil
			s.updateGates(catalog.Simulation.SimulationStep)
			warning, _ := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Channel: 0, Sender: gate.Name, SenderRole: "friendly", Text: catalog.JumpGateDialog.Closing[0]}, catalog.Protocol)

			for _, socket := range []*soundSocket{a, b} {
				if len(socket.frames) != 1 || !bytes.Equal(socket.frames[0], warning) {
					t.Fatal("the gate must warn its sector once when closing starts")
				}
			}

			gate.Advance(gate.Spec.ClosingDuration / 4000)
			p.ship.Radius = 1
			from := Vec.Add(gate.Position, simulation.RotatePoint(Vec.Create(0, gate.Spec.BeamOffsets[0]-10), rotation))
			p.ship.Position = Vec.Add(gate.Position, simulation.RotatePoint(Vec.Create(0, gate.Spec.BeamOffsets[0]+10), rotation))
			opening := gate.Opening
			before := map[*playerRecord]Vec.Vector{p: from}
			s.interruptGateClosing(before)

			if gate.OpeningTarget != 1 || gate.Opening != opening || gate.BlockedBeams != 1 {
				t.Fatal("crossing one beam must reverse closing smoothly and mark only that beam")
			}

			s.interruptGateClosing(before)
			interrupted, _ := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Channel: 0, Sender: gate.Name, SenderRole: "friendly", Text: catalog.JumpGateDialog.ClosingInterrupted[0]}, catalog.Protocol)

			for _, socket := range []*soundSocket{a, b} {
				if len(socket.frames) != 2 || !bytes.Equal(socket.frames[1], interrupted) {
					t.Fatal("the reopening announcement must appear once in the gate's sector")
				}
			}

			for index := 1; index < len(gate.Spec.BeamOffsets); index++ {
				gate.Advance(gate.Spec.OpeningDuration / 100000)
				from = Vec.Add(gate.Position, simulation.RotatePoint(Vec.Create(0, gate.Spec.BeamOffsets[index]-10), rotation))
				p.ship.Position = Vec.Add(gate.Position, simulation.RotatePoint(Vec.Create(0, gate.Spec.BeamOffsets[index]+10), rotation))
				opening = gate.Opening
				s.interruptGateClosing(map[*playerRecord]Vec.Vector{p: from})

				if gate.BlockedBeams != uint8(1<<(index+1)-1) || gate.OpeningTarget != 1 || gate.Opening != opening {
					t.Fatal("crossing another beam during interrupted reopening must mark it without restarting the motion")
				}

				if len(a.frames) != 2 || len(b.frames) != 2 {
					t.Fatal("additional beam crossings must not repeat the reopening announcement")
				}
			}

			if len(remote.frames) != 0 {
				t.Fatal("gate safety announcements escaped the sector")
			}

			gate.Advance(gate.Spec.OpeningDuration / 1000)

			if gate.Opening != 1 || gate.BlockedBeams != 0 {
				t.Fatal("reopening did not reset the beam")
			}

			s.interruptGateClosing(before)

			if gate.BlockedBeams != 0 {
				t.Fatal("beam detection must stop when interrupted reopening finishes")
			}
		}
	}
}

func TestGateBeamsStayGreenDuringInitialOpening(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]

	for _, gate := range s.sectors[p.sectorID].portals {
		if gate.Kind != "jumpGate" {
			continue
		}

		gate.RequestExitOpening()
		gate.Advance(gate.Spec.OpeningDuration / 2000)
		p.ship.Radius = 1
		socket.frames = nil
		opening := gate.Opening

		for _, y := range gate.Spec.BeamOffsets {
			from := Vec.Add(gate.Position, simulation.RotatePoint(Vec.Create(0, y-10), gate.Rotation))
			p.ship.Position = Vec.Add(gate.Position, simulation.RotatePoint(Vec.Create(0, y+10), gate.Rotation))
			s.interruptGateClosing(map[*playerRecord]Vec.Vector{p: from})

			if gate.BlockedBeams != 0 || gate.OpeningTarget != 1 || gate.Opening != opening || len(socket.frames) != 0 {
				t.Fatal("crossing beams during initial opening must leave them green without affecting motion or chat")
			}
		}

		return
	}

	t.Fatal("starting sector has no jump gate")
}

func TestGateSafetyRunsDuringWorldTicks(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]

	for _, gate := range s.sectors[p.sectorID].portals {
		if gate.Kind != "jumpGate" {
			continue
		}

		s.connectedPortal(gate)
		gate.RequestExitOpening()
		gate.Advance((gate.Spec.OpeningDuration + gate.Spec.StateHoldDuration) / 1000)
		gate.RequestOpening(0)
		gate.Advance(gate.Spec.ClosingDuration / 10000)
		p.ship.Position = Vec.Add(gate.Position, simulation.RotatePoint(Vec.Create(0, gate.Spec.BeamOffsets[0]), gate.Rotation))
		p.ship.Velocity = simulation.RotatePoint(Vec.Create(0, 100), gate.Rotation)
		s.Tick(1)

		if gate.OpeningTarget != 1 || gate.BlockedBeams == 0 {
			t.Fatal("normal world updates did not interrupt a closing gate")
		}

		previous := gate.Opening
		s.Tick(1)

		if gate.Opening <= previous || gate.BlockedBeams == 0 {
			t.Fatal("the following world update did not continue opening with red beams")
		}

		return
	}

	t.Fatal("starting sector has no jump gate")
}
