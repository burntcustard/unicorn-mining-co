// Port of src/server/game-session.ts. All methods run on the world owner.
package server

import (
	"crypto/rand"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/internal/collision/game"
	"github.com/burntcustard/unicorn-mining-co/internal/craft"
	"github.com/burntcustard/unicorn-mining-co/internal/craft/ships"
	"github.com/burntcustard/unicorn-mining-co/internal/items"
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	"github.com/burntcustard/unicorn-mining-co/internal/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
	"time"
)

type SessionSocket interface {
	IsOpen() bool
	BufferedBytes() int
	// SendBinary must consume or copy the packet before returning.
	SendBinary([]byte) error
	Terminate()
	CloseWith(uint16, string)
}
type pendingSnapshot struct {
	sequence uint64
	tick     int64
}

type queuedInputs struct {
	tick    uint64
	changes []protocol.Control
}

type playerRecord struct {
	snapshotSequence  uint64
	pendingSnapshots  []pendingSnapshot
	snapshotWindow    int
	needsLoad         bool
	inputLead         int64
	hasInputLead      bool
	inputs            []queuedInputs
	frame             protocol.InputFrame
	lastInput         protocol.Input
	lastSequence      uint64
	lastInputAt       time.Time
	hiddenShip        bool
	playerID          int64
	binaryReplication *BinaryReplicationManager
	ship              *craft.Ship
	shipID            int64
	socket            SessionSocket
	disconnectedAt    *time.Time
	token             string
}

func (p *playerRecord) clearInputs() {
	for i := range p.inputs {
		p.inputs[i].changes = p.inputs[i].changes[:0]
	}
}

type GameSession struct {
	World           *simulation.World
	nextPlayerID    int64
	players         *utilities.OrderedMap[string, *playerRecord]
	playersBySocket map[SessionSocket]*playerRecord
	inputs          map[int64]protocol.InputFrame
	binaryBatch     *BinarySnapshotBatch
	replicationView *ReplicationView
	regions         *RegionManager
	regionsSyncedAt float64
	worldSeed       float64
	now             func() time.Time
	token           func() string
}

func NewGameSession(seed float64, catalog specification.Catalog) *GameSession {
	world := simulation.CreateWorld(seed, catalog)
	world.ItemTypes = items.Types(catalog)
	world.Collisions = game.NewGameCollisions(catalog)
	return &GameSession{World: world, nextPlayerID: 1, players: utilities.NewOrderedMap[string, *playerRecord](), playersBySocket: map[SessionSocket]*playerRecord{}, inputs: map[int64]protocol.InputFrame{}, replicationView: NewReplicationView(world), binaryBatch: NewBinarySnapshotBatch(catalog), regions: NewRegionManager(uint32(seed), catalog), regionsSyncedAt: math.Inf(-1), worldSeed: seed, now: time.Now, token: sessionToken}
}
func sessionToken() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func send(socket SessionSocket, packet []byte) {
	if !socket.IsOpen() {
		return
	}
	if socket.BufferedBytes() > MaxSocketBuffer {
		socket.Terminate()
		return
	}
	if err := socket.SendBinary(packet); err != nil {
		socket.Terminate()
	}
}
func (s *GameSession) nearestStation(position Vec.Vector) protocol.StationDescription {
	ranges := protocol.Ranges(s.World.Specification.Simulation.WorldRanges)
	stations := s.regions.View(position, nil).StationMarkers
	for len(stations) == 0 {
		ranges.StationMarker *= 2
		stations = s.regions.View(position, &ranges).StationMarkers
	}
	closest := stations[0]
	for _, station := range stations[1:] {
		if Vec.Distance(station.Position, position) < Vec.Distance(closest.Position, position) {
			closest = station
		}
	}
	return closest
}
func (s *GameSession) Receive(message protocol.Control, socket SessionSocket) {
	if message.Type == "hello" {
		s.hello(socket, message.PlayerToken)
		return
	}
	player := s.playersBySocket[socket]
	if player == nil {
		return
	}
	if message.Type == "snapshotAck" {
		for i, snapshot := range player.pendingSnapshots {
			if snapshot.sequence == message.Sequence {
				if snapshot.tick >= 0 {
					player.snapshotWindow = 2
					if int64(s.World.Tick)-snapshot.tick <= 8 {
						player.snapshotWindow = 9
					}
				}
				player.pendingSnapshots = player.pendingSnapshots[i+1:]
				break
			}
		}
		return
	}
	player.lastInputAt = s.now()
	switch message.Type {
	case "input":
		s.input(message, player)
	case "respawn":
		s.respawn(player)
	case "dock":
		s.dock(message, player)
	}
}
func (s *GameSession) Disconnect(socket SessionSocket) {
	player := s.playersBySocket[socket]
	if player == nil {
		return
	}
	delete(s.playersBySocket, socket)
	player.socket = nil
	player.binaryReplication = NewBinaryReplicationManager(s.World.Specification)
	now := s.now()
	player.disconnectedAt = &now
	player.hiddenShip = s.World.Entities.Has(player.shipID)
	s.World.Entities.Delete(player.shipID)
	s.World.Players.Delete(player.playerID)
	ship := player.ship
	ship.LocalMovementParent = nil
	ship.LocalMovementRate = 0
	ship.Velocity = Vec.Vector{}
	ship.Spin = 0
	ship.Fly(0, 0)
	player.lastInput = protocol.Input{}
	player.clearInputs()
	roundSpawn(ship)
}
func roundSpawn(ship *craft.Ship) {
	ship.Position.X = utilities.RoundTiesUp(ship.Position.X)
	ship.Position.Y = utilities.RoundTiesUp(ship.Position.Y)
}
func (s *GameSession) positions() []Vec.Vector {
	positions := []Vec.Vector{}
	s.players.ForEach(func(p *playerRecord, _ string) {
		if p.socket != nil {
			positions = append(positions, p.ship.Position)
		}
	})
	return positions
}
func (s *GameSession) Tick(ticks uint64) {
	if ticks == 0 {
		ticks = 1
	}
	world := s.World
	if world.Tick%30 == 0 || world.Tick%30+ticks > 30 {
		idleBefore := s.now().Add(-5 * time.Minute)
		s.players.ForEach(func(p *playerRecord, _ string) {
			if p.socket == nil {
				return
			}
			if p.lastInput.Thrust != 0 || p.lastInput.Turn != 0 {
				p.lastInputAt = s.now()
			}
			if p.lastInputAt.After(idleBefore) {
				return
			}
			socket := p.socket
			s.Disconnect(socket)
			socket.CloseWith(4002, "Idle timeout")
		})
	}
	if world.Tick%900 == 0 || world.Tick%900+ticks > 900 {
		expired := s.now().Add(-30 * time.Minute)
		s.players.ForEach(func(p *playerRecord, token string) {
			if p.disconnectedAt == nil || p.disconnectedAt.After(expired) {
				return
			}
			s.players.Delete(token)
			world.Players.Delete(p.playerID)
			world.Entities.Delete(p.shipID)
		})
	}
	if float64(world.Tick)-s.regionsSyncedAt >= 8 {
		s.regions.Sync(world, s.positions())
		s.regionsSyncedAt = float64(world.Tick)
	}
	// Visibility and physics activation are independent. Marker entities remain
	// available to replication while distant bodies have no collision proxies.
	positions := s.positions()
	world.Entities.ForEach(func(e simulation.Entity, _ int64) {
		object := e.Base()
		if object.Kind != "station" {
			return
		}
		object.InactivePhysics = true
		for _, position := range positions {
			if Vec.DistanceSquared(object.Position, position) <= 2000*2000 {
				object.InactivePhysics = false
				break
			}
		}
	})
	tick := world.Tick
	clear(s.inputs)
	step := world.Specification.Simulation.SimulationStep
	s.players.ForEach(func(p *playerRecord, _ string) {
		if p.socket == nil {
			return
		}
		p.frame.Input = p.lastInput
		p.frame.Changes = p.frame.Changes[:0]
		for i := uint64(0); i < ticks; i++ {
			slot := &p.inputs[(tick+i)%uint64(len(p.inputs))]
			if slot.tick != tick+i {
				continue
			}
			for _, change := range slot.changes {
				if change.Sequence <= p.lastSequence {
					continue
				}
				last := 0.0
				if len(p.frame.Changes) > 0 {
					last = p.frame.Changes[len(p.frame.Changes)-1].Offset
				}
				offset := math.Max(last, float64(i)*step+math.Min(step-1e-9, math.Max(0, change.Offset)))
				p.frame.Changes = append(p.frame.Changes, protocol.InputChange{Input: change.Input, Offset: offset})
				p.lastInput = change.Input
				p.lastSequence = change.Sequence
			}
			slot.changes = slot.changes[:0]
		}
		s.inputs[p.playerID] = p.frame
	})
	dt := float64(ticks) * step
	simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Inputs: s.inputs, DT: &dt, Ticks: int(ticks)})
	// Send the completed simulation state once, including after a catch-up batch.
	view := s.replicationView.Reset()
	batch := s.binaryBatch.Begin(view)
	s.players.ForEach(func(p *playerRecord, _ string) { s.sendSnapshot(p, view, batch) })
}
func (s *GameSession) sendSnapshot(p *playerRecord, view *ReplicationView, batch *BinarySnapshotBatch) {
	socket := p.socket
	if socket == nil || !socket.IsOpen() {
		return
	}
	if socket.BufferedBytes() > MaxSocketBuffer {
		socket.Terminate()
		return
	}
	// Match the adaptive TypeScript window, including slow-link backpressure.
	if socket.BufferedBytes() > MaxSnapshotBuffer || len(p.pendingSnapshots) >= p.snapshotWindow {
		return
	}
	p.snapshotSequence++
	sequence := p.snapshotSequence
	var inputLead *int64
	if p.hasInputLead {
		inputLead = &p.inputLead
	}
	options := SnapshotOptions{World: s.World, ShipID: p.shipID, Position: p.ship.Position, AcknowledgedSequence: &p.lastSequence, InputLead: inputLead, SnapshotSequence: &p.snapshotSequence, ReplicationView: view, BinaryBatch: batch}
	packet := p.binaryReplication.encode(options, p.needsLoad)
	tick := int64(s.World.Tick)
	if p.needsLoad {
		tick = -1
	}
	p.needsLoad = false
	p.hasInputLead = false
	p.pendingSnapshots = append(p.pendingSnapshots, pendingSnapshot{sequence: sequence, tick: tick})
	send(socket, packet)
}
func (s *GameSession) sendControl(socket SessionSocket, message protocol.ServerControl) {
	packet, err := protocol.EncodeServerControl(message, s.World.Specification.Protocol)
	if err != nil {
		panic(err)
	}
	send(socket, packet)
}
func (s *GameSession) hello(socket SessionSocket, token string) {
	p, _ := s.players.Get(token)
	if p == nil {
		token = s.token()
		id := s.nextPlayerID
		s.nextPlayerID++
		station := s.nearestStation(Vec.Vector{})
		angle := float64(id) * 2.4
		sin, cos := math.Sincos(angle)
		spawn := Vec.AddScaled(station.Position, Vec.Vector{X: cos, Y: sin}, station.Radius+250)
		spawn.X = utilities.RoundTiesUp(spawn.X)
		spawn.Y = utilities.RoundTiesUp(spawn.Y)
		ship := ships.CreateShip(s.World, craft.Properties{PlayerID: &id, Position: spawn})
		simulation.AddEntity(s.World, ship)
		simulation.AddPlayer(s.World, simulation.Player{ID: id, ShipID: ship.ID})
		// Every allowed future tick has its own slot; consumed slots reuse storage.
		p = &playerRecord{needsLoad: true, inputs: make([]queuedInputs, s.World.Specification.Simulation.MaxPredictionTicks+1), lastInputAt: s.now(), playerID: id, binaryReplication: NewBinaryReplicationManager(s.World.Specification), ship: ship.Ship, shipID: ship.ID, token: token}
		s.players.Set(token, p)
	}
	if p.socket != nil {
		delete(s.playersBySocket, p.socket)
		p.socket.CloseWith(4001, "Session opened elsewhere")
	}
	if p.hiddenShip {
		simulation.AddEntity(s.World, p.ship.Self)
		p.hiddenShip = false
	}
	simulation.AddPlayer(s.World, simulation.Player{ID: p.playerID, ShipID: p.shipID})
	p.socket = socket
	s.playersBySocket[socket] = p
	p.snapshotSequence = 0
	p.pendingSnapshots = nil
	p.snapshotWindow = 2
	p.needsLoad = true
	p.lastInputAt = s.now()
	p.disconnectedAt = nil
	p.clearInputs()
	p.lastInput = protocol.Input{}
	p.lastSequence = 0
	p.hasInputLead = false
	roundSpawn(p.ship)
	s.regions.Sync(s.World, s.positions())
	s.sendControl(socket, protocol.ServerControl{Type: "welcome", PlayerID: uint64(p.playerID), ShipID: uint64(p.shipID), ServerTick: s.World.Tick, PlayerToken: p.token, WorldSeed: s.worldSeed, Spawn: specification.Vector{X: p.ship.Position.X, Y: p.ship.Position.Y}})
	s.sendSnapshot(p, nil, nil)
}
func (s *GameSession) respawn(p *playerRecord) {
	if s.World.Entities.Has(p.shipID) {
		return
	}
	nearest := s.nearestStation(p.ship.Position)
	s.regions.Sync(s.World, append(s.positions(), nearest.Position))
	station, ok := s.World.Entities.Get(int64(nearest.ID))
	if !ok || station.Base().Kind != "station" {
		return
	}
	ship := ships.CreateShip(s.World, craft.Properties{PlayerID: &p.playerID, Position: station.Base().Position, Rotation: station.Base().Rotation})
	ship.Credits = p.ship.Credits
	id := station.Base().ID
	ship.DockedTo = &id
	simulation.AddEntity(s.World, ship)
	simulation.AddPlayer(s.World, simulation.Player{ID: p.playerID, ShipID: ship.ID})
	p.ship = ship.Ship
	p.shipID = ship.ID
	p.clearInputs()
	p.lastInput = protocol.Input{}
	p.hasInputLead = false
	if p.socket == nil {
		return
	}
	s.sendControl(p.socket, protocol.ServerControl{Type: "respawn", ShipID: uint64(ship.ID)})
	p.needsLoad = true
	s.sendSnapshot(p, nil, nil)
}
func (s *GameSession) input(message protocol.Control, p *playerRecord) {
	lead := int64(message.Tick) - int64(s.World.Tick)
	p.inputLead = lead
	p.hasInputLead = true
	if lead < 0 || lead > int64(s.World.Specification.Simulation.MaxPredictionTicks) {
		if message.Sequence > p.lastSequence {
			p.lastInput = message.Input
			p.lastSequence = message.Sequence
		}
		return
	}
	slot := &p.inputs[message.Tick%uint64(len(p.inputs))]
	if slot.tick != message.Tick {
		slot.tick = message.Tick
		slot.changes = slot.changes[:0]
	}
	last := p.lastSequence
	if len(slot.changes) > 0 {
		last = slot.changes[len(slot.changes)-1].Sequence
	}
	if message.Sequence > last {
		slot.changes = append(slot.changes, message)
	}
}
func (s *GameSession) dock(message protocol.Control, p *playerRecord) {
	entity, ok := s.World.Entities.Get(p.shipID)
	if !ok {
		return
	}
	ship, ok := entity.(interface{ ShipBase() *craft.Ship })
	if !ok || ship.ShipBase().DockedTo == nil {
		return
	}
	if _, ok := ship.ShipBase().ApplyDockAction(message.Dock); ok {
		s.sendSnapshot(p, nil, nil)
	}
}
