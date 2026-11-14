package network

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func (p *playerRecord) ownedShips() []*objects.Ship {
	if p.noShip {
		return p.storedShips
	}

	return append([]*objects.Ship{p.ship}, p.storedShips...)
}

func shipSalePrice(ship *objects.Ship) float64 {
	id := ship.DefinitionID

	if id == "" {
		id = "mustang"
	}

	price := ship.Catalog.ShipSpecs[id].Price

	for _, mount := range ship.Mounts() {
		if mount.Module != nil {
			price += mount.Module.ModuleBase().Spec.Price
		}
	}

	for _, object := range ship.CargoContents {
		if value := object.Base().Price; !math.IsNaN(value) {
			price += value
		}
	}

	price -= ship.RepairCost(nil) + ship.RefuelCost()

	for _, mount := range ship.Mounts() {
		price -= ship.RepairCost(mount)
	}

	return price
}

func (s *GameSession) pilotShip(p *playerRecord, ship *objects.Ship) {
	previous := p.ship
	previous.TargetLabel = ""
	ship.TargetLabel = p.profile.DisplayName

	p.storedShips = slices.DeleteFunc(p.storedShips, func(candidate *objects.Ship) bool { return candidate == ship })

	if !p.noShip {
		p.storedShips = append(p.storedShips, previous)
	}

	s.World.Entities.Delete(previous.ID)
	ship.Position, ship.Rotation = previous.Position, previous.Rotation
	ship.DockedTo = new(*previous.DockedTo)
	ship.Velocity = Vec.Vector{}
	ship.Spin, ship.Launching = 0, 0
	ship.Fly(0, 0)
	simulation.AddEntity(s.World, ship)
	p.ship, p.shipID, p.noShip = ship, ship.ID, false
	simulation.AddPlayer(s.World, simulation.Player{ID: p.playerID, ShipID: ship.ID, Credits: &p.profile.Credits})
	p.clearInputs()
	p.lastInput = protocol.Input{}
	p.hasInputLead = false
	p.respawnPending, p.needsLoad = true, true
}

func (s *GameSession) hangar(p *playerRecord, message protocol.Control) {
	err := s.applyHangarAction(p, message)

	if err != nil {
		p.hangarError = err.Error()
	} else if message.HangarCommand != "LIST" {
		s.savePlayer(p)
		p.needsLoad = true
	}

	p.hangarPending = true
	s.sendSnapshot(p, nil, nil)
}

func (s *GameSession) applyHangarAction(p *playerRecord, message protocol.Control) error {
	if p.ship.DockedTo == nil || *p.ship.DockedTo == 0 || p.ship.Launching != 0 {
		return fmt.Errorf("Dock at a station to use the hangar.")
	}

	stationEntity, ok := s.World.Entities.Get(*p.ship.DockedTo)

	if !ok {
		return fmt.Errorf("Station unavailable.")
	}

	station, ok := stationEntity.(*objects.Station)

	if !ok {
		return fmt.Errorf("Station unavailable.")
	}

	if message.HangarCommand == "LIST" {
		return nil
	}

	if message.HangarCommand == "BUY" || message.HangarCommand == "SPECIAL" {
		for _, offer := range station.ShipsForSale {
			if offer.Ship != message.Text {
				continue
			}

			if message.HangarCommand == "SPECIAL" {
				if offer.Ship != "mustang" {
					return fmt.Errorf("Special offer only available for a Mustang.")
				}

				value := p.profile.Credits

				for _, owned := range p.ownedShips() {
					value += shipSalePrice(owned)
				}

				if p.profile.Credits >= offer.Price || value >= offer.Price {
					return fmt.Errorf("Special offer unavailable: your assets can cover the regular price.")
				}
			} else if p.profile.Credits < offer.Price {
				return fmt.Errorf("Insufficient funds.")
			}

			ship := objects.CreatePlayerShip(s.World, objects.Properties{DefinitionID: offer.Ship, ObjectProperties: simulation.ObjectProperties{PlayerID: &p.playerID}})

			if message.HangarCommand == "SPECIAL" {
				p.profile.Credits = 0
				p.storedShips = nil
				p.noShip = true
			} else {
				p.profile.Credits -= offer.Price
			}

			s.pilotShip(p, ship)
			return nil
		}

		return fmt.Errorf("This station does not sell that ship.")
	}

	var ship *objects.Ship

	for _, owned := range p.ownedShips() {
		if owned.ID == message.ShipID {
			ship = owned
			break
		}
	}

	if ship == nil {
		return fmt.Errorf("You do not own that ship.")
	}

	ship.World = s.World
	ship.DockedTo = new(*p.ship.DockedTo)

	switch message.HangarCommand {
	case "PILOT":
		if ship != p.ship {
			s.pilotShip(p, ship)
		}
	case "SELL":
		p.profile.Credits += shipSalePrice(ship)

		if ship == p.ship {
			p.noShip = true

			if len(p.storedShips) > 0 {
				s.pilotShip(p, p.storedShips[0])
			} else {
				// Retain an inert docked berth for camera, replication and reconnects.
				// It is not owned and cannot launch or perform craft actions.
				for _, mount := range ship.Mounts() {
					if mount.Module != nil {
						ship.Fit(nil, mount)
					}
				}

				ship.CargoContents = nil
				p.lastInput = protocol.Input{}
				p.clearInputs()
			}
		} else {
			p.storedShips = slices.DeleteFunc(p.storedShips, func(candidate *objects.Ship) bool { return candidate == ship })
		}
	case "RENAME":
		name := strings.TrimSpace(message.Text)

		if name == "" || !protocol.ValidDisplayName(name) || strings.ContainsFunc(name, unicode.IsControl) {
			return fmt.Errorf("Enter a ship name from 1 to 16 characters.")
		}

		ship.Name = name
	case "REPAIR":
		total := ship.RepairCost(nil)

		for _, mount := range ship.Mounts() {
			total += ship.RepairCost(mount)
		}

		if p.profile.Credits < total {
			return fmt.Errorf("Insufficient funds.")
		}

		ship.ApplyDockAction(protocol.DockAction{Action: "repair"}, &p.profile.Credits)

		for index, mount := range ship.Mounts() {
			if mount.Module != nil {
				ship.ApplyDockAction(protocol.DockAction{Action: "repair", Mount: int64(index), HasMount: true, ModuleID: mount.Module.Base().ID, HasModuleID: true}, &p.profile.Credits)
			}
		}
	case "REFUEL":
		if p.profile.Credits < ship.RefuelCost() {
			return fmt.Errorf("Insufficient funds.")
		}

		ship.ApplyDockAction(protocol.DockAction{Action: "refuel"}, &p.profile.Credits)
	case "PAINT":
		paint, err := strconv.Atoi(message.Text)

		if err != nil || paint < 0 || paint >= len(s.World.Specification.PaintColors) || p.profile.UnlockedPaints&(1<<uint(paint)) == 0 {
			return fmt.Errorf("Paint unavailable.")
		}

		ship.ApplyDockAction(protocol.DockAction{Action: "paint", Paint: int64(paint)}, &p.profile.Credits)
	default:
		return fmt.Errorf("Unknown hangar action.")
	}

	return nil
}

func (s *GameSession) sendHangar(p *playerRecord) {
	batch := NewBinarySnapshotBatch(s.World.Specification).Begin(nil)
	snapshot := protocol.Snapshot{Load: true, Tick: s.World.Tick, NextEntityID: uint64(s.World.NextEntityID)}

	for _, ship := range p.ownedShips() {
		snapshot.Records = append(snapshot.Records, fullRecord(prepare(ship, batch), -1, nil))
	}

	offers := []specs.ShipOffer{}

	if station := p.ship.TradeStation(); station != nil {
		offers = station.ShipsForSale
	}

	s.sendControl(p.socket, protocol.ServerControl{Type: "hangar", ShipID: uint64(p.shipID), Credits: &p.profile.Credits, HangarError: p.hangarError, HangarShips: &snapshot, ShipsForSale: offers})
	p.hangarError = ""
}
