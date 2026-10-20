package network

import (
	"math"
	"slices"

	ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

const pirateRange = ai.SightRange

const (
	piratePursuing = iota
	pirateWaiting
	pirateFighting
	pirateSearch
	pirateCollecting
	pirateReturning
	pirateDocked
	pirateStranded
)

var pirateStateNames = [...]string{
	piratePursuing:   "Pursuing",
	pirateWaiting:    "Waiting",
	pirateFighting:   "Fighting",
	pirateSearch:     "Search",
	pirateCollecting: "Collecting",
	pirateReturning:  "Returning",
	pirateDocked:     "Docked",
	pirateStranded:   "Stranded",
}

type pirate struct {
	pilot                   ai.Pilot
	search                  ai.Search
	destination             Vec.Vector
	ship                    *objects.Ship
	credits                 float64
	victim                  *playerRecord
	victimShipID            int64
	victimVisible           bool
	following               bool
	home                    protocol.StationDescription
	homeID                  int64
	state                   int
	spawnedAt, warnedAt     float64
	thinkAfter              float64
	searchStartedAt         float64
	attackAfter, tauntAfter float64
	collectAfter            float64
	victimReleasingCargo    bool
	cargoAccepted           bool
	countdown               int
	aggressors              map[int64]bool
	loot                    []simulation.Entity
	ammunition              *objects.Item
	input                   protocol.Input
}

func (s *GameSession) dispatchPirates() {
	world := s.World
	// Cargo checks are cheap, but station searches and dispatch run once a second.
	runtime := s.sectors[s.currentSector]

	if world.Tick < runtime.pirateDispatchAt {
		return
	}

	runtime.pirateDispatchAt = world.Tick + uint64(world.Specification.PirateSpec.DispatchInterval/world.Specification.Simulation.SimulationStep)

	s.sectorPlayers(func(p *playerRecord, _ string) {
		if p.socket == nil || !world.Players.Has(p.playerID) || p.ship.Dead || p.ship.DockedTo != nil || p.ship.TransitTime != 0 || p.ship.MinedCargoValue() <= world.Specification.PirateSpec.CargoValueThreshold || world.Tick < p.pirateAfter {
			return
		}

		if slices.ContainsFunc(runtime.pirates, func(npc *pirate) bool { return npc.victim == p }) {
			return
		}

		home := s.nearestStation(p.ship.Position)

		if home.DefinitionID == "" {
			return
		}

		s.spawnPirate(p, home)
	})
}

func (s *GameSession) spawnPirate(victim *playerRecord, home protocol.StationDescription) *pirate {
	world := s.World
	id, playerID := simulation.EntityID(world), s.nextPlayerID
	s.nextPlayerID++
	homeID := s.regions.idOffset + int64(home.ID)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", ObjectProperties: simulation.ObjectProperties{World: world, ID: &id, PlayerID: &playerID, Position: home.Position, Name: new("Pirate")}, DockedTo: &homeID})
	ship.Hostile = true
	ship.NPCState = pirateStateNames[piratePursuing]
	npc := &pirate{destination: victim.ship.Position, ship: ship, credits: world.Specification.PirateSpec.StartingCredits, victim: victim, victimShipID: victim.shipID, home: home, homeID: homeID, spawnedAt: float64(world.Tick) * world.Specification.Simulation.SimulationStep, aggressors: map[int64]bool{}}
	ammoID := simulation.EntityID(world)
	npc.ammunition = objects.NewItem("autogunAmmo", simulation.ObjectProperties{World: world, ID: &ammoID}, world.Specification)
	ship.CargoContents = append(ship.CargoContents, npc.ammunition)
	s.sectors[s.currentSector].pirates = append(s.sectors[s.currentSector].pirates, npc)
	simulation.AddEntity(world, ship)
	simulation.AddPlayer(world, simulation.Player{ID: playerID, ShipID: id, Credits: &npc.credits, ObserverRange: pirateRange})
	// Load the launch station and the first 1,500 units before moving the NPC.
	s.regions.Sync(world, s.positions())
	ship.Launch()
	return npc
}

func (s *GameSession) pirateChat(npc *pirate, lines []string, replacements ...string) {
	message := protocol.ServerControl{Type: "chat", Channel: 0, Sender: npc.ship.Name, SenderRole: "hostile", Text: dialogText(lines, replacements...)}

	s.sectorPlayers(func(p *playerRecord, _ string) {
		if p.socket != nil && s.World.Players.Has(p.playerID) {
			s.sendControl(p.socket, message)
		}
	})
}

/*
Cargo demand controls are private to the player being threatened.
*/
func (s *GameSession) pirateCargoDemand(npc *pirate, active bool) {
	id := int64(0)

	if active {
		id = npc.ship.ID
	}

	if npc.victim.socket != nil {
		s.sendControl(npc.victim.socket, protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: &id})
	}
}

/*
pirateSeesPlayer excludes NPC observers, disconnected players and ships outside this sector.
*/
func (s *GameSession) pirateSeesPlayer(npc *pirate, p *playerRecord) bool {
	return p.socket != nil && s.World.Players.Has(p.playerID) && ai.CanSee(npc.ship, p.ship)
}

/*
observePirate remembers only visible positions, then searches the last reported area.
Search can acquire a different player, while existing hostility is retained.
*/
func (s *GameSession) observePirate(npc *pirate, now float64) {
	if npc.state > pirateSearch {
		return
	}

	npc.victimVisible = npc.victim.shipID == npc.victimShipID && s.pirateSeesPlayer(npc, npc.victim)

	if npc.collectAfter > 0 {
		return
	}

	enemy := ai.NearestEnemy(npc.ship, npc.aggressors)

	if now+1e-9 < npc.attackAfter {
		if enemy != nil {
			npc.destination = enemy.Position
		}

		return
	}

	if !npc.victimVisible && (npc.state == pirateWaiting || npc.state == pirateFighting) && !npc.victim.ship.ReleasingCargo() {
		s.pirateCargoDemand(npc, false)
		npc.state = piratePursuing
	}

	if enemy != nil {
		npc.destination = enemy.Position
		npc.state = pirateFighting
		return
	}

	if npc.victimVisible && (len(npc.aggressors) == 0 || npc.aggressors[npc.victim.playerID]) {
		npc.destination = npc.victim.ship.Position

		if npc.state == pirateSearch {
			npc.state = piratePursuing
		}

		if npc.aggressors[npc.victim.playerID] {
			npc.state = pirateFighting
		}

		return
	}

	if npc.state == pirateFighting || npc.state == pirateWaiting {
		npc.state = piratePursuing
	}

	arrivalDistance := s.World.Specification.PirateSpec.ReportArrivalDistance

	if npc.state == piratePursuing && Vec.DistanceSquared(npc.ship.Position, npc.destination) <= arrivalDistance*arrivalDistance {
		npc.state, npc.searchStartedAt = pirateSearch, now
		npc.search = ai.Search{Origin: npc.destination, Heading: npc.ship.Rotation}
		s.pirateChat(npc, s.World.Specification.PirateDialog.Search)
		return
	}

	if npc.state != pirateSearch {
		return
	}

	var found *playerRecord
	distance := math.Inf(1)

	s.sectorPlayers(func(p *playerRecord, _ string) {
		d := Vec.DistanceSquared(npc.ship.Position, p.ship.Position)

		if d < distance && (len(npc.aggressors) == 0 || npc.aggressors[p.playerID]) && s.pirateSeesPlayer(npc, p) {
			found, distance = p, d
		}
	})

	if found != nil {
		if npc.victim != found {
			npc.victim.pirateAfter = s.World.Tick + uint64(s.World.Specification.PirateSpec.EncounterCooldown/s.World.Specification.Simulation.SimulationStep)
		}

		if npc.victim != found || npc.victimShipID != found.shipID {
			npc.loot = nil
			npc.victimReleasingCargo = false
			npc.cargoAccepted = false
		}

		npc.victim, npc.victimShipID = found, found.shipID
		npc.state, npc.destination, npc.victimVisible = piratePursuing, found.ship.Position, true
	} else if now-npc.searchStartedAt+1e-9 >= s.World.Specification.PirateSpec.SearchDuration {
		s.pirateChat(npc, s.World.Specification.PirateDialog.SearchExpired)
		npc.state, npc.loot = pirateReturning, nil
	}
}

/*
Docking ends this encounter's hostility toward that player, including after launch.
Other players who are still attacking remain targets.
*/
func (s *GameSession) callOffDockedPirateTargets(npc *pirate) {
	s.sectorPlayers(func(p *playerRecord, _ string) {
		victim := npc.victim == p && npc.victimShipID == p.shipID

		if p.ship.DockedTo == nil || !npc.aggressors[p.playerID] && !(victim && npc.state <= pirateSearch && !npc.cargoAccepted) {
			return
		}

		s.pirateChat(npc, s.World.Specification.PirateDialog.Escaped, "{player}", p.ship.Name)
		delete(npc.aggressors, p.playerID)
		npc.thinkAfter = 0

		if victim {
			s.pirateCargoDemand(npc, false)
			npc.victimVisible = false
			npc.loot = nil
			npc.collectAfter = 0
			npc.cargoAccepted = false

			if npc.state != pirateStranded && len(npc.aggressors) == 0 {
				npc.state = pirateReturning
			}
		}
	})
}

func (s *GameSession) updatePirates() {
	world := s.World
	dialog := &world.Specification.PirateDialog
	movement := &world.Specification.NPCMovement
	rules := &world.Specification.PirateSpec
	now := float64(world.Tick) * world.Specification.Simulation.SimulationStep
	runtime := s.sectors[s.currentSector]

	runtime.pirates = slices.DeleteFunc(runtime.pirates, func(npc *pirate) bool {
		ship := npc.ship

		if ship.Dead {
			s.pirateChat(npc, dialog.Destroyed)
		}

		if ship.DockedTo != nil && !ship.Dead {
			npc.state = pirateDocked
			var ids []int64

			for _, item := range ship.CargoContents {
				if item != npc.ammunition {
					ids = append(ids, item.Base().ID)
				}
			}

			if len(ids) > 0 {
				ship.ApplyDockAction(protocol.DockAction{Action: "sell", ObjectIDs: ids}, &npc.credits)
			}
		}

		remove := ship.Dead || ship.DockedTo != nil || !world.Entities.Has(ship.ID)

		// Searches keep their full window and their return trip home.
		// Other expired encounters release cargo before cleanup.
		if !remove && now-npc.spawnedAt > rules.EncounterDuration && npc.state != pirateSearch && npc.state != pirateReturning {
			ship.CargoRelease()

			if ship.DockedTo == nil && ship.ReleasableItem() != nil && now-npc.spawnedAt < rules.EncounterDuration+rules.CargoReleaseTimeout {
				s.inputs[*ship.PlayerID] = protocol.InputFrame{Input: protocol.Input{CargoHatch: true}}
				return false
			}

			remove = true
		}

		if remove {
			s.pirateCargoDemand(npc, false)
			world.Players.Delete(*ship.PlayerID)
			world.Entities.Delete(ship.ID)
			delete(s.inputs, *ship.PlayerID)
			npc.victim.pirateAfter = world.Tick + uint64(rules.EncounterCooldown/world.Specification.Simulation.SimulationStep)
			return true
		}

		if stranded := ship.Stranded(); stranded && npc.state != pirateStranded {
			npc.state, npc.thinkAfter = pirateStranded, 0
			npc.collectAfter = 0
			s.pirateCargoDemand(npc, false)
			s.pirateChat(npc, dialog.Stranded)
		} else if npc.state == pirateStranded && !stranded {
			npc.state, npc.thinkAfter = pirateReturning, 0
		}

		s.callOffDockedPirateTargets(npc)

		s.updatePirateAttack(npc, now)

		if npc.collectAfter > 0 && now+1e-9 >= npc.collectAfter {
			npc.state, npc.collectAfter, npc.thinkAfter = pirateCollecting, 0, 0
		}

		if now+1e-9 >= npc.thinkAfter {
			s.observePirate(npc, now)
		}

		victim := npc.victim.ship
		releasing := victim.ReleasingCargo()
		newRelease := releasing && !npc.victimReleasingCargo
		npc.victimReleasingCargo = releasing

		if npc.state <= pirateFighting && npc.victimVisible && (now+1e-9 >= npc.thinkAfter || victim.ReleasingCargo()) {
			for _, entity := range victim.CargoContents {
				if item, ok := entity.(*objects.Item); ok && item.Rounds == nil && item.Price > 0 && !slices.Contains(npc.loot, entity) {
					npc.loot = append(npc.loot, entity)
				}
			}
		}

		available := npc.victim.shipID == npc.victimShipID && npc.victim.socket != nil && victim.World == world && !victim.Dead && world.Entities.Has(victim.ID) && victim.DockedTo == nil && victim.TransitTime == 0

		if npc.state <= pirateFighting && npc.collectAfter == 0 {
			if newRelease || npc.victimVisible && victim.MinedCargoValue() == 0 && len(npc.aggressors) == 0 || victim.Dead && !npc.cargoAccepted {
				if newRelease {
					if npc.state == pirateFighting {
						s.pirateChat(npc, dialog.LateSurrender)
					} else if npc.state == pirateWaiting {
						s.pirateChat(npc, dialog.Surrender)
					}

					delete(npc.aggressors, npc.victim.playerID)
				}

				s.pirateCargoDemand(npc, false)
				s.beginPirateCollection(npc, now)
			} else if !available && !npc.cargoAccepted {
				s.pirateCargoDemand(npc, false)
				delete(npc.aggressors, npc.victim.playerID)
				npc.thinkAfter = 0

				if len(npc.aggressors) == 0 {
					npc.state = pirateReturning
				}

				npc.loot = nil
				npc.cargoAccepted = false
			}
		}

		if npc.state == piratePursuing && npc.victimVisible && Vec.DistanceSquared(ship.Position, victim.Position) <= rules.FollowStartDistance*rules.FollowStartDistance && len(npc.aggressors) == 0 {
			npc.state, npc.warnedAt, npc.countdown = pirateWaiting, now, rules.CountdownFrom+1
			npc.following, npc.thinkAfter = false, 0
			s.pirateChat(npc, dialog.CargoDemand)
			s.pirateCargoDemand(npc, true)
		}

		if npc.state == pirateWaiting {
			s.updatePirateWarning(npc, now)
		}

		if now+1e-9 >= npc.thinkAfter {
			npc.thinkAfter = now + movement.DecisionInterval
			npc.input = s.pirateInput(npc)
		}

		// Release held fire as soon as surrendered cargo is observed.
		if len(npc.aggressors) == 0 && npc.state != pirateFighting {
			npc.input.Fire = false
		}

		s.inputs[*ship.PlayerID] = protocol.InputFrame{Input: npc.input}
		ship.NPCState = pirateStateNames[npc.state]
		return false
	})
}
