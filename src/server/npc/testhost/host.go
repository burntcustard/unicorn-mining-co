// Package testhost exercises controllers against the ordinary world and physics.
package testhost

import (
	"fmt"
	"math"

	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/regions"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type Human struct {
	Craft    *objects.Ship
	ID       int64
	Account  string
	Online   bool
	Cooldown uint64
	Input    protocol.Input
	Controls []protocol.ServerControl
	Credits  float64
}

func (p *Human) AccountID() string { return p.Account }

func (p *Human) ObserverID() int64 { return p.ID }

func (p *Human) Ship() *objects.Ship { return p.Craft }

func (p *Human) Connected() bool { return p.Online }

func (p *Human) EncounterAfter() uint64 { return p.Cooldown }

func (p *Human) SetEncounterAfter(tick uint64) { p.Cooldown = tick }

type Host struct {
	Simulation *simulation.World
	Regions    *regions.Manager
	Humans     []*Human
	Inputs     map[int64]protocol.InputFrame
	Controls   []protocol.ServerControl
	NextID     int64
	Dispatch   func()
	Before     func()
	After      func([]protocol.SimulationEvent)
	syncedAt   uint64
}

func New(seed float64, catalog specs.Catalog) *Host {
	sectors := simulation.GenerateSectorMap(uint32(seed), catalog)
	var sector simulation.Sector

	for _, candidate := range sectors.Sectors {
		if candidate.ID == catalog.StartingSectorID {
			sector = candidate
			break
		}
	}

	world := simulation.CreateWorld(float64(sector.Seed), catalog)
	world.NextEntityID = 1 << 48
	world.ItemTypes = objects.ItemTypes(catalog)
	world.Collisions = gameplay.NewGameCollisions(catalog)
	return &Host{Simulation: world, Regions: regions.New(uint32(seed), catalog, sector), Inputs: map[int64]protocol.InputFrame{}, NextID: 1}
}

func (h *Host) World() *simulation.World { return h.Simulation }

func (h *Host) NextObserverID() int64 { id := h.NextID; h.NextID++; return id }

func (h *Host) Players(visit func(ai.Player)) {
	for _, p := range h.Humans {
		visit(p)
	}
}

func (h *Host) AllPlayers(visit func(ai.Player)) { h.Players(visit) }

func (h *Host) Player(account string) ai.Player {
	for _, p := range h.Humans {
		if p.Account == account {
			return p
		}
	}

	return nil
}

func (h *Host) Entity(id int64) simulation.Entity {
	if entity, ok := h.Simulation.Entities.Get(id); ok {
		return entity
	}

	entity, _ := h.Regions.Sleeping.Get(id)
	return entity
}

func (h *Host) Sleeping(visit func(simulation.Entity, int64)) { h.Regions.Sleeping.ForEach(visit) }

func (h *Host) Positions() []Vec.Vector {
	var positions []Vec.Vector

	for _, p := range h.Humans {
		if h.Simulation.Players.Has(p.ID) || h.Simulation.Entities.Has(p.Craft.ID) {
			positions = append(positions, p.Craft.Position)
		}
	}

	return positions
}

func (h *Host) SyncRegions() { h.Regions.Sync(h.Simulation, h.Positions()) }

func (h *Host) Stations(position Vec.Vector, ranges *protocol.WorldRanges) []protocol.StationDescription {
	return h.Regions.View(position, ranges).StationMarkers
}

func (h *Host) StationID(home protocol.StationDescription) int64 {
	return h.Regions.IDOffset + int64(home.ID)
}

func (h *Host) NearestStation(position Vec.Vector) protocol.StationDescription {
	return h.Regions.NearestStation(position)
}

func (h *Host) SetInput(id int64, input protocol.Input) {
	h.Inputs[id] = protocol.InputFrame{Input: input}
}

func (h *Host) ClearInput(id int64) { delete(h.Inputs, id) }

func (h *Host) Broadcast(message protocol.ServerControl) {
	h.Controls = append(h.Controls, message)

	h.Players(func(p ai.Player) {
		if p.Connected() && h.Simulation.Players.Has(p.ObserverID()) {
			h.Send(p, message)
		}
	})
}

func (h *Host) Send(player ai.Player, message protocol.ServerControl) {
	if p, ok := player.(*Human); ok && p.Online {
		p.Controls = append(p.Controls, message)
	}
}

func (h *Host) AddPlayer() *Human {
	id := h.NextObserverID()
	home := h.NearestStation(Vec.Vector{})
	sin, cos := math.Sincos(float64(id) * 2.4)
	position := Vec.AddScaled(home.Position, Vec.Create(cos, sin), home.Radius+250)
	position.X, position.Y = utilities.RoundTiesUp(position.X), utilities.RoundTiesUp(position.Y)
	ship := objects.CreatePlayerShip(h.Simulation, objects.Properties{PlayerID: &id, Position: position})
	p := &Human{Craft: ship, ID: id, Account: fmt.Sprint(id), Online: true, Credits: h.Simulation.Specification.StartingCredits}
	h.Humans = append(h.Humans, p)
	simulation.AddEntity(h.Simulation, ship)
	simulation.AddPlayer(h.Simulation, simulation.Player{ID: id, ShipID: ship.ID, Credits: &p.Credits})
	h.SyncRegions()
	return p
}

func (h *Host) Tick(ticks uint64) {
	if h.Dispatch != nil {
		h.Dispatch()
	}

	clear(h.Inputs)

	for _, p := range h.Humans {
		if p.Online && h.Simulation.Players.Has(p.ID) {
			h.SetInput(p.ID, p.Input)
		}
	}

	if h.Simulation.Tick-h.syncedAt >= 8 {
		h.SyncRegions()
		h.syncedAt = h.Simulation.Tick
	}

	positions := h.Positions()

	h.Simulation.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		object := entity.Base()

		if object.Kind != "station" {
			return
		}

		object.InactivePhysics = true

		for _, position := range positions {
			if Vec.DistanceSquared(position, object.Position) <= 2000*2000 {
				object.InactivePhysics = false
				return
			}
		}

		h.Simulation.Players.ForEach(func(player simulation.Player, _ int64) {
			if player.ObserverRange <= 0 {
				return
			}

			if ship, ok := h.Simulation.Entities.Get(player.ShipID); ok && !ship.Base().Dead && Vec.DistanceSquared(ship.Base().Position, object.Position) <= player.ObserverRange*player.ObserverRange {
				object.InactivePhysics = false
			}
		})
	})

	if h.Before != nil {
		h.Before()
	}

	dt := float64(ticks) * h.Simulation.Specification.Simulation.SimulationStep
	events := simulation.UpdateWorld(h.Simulation, simulation.UpdateWorldOptions{Inputs: h.Inputs, DT: &dt, Ticks: int(ticks)})

	if h.After != nil {
		h.After(events)
	}
}
