package network

import (
	"context"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
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

	if gate.OpeningTarget != 0 {
		t.Fatal("access request bypassed the new gate's minimum closed-state hold")
	}

	s.updateGatePairs(gate.Spec.StateHoldDuration / 1000)

	if gate.OpeningTarget != 1 {
		t.Fatal("nearby access refused")
	}

	s.updateGatePairs(gate.Spec.OpeningDuration / 1000)

	if gate.Connected == nil || gate.Connected.Opening != 1 || gate.Opening != 1 {
		t.Fatal("gate did not finish opening")
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

	if portal.Opening != 1 {
		t.Fatal("restart did not reopen the arrival gate")
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

func TestLinkedGateMotionAndRemoteOccupancy(t *testing.T) {
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
	s.updateGatePairs(gate.Spec.StateHoldDuration / 1000)
	s.updateGatePairs(gate.Spec.OpeningDuration / 2000)

	if gate.Opening != .5 || exit.Opening != .5 {
		t.Fatal("linked gates did not advance exactly once together")
	}

	s.updateGatePairs(gate.Spec.OpeningDuration / 2000)
	s.updateGatePairs(gate.Spec.StateHoldDuration / 1000)

	if gate.Opening != 1 || exit.Opening != 1 || gate.OpeningTarget != 1 {
		t.Fatal("remote ship did not hold both gates open")
	}

	p.ship.Position = Vec.Add(exit.Position, Vec.Create(0, exit.Radius+1))
	s.updateGatePairs(catalog.Simulation.SimulationStep)

	if gate.OpeningTarget != 0 || gate.Opening >= 1 || exit.Opening != gate.Opening {
		t.Fatal("both gates must begin closing on the first unoccupied tick")
	}

	s.updateGatePairs(gate.Spec.ClosingDuration / 1000)

	if gate.Opening != 0 || exit.Opening != 0 {
		t.Fatal("gates did not close together")
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
