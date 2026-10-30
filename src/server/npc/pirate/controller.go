package pirate

import (
	"encoding/json"
	"fmt"
	ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"maps"
	"slices"
)

type Manager struct {
	World       *simulation.World
	Environment ai.Environment
	Pirates     []*pirate
	DispatchAt  uint64
}

func New(environment ai.Environment) *Manager {
	return &Manager{World: environment.World(), Environment: environment}
}

func (m *Manager) ForEachShip(visit func(*objects.Ship)) {
	for _, npc := range m.Pirates {
		visit(npc.ship)
	}
}

const (
	pursuing = iota
	waiting
	fighting
	search
	collecting
	returning
	docked
	stranded
)

var stateNames = [...]string{
	pursuing:   "Pursuing",
	waiting:    "Waiting",
	fighting:   "Fighting",
	search:     "Search",
	collecting: "Collecting",
	returning:  "Returning",
	docked:     "Docked",
	stranded:   "Stranded",
}

type state struct {
	Search                  ai.Search
	Destination             Vec.Vector
	Credits                 float64
	VictimShipID            int64
	VictimVisible           bool
	PlayerSeen              bool
	Following               bool
	Home                    protocol.StationDescription
	HomeID                  int64
	State                   int
	SpawnedAt, WarnedAt     float64
	ThinkAfter              float64
	SearchStartedAt         float64
	SearchExpired           bool
	Defeated                bool
	AttackAfter, TauntAfter float64
	CollectAfter            float64
	ReDemandAfter           float64
	VictimReleasingCargo    bool
	CargoAccepted           bool
	Countdown               int
	Input                   protocol.Input
}

type pirate struct {
	state
	pilot      ai.Pilot
	ship       *objects.Ship
	victim     ai.Player
	aggressors map[int64]bool
	loot       []simulation.Entity
	lootTarget simulation.Entity
	ammunition *objects.Item
}

func (m *Manager) Dispatch() {
	world := m.World
	// Cargo checks are cheap, but station searches and dispatch run once a second.

	if world.Tick < m.DispatchAt {
		return
	}

	m.DispatchAt = world.Tick + uint64(world.Specification.PirateSpec.DispatchInterval/world.Specification.Simulation.SimulationStep)

	m.Environment.Players(func(p ai.Player) {
		if !p.Connected() || !world.Players.Has(p.ObserverID()) || p.Ship().Dead || p.Ship().DockedTo != nil || p.Ship().TransitTime != 0 || p.Ship().MinedCargoValue() <= world.Specification.PirateSpec.CargoValueThreshold || world.Tick < p.EncounterAfter() {
			return
		}

		if slices.ContainsFunc(m.Pirates, func(npc *pirate) bool { return npc.victim.AccountID() == p.AccountID() }) {
			return
		}

		home := m.Environment.NearestStation(p.Ship().Position)

		if home.DefinitionID == "" {
			return
		}

		m.spawn(p, home)
	})
}

func (m *Manager) spawn(victim ai.Player, home protocol.StationDescription) *pirate {
	world := m.World

	npc := &pirate{
		state:  state{Destination: victim.Ship().Position, Credits: world.Specification.PirateSpec.StartingCredits, VictimShipID: victim.Ship().ID, Home: home, HomeID: m.Environment.StationID(home), SpawnedAt: float64(world.Tick) * world.Specification.Simulation.SimulationStep},
		victim: victim, aggressors: map[int64]bool{},
	}

	ai.Spawn(m.Environment, ai.SpawnOptions{
		DefinitionID: "courser", Name: ai.DialogText(world.Specification.PirateSpec.Names), Home: home, Credits: &npc.Credits, Hostile: true,
		Configure: func(ship *objects.Ship) {
			npc.ship = ship
			ship.NPCState = stateNames[pursuing]
			ammoID := simulation.EntityID(world)
			npc.ammunition = objects.NewItem("autogunAmmo", simulation.ObjectProperties{World: world, ID: &ammoID}, world.Specification)
			ship.CargoContents = append(ship.CargoContents, npc.ammunition)
			m.Pirates = append(m.Pirates, npc)
		},
	})

	return npc
}

func (m *Manager) chat(npc *pirate, lines []string, replacements ...string) {
	ai.Chat(m.Environment, npc.ship, "hostile", lines, replacements...)
}

/*
Cargo demand controls are private to the player being threatened.
*/
func (m *Manager) cargoDemand(npc *pirate, active bool) {
	id := int64(0)

	if active {
		id = npc.ship.ID
	}

	if npc.victim.Connected() {
		m.Environment.Send(npc.victim, protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: &id})
	}
}

/*
seesPlayer excludes NPC observers, disconnected players and ships outside this sector.
*/
func (m *Manager) seesPlayer(npc *pirate, p ai.Player) bool {
	return p.Connected() && m.World.Players.Has(p.ObserverID()) && ai.CanSee(npc.ship, p.Ship())
}

/*
Docking ends this encounter's hostility toward that player, including after launch.
Other players who are still attacking remain targets.
*/
func (m *Manager) callOffDockedTargets(npc *pirate) {
	m.Environment.Players(func(p ai.Player) {
		victim := npc.victim.AccountID() == p.AccountID() && npc.VictimShipID == p.Ship().ID

		if p.Ship().DockedTo == nil || !npc.aggressors[p.ObserverID()] && !(victim && npc.State <= search && !npc.CargoAccepted) {
			return
		}

		m.chat(npc, m.World.Specification.PirateDialog.Escaped, "{player}", p.Ship().Name)
		delete(npc.aggressors, p.ObserverID())
		npc.ThinkAfter = 0

		if victim {
			m.cargoDemand(npc, false)
			npc.VictimVisible = false
			npc.loot = nil
			npc.CollectAfter = 0
			npc.ReDemandAfter = 0
			npc.CargoAccepted = false

			if npc.State != stranded && len(npc.aggressors) == 0 {
				npc.State = returning
			}
		}
	})
}

func (m *Manager) Update() {
	world := m.World
	dialog := &world.Specification.PirateDialog
	movement := &world.Specification.NPCMovement
	rules := &world.Specification.PirateSpec
	now := float64(world.Tick) * world.Specification.Simulation.SimulationStep

	m.Pirates = slices.DeleteFunc(m.Pirates, func(npc *pirate) bool {
		ship := npc.ship

		if ship.Dead {
			m.chat(npc, dialog.Destroyed)
		}

		if ship.DockedTo != nil && !ship.Dead {
			npc.State = docked
			ai.SellCargo(ship, &npc.Credits, npc.ammunition)
		}

		remove := ship.Dead || ship.DockedTo != nil || !world.Entities.Has(ship.ID)

		if !remove && !npc.Defeated && npc.lostEquipment() {
			npc.Defeated = true
			npc.State, npc.ThinkAfter = returning, 0
			npc.CollectAfter, npc.AttackAfter, npc.TauntAfter = 0, 0, 0
			npc.ReDemandAfter = 0
			npc.SearchExpired, npc.VictimVisible = false, false
			npc.loot = nil
			clear(npc.aggressors)
			m.cargoDemand(npc, false)
			m.chat(npc, dialog.Defeat)
		}

		// Searches keep their full window and their return trip home.
		// Other expired encounters release cargo before cleanup.
		if !remove && now-npc.SpawnedAt > rules.EncounterDuration && npc.State != search && npc.State != returning {
			ship.CargoRelease()

			if ship.DockedTo == nil && ship.ReleasableItem() != nil && now-npc.SpawnedAt < rules.EncounterDuration+rules.CargoReleaseTimeout {
				m.Environment.SetInput(*ship.PlayerID, protocol.Input{CargoHatch: true})
				return false
			}

			remove = true
		}

		if remove {
			m.cargoDemand(npc, false)
			ai.Remove(m.Environment, ship)
			npc.victim.SetEncounterAfter(world.Tick + uint64(rules.EncounterCooldown/world.Specification.Simulation.SimulationStep))
			return true
		}

		if isStranded := ship.Stranded(); isStranded && npc.State != stranded {
			npc.State, npc.ThinkAfter = stranded, 0
			npc.CollectAfter = 0
			npc.ReDemandAfter = 0
			m.cargoDemand(npc, false)
			m.chat(npc, dialog.Stranded)
		} else if npc.State == stranded && !isStranded {
			npc.State, npc.ThinkAfter = returning, 0
		}

		m.callOffDockedTargets(npc)

		m.updateAttack(npc, now)

		if npc.CollectAfter > 0 && now+1e-9 >= npc.CollectAfter {
			npc.State, npc.CollectAfter, npc.ThinkAfter = collecting, 0, 0
		}

		if now+1e-9 >= npc.ThinkAfter {
			m.observe(npc, now)
		}

		victim := npc.victim.Ship()
		releasing := victim.ReleasingCargo()
		newRelease := releasing && !npc.VictimReleasingCargo
		npc.VictimReleasingCargo = releasing

		if npc.State <= fighting && npc.VictimVisible && (now+1e-9 >= npc.ThinkAfter || victim.ReleasingCargo()) {
			for _, entity := range victim.CargoContents {
				if item, ok := entity.(*objects.Item); ok && item.Rounds == nil && item.Price > 0 && !slices.Contains(npc.loot, entity) {
					npc.loot = append(npc.loot, entity)
				}
			}
		}

		available := npc.victim.Ship().ID == npc.VictimShipID && npc.victim.Connected() && victim.World == world && !victim.Dead && world.Entities.Has(victim.ID) && victim.DockedTo == nil && victim.TransitTime == 0

		if npc.State <= fighting && npc.CollectAfter == 0 {
			claimedCargo := slices.ContainsFunc(npc.loot, func(item simulation.Entity) bool { return slices.Contains(victim.CargoContents, item) })

			if newRelease || npc.VictimVisible && victim.MinedCargoValue() == 0 && !claimedCargo && len(npc.aggressors) == 0 || victim.Dead && !npc.CargoAccepted {
				if newRelease {
					if npc.State == fighting {
						m.chat(npc, dialog.LateSurrender)
					} else if npc.State == waiting {
						m.chat(npc, dialog.Surrender)
					}

					delete(npc.aggressors, npc.victim.ObserverID())
				}

				m.cargoDemand(npc, false)
				m.beginCollection(npc, now)
			} else if !available && !npc.CargoAccepted {
				m.cargoDemand(npc, false)
				delete(npc.aggressors, npc.victim.ObserverID())
				npc.ThinkAfter = 0

				if len(npc.aggressors) == 0 {
					npc.State = returning
				}

				npc.loot = nil
				npc.CargoAccepted = false
				npc.ReDemandAfter = 0
			}
		}

		if npc.State == pursuing && npc.VictimVisible && Vec.DistanceSquared(ship.Position, victim.Position) <= rules.FollowStartDistance*rules.FollowStartDistance && len(npc.aggressors) == 0 {
			npc.State, npc.WarnedAt, npc.Countdown = waiting, now, rules.CountdownFrom+1
			npc.Following, npc.ThinkAfter = false, 0
			m.chat(npc, dialog.CargoDemand)
			m.cargoDemand(npc, true)
		}

		if npc.State == waiting {
			m.updateWarning(npc, now)
		}

		if now+1e-9 >= npc.ThinkAfter {
			npc.ThinkAfter = now + movement.DecisionInterval
			npc.Input = m.inputFor(npc)
		}

		// Release held fire as soon as surrendered cargo is observed.
		if len(npc.aggressors) == 0 && npc.State != fighting {
			npc.Input.Fire = false
		}

		m.Environment.SetInput(*ship.PlayerID, npc.Input)
		ship.NPCState = stateNames[npc.State]
		return false
	})
}

type savedPirate struct {
	state
	Victim                 string
	Aggressors             []string
	AggressorShips         []int64 `json:",omitempty"`
	Loot                   []int64
	LootTarget, Ammunition int64
}

func (m *Manager) Capture() []persistence.NPC {
	var result []persistence.NPC

	for _, npc := range m.Pirates {
		if npc.ship.Dead || !m.World.Entities.Has(npc.ship.ID) {
			continue
		}

		state := savedPirate{state: npc.state, Victim: npc.victim.AccountID()}

		for _, entity := range npc.loot {
			state.Loot = append(state.Loot, entity.Base().ID)
		}

		if npc.lootTarget != nil {
			state.LootTarget = npc.lootTarget.Base().ID
		}

		if npc.ammunition != nil {
			state.Ammunition = npc.ammunition.ID
		}

		// Observer IDs are assigned again at startup. Human accounts and NPC
		// ship IDs remain stable across that reassignment.
		aggressors := maps.Clone(npc.aggressors)

		m.Environment.AllPlayers(func(player ai.Player) {
			if npc.aggressors[player.ObserverID()] {
				state.Aggressors = append(state.Aggressors, player.AccountID())
			}

			delete(aggressors, player.ObserverID())
		})

		for id, hostile := range aggressors {
			if observer, ok := m.World.Players.Get(id); ok && hostile {
				state.AggressorShips = append(state.AggressorShips, observer.ShipID)
			}
		}

		slices.Sort(state.Aggressors)
		slices.Sort(state.AggressorShips)

		data, _ := json.Marshal(state)
		result = append(result, persistence.NPC{Kind: "pirate", ID: npc.ship.ID, State: data})
	}

	return result
}

func (m *Manager) Restore(ship *objects.Ship, data json.RawMessage) error {
	var saved savedPirate

	if err := json.Unmarshal(data, &saved); err != nil {
		return err
	}

	victim := m.Environment.Player(saved.Victim)

	if victim == nil {
		return fmt.Errorf("unknown victim account %q", saved.Victim)
	}

	if saved.State < 0 || saved.State >= len(stateNames) {
		return fmt.Errorf("unknown state %d", saved.State)
	}

	npc := &pirate{state: saved.state, ship: ship, victim: victim, aggressors: map[int64]bool{}}

	for _, account := range saved.Aggressors {
		if p := m.Environment.Player(account); p != nil {
			npc.aggressors[p.ObserverID()] = true
		}
	}

	for _, id := range saved.AggressorShips {
		if aggressor, ok := m.Environment.Entity(id).(*objects.Ship); ok && aggressor.PlayerID != nil {
			npc.aggressors[*aggressor.PlayerID] = true
		}
	}

	for _, id := range saved.Loot {
		if entity := m.savedItem(id, ship); entity != nil {
			npc.loot = append(npc.loot, entity)
		}
	}

	npc.lootTarget = m.savedItem(saved.LootTarget, ship)
	npc.ammunition, _ = m.savedItem(saved.Ammunition, ship).(*objects.Item)
	ship.Hostile, ship.NPCState = true, stateNames[npc.State]
	m.Environment.SetInput(*ship.PlayerID, npc.Input)
	m.Pirates = append(m.Pirates, npc)
	ai.Observe(m.Environment, ship, &npc.Credits)
	return nil
}

func (m *Manager) savedItem(id int64, ship *objects.Ship) simulation.Entity {
	if entity := m.Environment.Entity(id); entity != nil {
		return entity
	}

	for _, item := range ship.CargoContents {
		if item.Base().ID == id {
			return item
		}
	}

	var found simulation.Entity

	m.Environment.AllPlayers(func(p ai.Player) {
		for _, item := range p.Ship().CargoContents {
			if item.Base().ID == id {
				found = item
			}
		}
	})

	return found
}
