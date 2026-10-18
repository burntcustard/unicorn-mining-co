package network

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"strings"
)

type sectorRuntime struct {
	world    *simulation.World
	regions  *RegionManager
	view     *ReplicationView
	batch    *BinarySnapshotBatch
	syncedAt float64
	passages []*objects.Passage
	closing  map[*objects.Passage]bool
}

func (s *GameSession) sectorPlayers(visit func(*playerRecord, string)) {
	s.players.ForEach(func(p *playerRecord, token string) {
		if p.sectorID == s.currentSector {
			visit(p, token)
		}
	})
}

func (s *GameSession) useSector(id string) func() {
	previous := s.currentSector
	s.activateSector(id)

	return func() { s.activateSector(previous) }
}

func (s *GameSession) activateSector(id string) {
	s.nextEntityID = max(s.nextEntityID, s.World.NextEntityID)

	if id == "" {
		id = s.World.Specification.StartingSectorID
	}

	if current := s.sectors[s.currentSector]; current != nil {
		current.syncedAt = s.regionsSyncedAt
	}

	runtime := s.sectors[id]

	if runtime == nil {
		catalog := s.World.Specification

		index := slices.IndexFunc(s.sectorMap.Sectors, func(sector simulation.Sector) bool { return sector.ID == id })

		if index < 0 {
			panic("Unknown sector: " + id)
		}

		sector := &s.sectorMap.Sectors[index]
		world := simulation.CreateWorld(float64(sector.Seed), catalog)
		world.Tick = s.World.Tick
		world.ItemTypes = objects.ItemTypes(catalog)
		world.Collisions = gameplay.NewGameCollisions(catalog)
		offset := int64(index+1) << 40

		if id == catalog.StartingSectorID {
			offset = 0
		}

		// Global IDs distinguish persistent objects and ships across isolated worlds.
		world.NextEntityID = s.nextEntityID
		world.NextObjectID = -offset
		regions := NewRegionManager(uint32(s.worldSeed), catalog, *sector)
		regions.idOffset = offset
		runtime = &sectorRuntime{world: world, regions: regions, view: NewReplicationView(world), batch: NewBinarySnapshotBatch(catalog), syncedAt: math.Inf(-1)}
		runtime.closing = make(map[*objects.Passage]bool)
		s.sectors[id] = runtime

		for kind, links := range [][]simulation.SectorLink{s.sectorMap.Links, s.sectorMap.WormholeLinks} {
			for _, link := range links {
				end := slices.Index(link.Sectors[:], id)

				if end < 0 || !slices.Contains(s.sectorMap.Enabled, link.Sectors[1-end]) {
					continue
				}

				destinationIndex := slices.IndexFunc(s.sectorMap.Sectors, func(sector simulation.Sector) bool { return sector.ID == link.Sectors[1-end] })

				destination := s.sectorMap.Sectors[destinationIndex]
				sites := sector.GateSites

				if kind == 1 {
					sites = sector.WormholeSites
				}

				site := sites[link.Sites[end]]

				entity := objects.NewPassage(world, objects.PassageOptions{
					ID: offset + 1<<32 + int64(len(runtime.passages)), Position: site.Position,
					DestinationSector: destination.ID, DestinationName: destination.Name, Wormhole: kind == 1,
				})

				passage := entity.PassageBase()

				passage.ConnectionID = link.ID

				if kind == 0 {
					passage.TargetLabel = "JUMP GATE\n" + sector.Name + "\u2009→\u2009" + destination.Name
					passage.Name = fmt.Sprintf("%s%s-%d%d", sector.Name[:1], destination.Name[:1], int(math.Abs(utilities.RoundTiesUp(site.Position.X)))%10, int(math.Abs(utilities.RoundTiesUp(site.Position.Y)))%10)
					passage.Rotation = link.Rotation

					passage.OnClosing = func() {
						runtime.closing[passage] = true
						s.gateChat(passage, passage.Spec.ClosingMessage)
					}
				}

				runtime.passages = append(runtime.passages, passage)
				simulation.AddEntity(world, entity)
			}
		}

		if s.persistence != nil {
			s.attachSectorPersistence(runtime)
		}
	}

	runtime.world.NextEntityID = max(runtime.world.NextEntityID, s.nextEntityID)
	s.currentSector, s.World, s.regions, s.replicationView, s.binaryBatch, s.regionsSyncedAt = id, runtime.world, runtime.regions, runtime.view, runtime.batch, runtime.syncedAt
}

func (s *GameSession) Tick(ticks uint64) {
	if !s.persistenceReady() {
		return
	}

	if ticks == 0 {
		ticks = 1
	}

	previous := s.currentSector
	s.updateGates(float64(ticks) * s.World.Specification.Simulation.SimulationStep)
	// Take a stable list: travel can lazily instantiate another sector this tick.
	ids := make([]string, 0, len(s.sectors))

	for _, sector := range s.sectorMap.Sectors {
		if s.sectors[sector.ID] != nil {
			ids = append(ids, sector.ID)
		}
	}

	tick := s.World.Tick

	for _, id := range ids {
		s.activateSector(id)
		s.World.Tick = tick
		s.tickSector(ticks)
	}

	for _, runtime := range s.sectors {
		runtime.world.Tick = tick + ticks
	}

	s.activateSector(previous)
}

func (s *GameSession) preparePassages() map[*playerRecord]Vec.Vector {
	before := map[*playerRecord]Vec.Vector{}

	s.sectorPlayers(func(p *playerRecord, _ string) {
		if s.World.Players.Has(p.playerID) {
			before[p] = p.ship.Position

			if p.ship.Dead || p.ship.DockedTo != nil {
				return
			}

			for _, gate := range s.sectors[s.currentSector].passages {
				if gate.Kind != "jumpGate" {
					continue
				}

				if p.ship.TransitGate == gate.ID && p.ship.TransitTime != 0 {
					if p.ship.TransitTime < 0 {
						s.requestDestinationOpening(gate)
					} else {
						gate.RequestExitOpening()
					}
				} else if gate.Opening == 0 && gate.OpeningTarget == 0 && gate.ContainsInterior(p.ship.Position) {
					gate.RequestExitOpening()
					message := protocol.ServerControl{Type: "chat", Channel: 0, Sender: gate.Name, SenderRole: "friendly", Text: strings.ReplaceAll(gate.Spec.RecoveryMessage, "{player}", p.profile.DisplayName)}

					s.sectorPlayers(func(recipient *playerRecord, _ string) {
						if recipient.socket != nil && s.World.Players.Has(recipient.playerID) {
							s.sendControl(recipient.socket, message)
						}
					})
				}
			}
		}
	})

	return before
}

func (s *GameSession) connectedPassage(passage *objects.Passage) *objects.Passage {
	if passage.Connected != nil {
		return passage.Connected
	}

	defer s.useSector(passage.DestinationSector)()

	for _, other := range s.sectors[passage.DestinationSector].passages {
		if other.Kind == passage.Kind && other.ConnectionID == passage.ConnectionID {
			passage.Connect(other)
			return other
		}
	}

	panic("sector connection has no destination passage")
}

func (s *GameSession) requestDestinationOpening(passage *objects.Passage) {
	exit := s.connectedPassage(passage)
	exit.RequestExitOpening()
	// Give the empty destination time to open before its traveler arrives.
	now := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep
	hole := s.World.Specification.HoleSpec
	exit.CloseAfter = max(exit.CloseAfter, now+(hole.PullDuration+hole.TransitScaleDuration+exit.Spec.OpeningDuration)/1000)
}

func (s *GameSession) updateGates(dt float64) {
	now := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep

	for _, runtime := range s.sectors {
		for _, gate := range runtime.passages {
			if gate.Kind != "jumpGate" {
				continue
			}

			occupied := false

			s.players.ForEach(func(p *playerRecord, _ string) {
				if p.ship.World == gate.World && gate.World.Players.Has(p.playerID) && Vec.DistanceSquared(p.ship.Position, gate.Position) < gate.Radius*gate.Radius {
					occupied = true
				}
			})

			if occupied && gate.OpeningTarget == 1 {
				gate.RequestOpening(1)
			}

			if !occupied && now >= gate.CloseAfter {
				gate.RequestOpening(0)
			}

			if gate.Connected != nil {
				gate.Advance(dt)
			}
		}
	}
}

func (s *GameSession) interruptGateClosing(before map[*playerRecord]Vec.Vector) {
	runtime := s.sectors[s.currentSector]
	now := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep

	for _, gate := range runtime.passages {
		closing := gate.OpeningTarget == 0 && (gate.Opening > 0 || runtime.closing[gate])
		reopening := gate.OpeningTarget == 1 && gate.Opening < 1 && gate.BlockedBeams != 0

		if gate.Kind != "jumpGate" || !closing && !reopening {
			delete(runtime.closing, gate)
			continue
		}

		blocked := uint8(0)

		for player, from := range before {
			ship := player.ship

			if ship.World != gate.World || ship.Dead || ship.DockedTo != nil || ship.TransitTime != 0 {
				continue
			}

			blocked |= gate.CrossedBeams(from, ship.Position, ship.Radius)
		}

		if blocked != 0 {
			if reopening {
				gate.BlockedBeams |= blocked
				continue
			}

			gate.InterruptClosing(blocked)
			gate.CloseAfter = max(gate.CloseAfter, now+gate.Spec.OpeningDuration/1000)
			delete(runtime.closing, gate)
			s.gateChat(gate, gate.Spec.ClosingInterruptedMessage)
		} else if gate.Opening == 0 {
			delete(runtime.closing, gate)
		}
	}
}

func (s *GameSession) crossPassages(before map[*playerRecord]Vec.Vector) {
	for p, from := range before {
		if p.ship.Dead || p.ship.DockedTo != nil || p.ship.Launching != 0 || p.travelledTick == s.World.Tick {
			continue
		}

		if p.ship.TransitTime > 0 {
			continue
		}

		if p.ship.TransitTime < 0 {
			if p.ship.TransitTime < -1e-6 {
				continue
			}

			entity, ok := s.World.Entities.Get(p.ship.TransitGate)

			if !ok {
				continue
			}

			passage := entity.(objects.PassageEntity).PassageBase()

			exit := s.connectedPassage(passage)

			if exit.Kind == "jumpGate" {
				player := p.profile.DisplayName

				if player == "" {
					player = "pilot"
				}

				text := strings.NewReplacer("{destination}", passage.DestinationName, "{player}", player).Replace(exit.Spec.ArrivalMessage)
				p.arrivalMessage = &protocol.ServerControl{Type: "chat", Sender: exit.Name, SenderRole: "friendly", Text: text}
			}

			s.relocatePlayer(p, passage.DestinationSector, sectorArrival{
				position: exit.Position,
				portal:   exit.ID,
			})

			continue
		}

		// Stay at the destination until the pilot leaves its trigger; do not bounce back.
		if p.ship.TransitGate != 0 {
			if entity, ok := s.World.Entities.Get(p.ship.TransitGate); ok {
				portal := entity.(objects.PassageEntity).PassageBase()

				if Vec.DistanceSquared(p.ship.Position, portal.Position) <= portal.TravelRadius*portal.TravelRadius {
					continue
				}
			}

			p.ship.TransitGate = 0
			continue
		}

		for _, passage := range s.sectors[s.currentSector].passages {
			if !passage.Crossed(from, p.ship.Position) {
				continue
			}

			// Begin at the crossing point even when a fast step overshoots the hole.
			offset := Vec.Subtract(p.ship.Position, passage.Position)

			if Vec.Length(offset) > passage.TravelRadius {
				p.ship.Position = Vec.AddScaled(passage.Position, Vec.Normalize(Vec.Subtract(from, passage.Position)), passage.TravelRadius)
			}

			p.ship.TransitGate = passage.ID

			if passage.Kind == "jumpGate" {
				s.requestDestinationOpening(passage)
			}

			p.ship.TransitTime = -(s.World.Specification.HoleSpec.PullDuration + s.World.Specification.HoleSpec.TransitScaleDuration) / 1000
			p.ship.Velocity, p.ship.Spin = Vec.Vector{}, 0
			p.ship.Firing = false
			p.ship.Fly(0, 0)
			break
		}
	}
}

type sectorArrival struct {
	position, velocity Vec.Vector
	portal             int64
}

func (s *GameSession) relocatePlayer(p *playerRecord, destination string, arrival sectorArrival) {
	p.gateAccess = nil
	old := p.ship.World
	old.Entities.Delete(p.shipID)
	old.Players.Delete(p.playerID)
	defer s.useSector(destination)()
	p.sectorID = destination
	p.profile.SectorID = destination
	p.travelledTick = old.Tick
	p.ship.Position = arrival.position
	p.ship.Velocity = arrival.velocity
	p.ship.Spin = 0
	p.ship.PendingUpdateTime = 0
	p.ship.LocalMovementParent = nil
	p.ship.LocalMovementRate = 0
	p.ship.World = s.World
	p.ship.Random = s.World.Random

	p.ship.TransitGate = arrival.portal
	p.ship.TransitTime = 0

	if arrival.portal != 0 {
		spec := s.World.Specification.HoleSpec
		p.ship.TransitTime = (spec.TransitScaleDuration + spec.ArrivalHoldDuration) / 1000
		p.ship.Fly(0, 0)
	}

	for _, module := range p.ship.Modules() {
		module.Base().World = s.World
		module.Base().Random = s.World.Random
	}

	for _, item := range p.ship.CargoContents {
		item.Base().World = s.World
		item.Base().Random = s.World.Random
	}

	simulation.AddEntity(s.World, p.ship)
	simulation.AddPlayer(s.World, simulation.Player{ID: p.playerID, ShipID: p.shipID, Credits: &p.profile.Credits})
	p.binaryReplication = NewBinaryReplicationManager(s.World.Specification)
	p.pendingSnapshots = nil
	p.needsLoad = true
	p.welcomePending = true
	p.clearInputs()
	p.lastInput = protocol.Input{}
	s.regions.Sync(s.World, s.positions())
	s.savePlayer(p)
	s.flushChanges()
	s.sendSnapshot(p, nil, nil)
}

func (s *GameSession) sectorForWorld(world *simulation.World) string {
	for id, runtime := range s.sectors {
		if runtime.world == world {
			return id
		}
	}

	return s.World.Specification.StartingSectorID
}
