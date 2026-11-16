package marauder

import (
	"encoding/json"
	"math"
	"slices"

	ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type dispatch struct {
	CheckAt uint64
	Seen    map[string]bool
}

type state struct {
	Destination Vec.Vector
	Search      ai.Search
	Visited     bool
	TargetID    int64
	CombatAt    uint64
	State       string
}

type marauder struct {
	state
	ship    *objects.Ship
	pilot   ai.Pilot
	input   protocol.Input
	thinkAt uint64
}

type Manager struct {
	World       *simulation.World
	Environment ai.Environment
	// Only pirates and collectors are supplied here; marauders do not fight each other.
	OtherShips func(func(*objects.Ship))
	Marauders  []*marauder
	dispatch
}

func New(environment ai.Environment) *Manager {
	world := environment.World()

	return &Manager{World: world, Environment: environment, dispatch: dispatch{
		CheckAt: utilities.NextTick(utilities.TickTimerOptions{Tick: world.Tick, Step: world.Specification.Simulation.SimulationStep, Interval: world.Specification.MarauderSpec.CheckInterval}),
	}}
}

func (m *Manager) active(p ai.Player) bool {
	ship := p.Ship()
	return p.Connected() && m.World.Players.Has(p.ObserverID()) && m.World.Entities.Has(ship.ID) && !ship.Dead && ship.DockedTo == nil && ship.TransitTime == 0
}

/*
Each sector samples human players on its own clock. An account seen outside
on consecutive pings spawns another marauder on every subsequent ping.
Positions are captured at the spawning ping, not at the earlier observation.
*/
func (m *Manager) Dispatch() {
	rules := m.World.Specification.MarauderSpec

	if !utilities.TickDue(&m.CheckAt, utilities.TickTimerOptions{Tick: m.World.Tick, Step: m.World.Specification.Simulation.SimulationStep, Interval: rules.CheckInterval}) {
		return
	}

	seen := make(map[string]bool)

	m.Environment.Players(func(p ai.Player) {
		if !m.active(p) || Vec.LengthSquared(p.Ship().Position) <= rules.MinimumDistance*rules.MinimumDistance {
			return
		}

		seen[p.AccountID()] = true

		if m.Seen[p.AccountID()] {
			m.spawn(p.Ship().Position)
		}
	})

	m.Seen = seen
}

func (m *Manager) spawn(destination Vec.Vector) *marauder {
	rules := m.World.Specification.MarauderSpec
	position := Vec.AddScaled(destination, Vec.Normalize(destination), rules.SpawnDistance)
	heading := math.Atan2(destination.Y-position.Y, destination.X-position.X)
	npc := &marauder{state: state{Destination: destination, Search: ai.Search{Origin: destination, Heading: heading}, State: "Pursuing"}}

	npc.ship = ai.Spawn(m.Environment, ai.SpawnOptions{
		DefinitionID: rules.Ship, Name: "Marauder", Position: &position, Rotation: heading, Hostile: true,
		Configure: func(ship *objects.Ship) {
			for range 2 {
				ship.Fit(modules.Create("cannonSm", simulation.ObjectProperties{World: m.World}, m.World.Specification), nil)
				ammoID := simulation.EntityID(m.World)
				ammo := objects.NewItem("autogunAmmo", simulation.ObjectProperties{World: m.World, ID: &ammoID}, m.World.Specification)
				ship.CargoContents = append(ship.CargoContents, ammo)
			}
		},
	})

	npc.ship.SuppressDrops = true
	npc.ship.NPCState = npc.State
	npc.ship.SetModuleActive("flightMode", true)

	m.Marauders = append(m.Marauders, npc)
	return npc
}

/*
Target acquisition uses ordinary sight and keeps a visible target until lost.
Humans alone govern dispatch and despawning; NPCs are combat targets only.
*/
func (m *Manager) target(npc *marauder) *objects.Ship {
	var nearest, current *objects.Ship
	distance := math.Inf(1)

	visit := func(ship *objects.Ship) {
		if !ai.CanSee(npc.ship, ship) {
			return
		}

		if ship.ID == npc.TargetID {
			current = ship
		}

		d := Vec.DistanceSquared(npc.ship.Position, ship.Position)

		if d < distance || d == distance && nearest != nil && ship.ID < nearest.ID {
			nearest, distance = ship, d
		}
	}

	m.Environment.Players(func(p ai.Player) {
		if m.active(p) {
			visit(p.Ship())
		}
	})

	if m.OtherShips != nil {
		m.OtherShips(visit)
	}

	if current != nil {
		return current
	}

	return nearest
}

func (m *Manager) nearbyPlayer(ship *objects.Ship) bool {
	found := false
	radius := m.World.Specification.MarauderSpec.DespawnDistance

	m.Environment.Players(func(p ai.Player) {
		if m.active(p) && Vec.DistanceSquared(ship.Position, p.Ship().Position) <= radius*radius {
			found = true
		}
	})

	return found
}

func (m *Manager) Update() {
	rules := m.World.Specification.MarauderSpec

	m.Marauders = slices.DeleteFunc(m.Marauders, func(npc *marauder) bool {
		ship := npc.ship

		if !npc.Visited && Vec.DistanceSquared(ship.Position, npc.Destination) <= rules.ArrivalDistance*rules.ArrivalDistance {
			npc.Visited = true
			npc.thinkAt = 0
		}

		if ship.Dead || !m.World.Entities.Has(ship.ID) || ship.DockedTo != nil || (npc.Visited || ship.Stranded()) && !m.nearbyPlayer(ship) {
			ai.Remove(m.Environment, ship)
			return true
		}

		if utilities.TickDue(&npc.thinkAt, utilities.TickTimerOptions{Tick: m.World.Tick, Step: m.World.Specification.Simulation.SimulationStep, Interval: m.World.Specification.NPCMovement.DecisionInterval}) {
			npc.input = m.inputFor(npc)
			ship.NPCState = npc.State
		}

		m.Environment.SetInput(*ship.PlayerID, npc.input)
		return false
	})
}

func (m *Manager) inputFor(npc *marauder) protocol.Input {
	ship, rules := npc.ship, m.World.Specification.MarauderSpec
	target := m.target(npc)
	input := protocol.Input{FlightMode: true}

	if target != nil {
		if target.ID != npc.TargetID {
			npc.CombatAt = 0
		}

		npc.TargetID = target.ID
		npc.Search.Origin = target.Position
		distance := Vec.Distance(ship.Position, target.Position)

		if npc.CombatAt == 0 && distance <= rules.CombatDistance {
			npc.CombatAt = utilities.NextTick(utilities.TickTimerOptions{Tick: m.World.Tick, Step: m.World.Specification.Simulation.SimulationStep, Interval: rules.CombatDelay})
		}

		if npc.CombatAt != 0 {
			if m.World.Tick < npc.CombatAt {
				npc.State = "Preparing"
				return input
			}

			npc.State = "Fighting"
			input.FlightMode = false
			input.AutogunActive, input.LaserActive, input.PlasmaActive = true, true, true
			input.TargetID = &target.ID

			input.Thrust, input.Turn, input.Fire = npc.pilot.Attack(ship, target, ai.AttackOptions{
				PassDistance: rules.PassDistance, AimTolerance: rules.AimTolerance,
				CanFire: distance <= rules.FiringDistance,
			})

			return input
		}

		npc.State = "Pursuing"

		input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: target.Position, Velocity: target.Velocity, PassDistance: rules.PassDistance, TargetID: target.ID})
		return input
	}

	if npc.TargetID != 0 {
		npc.Search = ai.Search{Origin: npc.Search.Origin, Heading: ship.Rotation}
	}

	npc.TargetID, npc.CombatAt = 0, 0

	if !npc.Visited {
		npc.State = "Pursuing"
		input.Thrust, input.Turn = npc.pilot.Steer(ship, ai.Movement{Position: npc.Destination})
	} else {
		npc.State = "Search"
		input.Thrust, input.Turn = npc.pilot.Search(ship, &npc.Search)
	}

	return input
}

func (m *Manager) ForEachShip(visit func(*objects.Ship)) {
	for _, npc := range m.Marauders {
		visit(npc.ship)
	}
}

func (m *Manager) Capture() []persistence.NPC {
	var result []persistence.NPC

	for _, npc := range m.Marauders {
		if npc.ship.Dead || !m.World.Entities.Has(npc.ship.ID) {
			continue
		}

		data, _ := json.Marshal(npc.state)
		result = append(result, persistence.NPC{Kind: "marauder", ID: npc.ship.ID, State: data})
	}

	return result
}

func (m *Manager) Restore(ship *objects.Ship, data json.RawMessage) error {
	npc := &marauder{ship: ship}

	if err := json.Unmarshal(data, &npc.state); err != nil {
		return err
	}

	ship.Hostile = true
	ship.SuppressDrops = true
	ship.NPCState = npc.State
	m.Marauders = append(m.Marauders, npc)
	ai.Observe(m.Environment, ship, nil)
	return nil
}

func (m *Manager) CaptureDispatch() json.RawMessage {
	data, _ := json.Marshal(m.dispatch)
	return data
}

func (m *Manager) RestoreDispatch(data json.RawMessage) error {
	if len(data) == 0 {
		return nil
	}

	return json.Unmarshal(data, &m.dispatch)
}
