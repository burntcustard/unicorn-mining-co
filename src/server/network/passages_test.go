package network

import (
	"bytes"
	"context"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestGateAccessAndSectorTravel(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket, observer := &soundSocket{}, &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	s.Receive(protocol.Control{Type: "hello"}, observer)
	p, other := s.playersBySocket[socket], s.playersBySocket[observer]
	p.profile.DisplayName = "Arriving pilot"
	source := s.currentSector
	var gate *objects.Passage

	for _, passage := range s.sectors[source].passages {
		if passage.Kind == "jumpGate" {
			gate = passage
			break
		}
	}

	if gate == nil {
		t.Fatal("starting sector has no gate")
	}

	gateRotation := gate.Rotation

	if gate.Opening != 0 || !gate.Crossed(gate.Position, gate.Position) {
		t.Fatal("closed gate should still permit portal entry")
	}

	s.Receive(protocol.Control{Type: "gateAccess", GateID: uint64(gate.ID)}, socket)

	if gate.OpeningTarget != 0 {
		t.Fatal("remote access accepted")
	}

	p.ship.Position = Vec.Add(gate.Position, Vec.Create(0, 500))
	s.Receive(protocol.Control{Type: "gateAccess", GateID: uint64(gate.ID)}, socket)

	s.updateGateAccess(2 * gate.Spec.AccessResponseDelay / 1000)

	if gate.OpeningTarget != 0 {
		t.Fatal("access request bypassed the new gate's minimum closed-state hold")
	}

	s.updateGates(gate.Spec.StateHoldDuration / 1000)

	if gate.OpeningTarget != 1 {
		t.Fatal("nearby access refused")
	}

	s.updateGates(gate.Spec.OpeningDuration / 1000)

	if gate.Connected == nil || gate.Connected.Opening != 0 || gate.Opening != 1 {
		t.Fatal("access should open only the requested gate")
	}

	if gate.Rotation != gateRotation || gate.Position == (Vec.Vector{}) {
		t.Fatal("gate moved")
	}

	for _, collider := range gate.Hitbox() {
		if collider.DockSegment {
			t.Fatal("gate has a docking bay")
		}
	}

	if !gate.Crossed(Vec.Add(gate.Position, Vec.Create(-500, 0)), Vec.Add(gate.Position, Vec.Create(500, 0))) {
		t.Fatal("fast crossing missed")
	}

	before := map[*playerRecord]Vec.Vector{p: Vec.Add(gate.Position, Vec.Create(0, 200))}
	p.ship.Position = gate.Position
	p.ship.Fuel = 7.5
	credits, shipID, rotation := p.profile.Credits, p.shipID, p.ship.Rotation
	s.World.Tick++
	s.crossPassages(before)
	finishDeparture(t, s, p)

	arrivalMessage, err := protocol.EncodeServerControl(protocol.ServerControl{
		Type: "chat", Sender: gate.Connected.Name, SenderRole: "friendly",
		Text: fmt.Sprintf("Welcome to %s, %s", gate.DestinationName, p.profile.DisplayName),
	}, catalog.Protocol)

	if err != nil {
		t.Fatal(err)
	}

	countArrivalMessages := func(frames [][]byte) int {
		count := 0

		for _, frame := range frames {
			if bytes.Equal(frame, arrivalMessage) {
				count++
			}
		}

		return count
	}

	if countArrivalMessages(socket.frames) != 1 || countArrivalMessages(observer.frames) != 0 {
		t.Fatal("destination gate should greet only the arriving player once")
	}

	if p.sectorID != gate.DestinationSector || p.ship.Position != gate.Connected.Position || p.shipID != shipID || p.ship.Fuel != 7.5 || p.profile.Credits != credits {
		t.Fatal("travel lost ship state or used wrong arrival")
	}

	if p.ship.Velocity != (Vec.Vector{}) || math.Abs(p.ship.Rotation-rotation) > 1e-6 || p.ship.TransitTime <= 0 || p.ship.Launching != 0 {
		t.Fatal("arrival did not preserve the ship rotation")
	}

	if s.sectors[source].world.Entities.Has(shipID) || !s.sectors[p.sectorID].world.Entities.Has(shipID) {
		t.Fatal("ship not transferred between worlds")
	}

	if other.sectorID != source || other.ship.World == p.ship.World {
		t.Fatal("other player travelled with ship")
	}

	s.Receive(protocol.Control{Type: "snapshotAck", Sequence: observer.sequence}, observer)
	s.Tick(1)

	if countArrivalMessages(socket.frames) != 1 {
		t.Fatal("destination gate repeated its arrival greeting")
	}

	if slices.Contains(other.binaryReplication.entityIDs, uint64(shipID)) {
		t.Fatal("ship replicated into old sector")
	}

	s.Disconnect(socket)

	if s.sectors[p.sectorID].world.Players.Has(p.playerID) {
		t.Fatal("disconnect used wrong world")
	}

	s.Receive(protocol.Control{Type: "hello", PlayerToken: p.profile.ID}, socket)

	if p.ship.World != s.sectors[p.sectorID].world || !p.ship.World.Players.Has(p.playerID) {
		t.Fatal("reconnect used wrong world")
	}
}

func TestJumpGatePairRotations(t *testing.T) {
	catalog, _ := specs.Load()
	worldRotations := map[string]float64{}

	for _, seed := range []float64{0, 25, 4294967295} {
		rotations := map[string]float64{}

		for _, reversed := range []bool{false, true} {
			s := NewGameSession(seed, catalog)
			ids := slices.Clone(s.sectorMap.Enabled)

			if reversed {
				slices.Reverse(ids)
			}

			for _, id := range ids {
				s.activateSector(id)
			}

			for _, runtime := range s.sectors {
				for _, gate := range runtime.passages {
					if gate.Kind != "jumpGate" {
						continue
					}

					exit := s.connectedPassage(gate)

					if gate.Rotation != exit.Rotation || gate.Rotation < 0 || gate.Rotation >= 2*math.Pi {
						t.Fatal("connected gates must share a rotation within a full turn")
					}

					if expected, exists := rotations[gate.ConnectionID]; exists && gate.Rotation != expected {
						t.Fatal("gate rotation changed with sector creation order")
					}

					rotations[gate.ConnectionID] = gate.Rotation
				}
			}
		}

		unique := map[float64]bool{}

		for id, rotation := range rotations {
			unique[rotation] = true

			if previous, exists := worldRotations[id]; exists && rotation == previous {
				t.Fatal("different world seeds must change gate rotations")
			}

			worldRotations[id] = rotation
		}

		if len(unique) < 2 {
			t.Fatal("different gate pairs must have varied rotations")
		}
	}
}

func TestSectorAndGlobalChat(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	a, b, c := &soundSocket{}, &soundSocket{}, &soundSocket{}

	for _, socket := range []*soundSocket{a, b, c} {
		s.Receive(protocol.Control{Type: "hello"}, socket)
	}

	sender, remote := s.playersBySocket[a], s.playersBySocket[c]
	destination := s.sectors[s.currentSector].passages[0].DestinationSector
	s.relocatePlayer(remote, destination, sectorArrival{})
	a.frames, b.frames, c.frames = nil, nil, nil
	s.Receive(protocol.Control{Type: "chat", Channel: 0, Text: "Sector hello"}, a)

	if len(a.frames) != 1 || len(b.frames) != 1 || len(c.frames) != 0 {
		t.Fatal("sector chat escaped sector")
	}

	sender.chatAt = time.Time{}
	s.Receive(protocol.Control{Type: "chat", Channel: 1, Text: "Global hello"}, a)

	if len(a.frames) != 2 || len(b.frames) != 2 || len(c.frames) != 1 {
		t.Fatal("global chat missing recipients")
	}

	s.Receive(protocol.Control{Type: "chat", Channel: 1, Text: "Spam"}, a)

	if len(c.frames) != 1 {
		t.Fatal("chat rate limit not applied")
	}
}

func TestSectorTravelSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sectors.sqlite")
	s, store := persistedSession(t, path)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	passage := s.sectors[s.currentSector].passages[0]
	exit := s.connectedPassage(passage)
	s.relocatePlayer(p, passage.DestinationSector, sectorArrival{position: exit.Position, portal: exit.ID})
	destination, position, token := p.sectorID, p.ship.Position, p.profile.ID

	if err := s.shutdownPersistence(context.Background()); err != nil {
		t.Fatal(err)
	}

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	restored, restoredStore := persistedSession(t, path)
	defer restoredStore.Close(context.Background())
	restored.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)
	p = restored.playersBySocket[socket]

	if p.sectorID != destination || p.ship.Position != position || p.ship.World != restored.sectors[destination].world {
		t.Fatalf("saved sector was not restored: sector=%s want=%s position=%v want=%v world=%p want=%p profile=%s", p.sectorID, destination, p.ship.Position, position, p.ship.World, restored.sectors[destination].world, p.profile.SectorID)
	}

	if p.ship.TransitTime <= 0 || p.ship.TransitGate != exit.ID {
		t.Fatal("restart lost the arrival animation")
	}

	restored.Tick(1)
	entity, _ := p.ship.World.Entities.Get(exit.ID)

	portal := entity.(objects.PassageEntity).PassageBase()

	step := restored.World.Specification.Simulation.SimulationStep * 1000 / portal.Spec.OpeningDuration

	if portal.Opening < 0 || portal.Opening > step || portal.OpeningTarget != 1 {
		t.Fatal("resuming a saved transit did not request a smooth opening")
	}

}

func TestWormholeTravelBothDirections(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	source := p.sectorID
	var hole *objects.Passage

	for _, passage := range s.sectors[source].passages {
		if passage.Kind == "wormhole" {
			hole = passage
			break
		}
	}

	if hole == nil {
		t.Fatal("starting sector has no wormhole")
	}

	p.ship.Position = hole.Position
	s.Tick(1)
	finishDeparture(t, s, p)

	if p.sectorID != hole.DestinationSector || p.ship.Position != hole.Connected.Position {
		t.Fatal("wormhole did not travel during simulation")
	}

	s.Tick(1)

	if p.sectorID == source {
		t.Fatal("arrival immediately returned through wormhole")
	}

	for range 240 {
		s.Tick(1)
	}

	for _, passage := range s.sectors[p.sectorID].passages {
		if passage.Kind == "wormhole" && passage.DestinationSector == source {
			p.ship.Launching = 0
			p.ship.Position = Vec.Add(passage.Position, Vec.Create(passage.TravelRadius+100, 0))
			s.Tick(1)
			p.ship.Position = passage.Position
			break
		}
	}

	s.Tick(1)

	finishDeparture(t, s, p)

	if p.sectorID != source {
		t.Fatal("wormhole was not bidirectional")
	}
}

func TestPassageArrivalAndManualDeparture(t *testing.T) {
	for _, kind := range []string{"jumpGate", "wormhole"} {
		for _, direction := range []Vec.Vector{Vec.Create(0, -1), Vec.Create(1, 0), Vec.Normalize(Vec.Create(-1, 1))} {
			t.Run(kind+"/"+fmt.Sprint(direction), func(t *testing.T) {
				catalog, _ := specs.Load()
				s := NewGameSession(25, catalog)
				socket := &soundSocket{}
				s.Receive(protocol.Control{Type: "hello"}, socket)
				p := s.playersBySocket[socket]
				var passage *objects.Passage

				for _, candidate := range s.sectors[p.sectorID].passages {
					if candidate.Kind == kind {
						passage = candidate
						break
					}
				}

				exit := s.connectedPassage(passage)
				passage.Opening, passage.OpeningTarget = 1, 1
				passage.RequestOpening(1)
				p.ship.Position = passage.Position
				p.ship.Velocity = Vec.Scale(direction, 100)
				p.ship.Rotation = 0 // Travel preserves facing independently of movement.
				s.World.Tick++
				s.crossPassages(map[*playerRecord]Vec.Vector{p: Vec.AddScaled(passage.Position, direction, -200)})
				finishDeparture(t, s, p)

				if Vec.Distance(p.ship.Position, exit.Position) > 1e-8 || p.ship.Rotation != 0 {
					t.Fatal("arrival did not preserve the ship position and facing")
				}

				destination := p.sectorID

				for range 300 {
					s.Tick(1)
				}

				if p.sectorID != destination || p.ship.Launching != 0 || p.ship.Velocity != (Vec.Vector{}) || p.ship.Position != exit.Position {
					t.Fatal("arrival did not remain stationary until pilot input")
				}

				p.lastInput.Thrust = 1

				for range 180 {
					s.Tick(1)
				}

				if p.sectorID != destination || p.ship.Launching != 0 || Vec.Distance(p.ship.Position, exit.Position) <= exit.Radius+p.ship.Radius {
					t.Fatalf("manual flight failed to clear passage: sector=%s distance=%v launching=%v", p.sectorID, Vec.Distance(p.ship.Position, exit.Position), p.ship.Launching)
				}
			})
		}
	}
}

func TestGateMotionAndOccupancyAreIndependent(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	var gate *objects.Passage

	for _, candidate := range s.sectors[p.sectorID].passages {
		if candidate.Kind == "jumpGate" {
			gate = candidate
			break
		}
	}

	exit := s.connectedPassage(gate)
	s.relocatePlayer(p, gate.DestinationSector, sectorArrival{position: Vec.Add(exit.Position, Vec.Create(0, exit.Radius-1))})
	exit.RequestOpening(1)
	s.updateGates(gate.Spec.StateHoldDuration / 1000)
	s.updateGates(gate.Spec.OpeningDuration / 2000)

	if gate.Opening != 0 || exit.Opening != .5 {
		t.Fatal("opening the destination changed the entrance")
	}

	s.updateGates(gate.Spec.OpeningDuration / 2000)
	s.updateGates(gate.Spec.StateHoldDuration / 1000)

	if gate.Opening != 0 || exit.Opening != 1 || gate.OpeningTarget != 0 {
		t.Fatal("remote occupancy should hold only the destination open")
	}

	p.ship.Position = Vec.Add(exit.Position, Vec.Create(0, exit.Radius+1))
	s.updateGates(catalog.Simulation.SimulationStep)

	if gate.Opening != 0 || gate.OpeningTarget != 0 || exit.OpeningTarget != 0 || exit.Opening >= 1 {
		t.Fatal("only the destination should begin closing when its occupant leaves")
	}

	s.updateGates(gate.Spec.ClosingDuration / 1000)

	if gate.Opening != 0 || exit.Opening != 0 {
		t.Fatal("destination did not finish closing")
	}
}

func finishDeparture(t *testing.T, s *GameSession, p *playerRecord) {
	t.Helper()
	source := p.sectorID

	if p.ship.TransitTime >= 0 {
		t.Fatal("crossing did not start departure")
	}

	for range 240 {
		s.Tick(1)

		if p.sectorID != source {
			return
		}
	}

	t.Fatal("departure did not transfer to the destination")
}

func TestClosedGatePortalDoesNotRequireAccess(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	var gate *objects.Passage

	for _, passage := range s.sectors[p.sectorID].passages {
		if passage.Kind == "jumpGate" {
			gate = passage
			break
		}
	}

	if gate.Opening != 0 {
		t.Fatal("test gate must begin closed")
	}

	p.ship.Position = gate.Position
	p.ship.Rotation = .75
	p.ship.Spin = 1
	s.Tick(1)
	rotation := p.ship.Rotation

	if p.ship.TransitTime >= 0 {
		t.Fatal("portal refused entry without an access request")
	}

	finishDeparture(t, s, p)

	for p.ship.TransitTime > 0 {
		s.Tick(1)
	}

	if math.Abs(p.ship.Rotation-rotation) > 1e-6 || p.sectorID != gate.DestinationSector {
		t.Fatal("travel changed hull rotation or failed to transfer")
	}
}

func TestGateTransitPreservesMotion(t *testing.T) {
	for _, state := range []struct {
		name            string
		opening, target float64
	}{
		{"closed", 0, 0},
		{"closing", .5, 0},
		{"opening", .5, 1},
	} {
		t.Run(state.name, func(t *testing.T) {
			catalog, _ := specs.Load()
			s := NewGameSession(25, catalog)
			socket := &soundSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			p := s.playersBySocket[socket]
			var gate *objects.Passage

			for _, passage := range s.sectors[p.sectorID].passages {
				if passage.Kind == "jumpGate" {
					gate = passage
					break
				}
			}

			exit := s.connectedPassage(gate)
			gate.Opening, gate.OpeningTarget = state.opening, state.target
			gate.RequestOpening(state.target)
			p.ship.Position = gate.Position
			duration := gate.Spec.ClosingDuration

			if state.target == 1 {
				duration = gate.Spec.OpeningDuration
			}

			step := catalog.Simulation.SimulationStep * 1000 / min(duration, gate.Spec.OpeningDuration)
			previous, previousExit := state.opening, exit.Opening

			// Cover entry, departure, arrival, and waiting inside the destination.
			for tick := range 900 {
				s.Tick(1)

				if math.Abs(gate.Opening-previous) > step+1e-8 || math.Abs(exit.Opening-previousExit) > step+1e-8 {
					t.Fatalf("transit snapped gate motion at tick %d: opening=%v previous=%v", tick, gate.Opening, previous)
				}

				previous, previousExit = gate.Opening, exit.Opening
			}

			if exit.Opening != 1 || p.sectorID != gate.DestinationSector || p.ship.TransitTime != 0 || p.ship.Position != exit.Position {
				t.Fatal("preserving gate motion prevented travel or stationary arrival")
			}
		})
	}
}

func TestGateEntryRequestsDestinationOpeningImmediately(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]

	for _, gate := range s.sectors[p.sectorID].passages {
		if gate.Kind != "jumpGate" {
			continue
		}

		p.ship.Position = gate.Position
		s.World.Tick++
		s.crossPassages(map[*playerRecord]Vec.Vector{p: Vec.Add(gate.Position, Vec.Create(0, 200))})

		if p.ship.TransitTime >= 0 || gate.Connected == nil || gate.Connected.Opening != 0 || gate.Connected.OpeningTarget != 1 {
			t.Fatal("entry did not immediately request opening at the destination without snapping")
		}

		s.updateGates(catalog.Simulation.SimulationStep)

		if gate.Connected.Opening <= 0 || gate.Connected.Opening >= 1 {
			t.Fatal("destination did not start animating open during departure")
		}

		return
	}

	t.Fatal("starting sector has no jump gate")
}

func TestClosedGateInteriorRecovery(t *testing.T) {
	for _, position := range []struct {
		name   string
		offset Vec.Vector
		inside bool
	}{
		{"interior", Vec.Create(0, 180), true},
		{"diagonal interior", Vec.Create(120, 140), true},
		{"outside side", Vec.Create(210, 0), false},
		{"outside top", Vec.Create(0, 230), false},
		{"outside diagonal", Vec.Create(180, 180), false},
	} {
		for _, rotation := range []float64{0, .71} {
			t.Run(fmt.Sprintf("%s/%g", position.name, rotation), func(t *testing.T) {
				catalog, _ := specs.Load()
				catalog.JumpGateSpec.RecoveryMessage = "Recovery for {player}"
				s := NewGameSession(25, catalog)
				a, b, remote := &soundSocket{}, &soundSocket{}, &soundSocket{}

				for _, socket := range []*soundSocket{a, b, remote} {
					s.Receive(protocol.Control{Type: "hello"}, socket)
				}

				p := s.playersBySocket[a]
				p.profile.DisplayName = "Custard"
				var gate *objects.Passage

				for _, passage := range s.sectors[p.sectorID].passages {
					if passage.Kind == "jumpGate" {
						gate = passage
						break
					}
				}

				exit := s.connectedPassage(gate)
				s.relocatePlayer(s.playersBySocket[remote], gate.DestinationSector, sectorArrival{})
				gate.Rotation = rotation
				p.ship.Position = Vec.Add(gate.Position, simulation.RotatePoint(position.offset, rotation))
				a.frames, b.frames, remote.frames = nil, nil, nil
				s.preparePassages()

				if !position.inside {
					if gate.OpeningTarget != 0 || len(a.frames)+len(b.frames)+len(remote.frames) != 0 {
						t.Fatal("ship outside the octagon triggered recovery")
					}

					return
				}

				if gate.Opening != 0 || gate.OpeningTarget != 1 || exit.Opening != 0 || exit.OpeningTarget != 0 {
					t.Fatal("trapped ship did not request a smooth opening")
				}

				expected, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Channel: 0, Sender: gate.Name, SenderRole: "friendly", Text: "Recovery for Custard"}, catalog.Protocol)

				if err != nil {
					t.Fatal(err)
				}

				for _, socket := range []*soundSocket{a, b} {
					if len(socket.frames) != 1 || !bytes.Equal(socket.frames[0], expected) {
						t.Fatal("recovery message missing from sector chat")
					}
				}

				s.preparePassages()

				if len(a.frames) != 1 || len(b.frames) != 1 || len(remote.frames) != 0 {
					t.Fatal("recovery message repeated or escaped the sector")
				}

				s.updateGates(catalog.Simulation.SimulationStep)

				if gate.Opening <= 0 || gate.Opening >= 1 || exit.Opening != 0 || exit.OpeningTarget != 0 {
					t.Fatal("recovery did not animate the gate open")
				}
			})
		}
	}
}

func TestReconnectInsideClosedGateOpensOnlyLocalGate(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	p.profile.DisplayName = "Custard"
	var entrance *objects.Passage

	for _, gate := range s.sectors[p.sectorID].passages {
		if gate.Kind == "jumpGate" {
			entrance = gate
			break
		}
	}

	p.ship.Position = entrance.Position
	s.Tick(1)
	finishDeparture(t, s, p)

	for p.ship.TransitTime > 0 {
		s.Tick(1)
	}

	exit := entrance.Connected
	s.Disconnect(socket)
	// Let the unoccupied gates finish opening and close while the pilot is away.
	s.World.Tick += 10000
	s.updateGates(60)

	if entrance.Opening != 0 || exit.Opening != 0 {
		t.Fatal("unoccupied gates did not close")
	}

	s.Receive(protocol.Control{Type: "hello", PlayerToken: p.profile.ID}, socket)
	defer s.useSector(p.sectorID)()
	socket.frames = nil
	s.preparePassages()

	if exit.Opening != 0 || exit.OpeningTarget != 1 || entrance.Opening != 0 || entrance.OpeningTarget != 0 {
		t.Fatal("reconnect recovery must open only the gate containing the ship")
	}

	expected, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Channel: 0, Sender: exit.Name, SenderRole: "friendly"}, catalog.Protocol)

	if err != nil || len(socket.frames) != 1 || !bytes.HasPrefix(socket.frames[0], expected[:len(expected)-1]) || len(socket.frames[0]) <= len(expected) {
		t.Fatal("reconnected pilot did not receive the recovery message")
	}

	s.updateGates(catalog.Simulation.SimulationStep)

	if exit.Opening <= 0 || exit.Opening >= 1 || entrance.Opening != 0 || entrance.OpeningTarget != 0 {
		t.Fatal("local recovery animation changed the remote gate")
	}
}

func TestJumpGateCallsign(t *testing.T) {
	for _, position := range []struct {
		position Vec.Vector
		callsign string
	}{
		{Vec.Create(-5348, -52877), "PA-87"},
		{Vec.Create(5340, 52870), "PA-00"},
		{Vec.Create(-5347.6, -52876.6), "PA-87"},
	} {
		t.Run(position.callsign+fmt.Sprint(position.position), func(t *testing.T) {
			catalog, _ := specs.Load()
			s := NewGameSession(25, catalog)
			start := s.currentSector
			var link simulation.SectorLink
			var end int

			for _, candidate := range s.sectorMap.Links {
				if index := slices.Index(candidate.Sectors[:], start); index >= 0 {
					link, end = candidate, 1-index
					break
				}
			}

			for i := range s.sectorMap.Sectors {
				sector := &s.sectorMap.Sectors[i]

				if sector.ID == start {
					sector.Name = "Acamas"
				} else if sector.ID == link.Sectors[end] {
					sector.Name = "Patroclus"
					sector.GateSites[link.Sites[end]].Position = position.position
				}
			}

			s.activateSector(link.Sectors[end])

			for _, gate := range s.sectors[s.currentSector].passages {
				if gate.ConnectionID == link.ID && gate.Kind == "jumpGate" {
					if gate.Name != position.callsign || gate.TargetLabel != "JUMP GATE\nPatroclus\u2009→\u2009Acamas" {
						t.Fatalf("gate callsign=%q label=%q", gate.Name, gate.TargetLabel)
					}

					return
				}
			}

			t.Fatal("destination gate missing")
		})
	}
}
