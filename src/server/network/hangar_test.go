package network

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func dockHangarPlayer(s *GameSession, p *playerRecord) {
	station := s.nearestStation(p.ship.Position)
	p.ship.DockedTo = new(int64(station.ID))
	p.ship.Position = station.Position
	s.regions.View(p.ship.Position, nil)
}

func hangarAction(t *testing.T, s *GameSession, p *playerRecord, command string, id int64, value string) {
	t.Helper()

	if err := s.applyHangarAction(p, protocol.Control{HangarCommand: command, ShipID: id, Text: value}); err != nil {
		t.Fatal(command, err)
	}
}

func TestHangarMustangSpecialOffer(t *testing.T) {
	t.Parallel()

	for _, mode := range []string{"credits", "assets", "cargo", "eligible", "shipless", "wrong-model", "not-sold"} {
		t.Run(mode, func(t *testing.T) {
			catalog, _ := specs.Load()
			s := NewGameSession(25, catalog)
			socket := &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			p := s.playersBySocket[socket]
			dockHangarPlayer(s, p)
			station := p.ship.TradeStation()
			price := 0.0

			for _, offer := range station.ShipsForSale {
				if offer.Ship == "mustang" {
					price = offer.Price
				}
			}

			p.profile.Credits = 0
			model := "mustang"

			switch mode {
			case "credits":
				p.profile.Credits = price
			case "cargo":
				p.ship.Fuel = 0
				p.ship.CargoContents = append(p.ship.CargoContents, objects.NewItem("diamond", simulation.ObjectProperties{World: s.World}, catalog))
			case "eligible":
				p.profile.Credits = 1
				p.ship.Fuel = 0
				p.ship.CargoContents = append(p.ship.CargoContents, objects.NewItem("diamond", simulation.ObjectProperties{World: s.World}, catalog))
				stored := objects.CreatePlayerShip(s.World, objects.Properties{DefinitionID: "finch"})
				s.World.Entities.Delete(stored.ID)

				for _, mount := range stored.Mounts() {
					if mount.Module != nil {
						stored.Fit(nil, mount)
					}
				}

				stored.SetHullHealth(make([]float64, len(stored.HullSegments)))
				p.storedShips = []*objects.Ship{stored}

				for index := range station.ShipsForSale {
					if station.ShipsForSale[index].Ship == "mustang" {
						station.ShipsForSale[index].Price = p.profile.Credits + shipSalePrice(p.ship) + shipSalePrice(stored) + 1
					}
				}
			case "shipless":
				hangarAction(t, s, p, "SELL", p.ship.ID, "")
				p.profile.Credits = 0
			case "wrong-model":
				model = "finch"
			case "not-sold":
				station.ShipsForSale = nil
			}

			previous := p.ship
			balance := p.profile.Credits
			count := len(p.ownedShips())
			err := s.applyHangarAction(p, protocol.Control{HangarCommand: "SPECIAL", Text: model})

			if mode != "eligible" && mode != "shipless" {
				if err == nil || p.ship != previous || p.profile.Credits != balance || len(p.ownedShips()) != count {
					t.Fatal("ineligible special offer changed player assets", err)
				}

				return
			}

			if err != nil {
				t.Fatal(err)
			}

			ship := p.ship

			if len(p.ownedShips()) != 1 || ship.ID == previous.ID || p.noShip || p.profile.Credits != 0 || len(p.storedShips) != 0 ||
				len(ship.Modules()) != len(catalog.ShipSpecs["mustang"].InitialLoadout) || ship.Fuel != ship.FuelCapacity ||
				ship.HullHealthTotal() != ship.HullMaxHealth() || len(ship.CargoContents) != 0 || ship.DockedTo == nil ||
				s.World.Entities.Has(previous.ID) || !s.World.Entities.Has(ship.ID) {
				t.Fatal("special offer did not replace all assets with a fresh docked Mustang")
			}
		})
	}
}

func TestHangarBuyingPilotingAndSelling(t *testing.T) {
	t.Parallel()
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	dockHangarPlayer(s, p)
	p.profile.Credits = 100000
	starter := p.ship
	balance := p.profile.Credits

	availableShips := 0

	for _, spec := range catalog.ShipSpecs {
		if !spec.NPCOnly {
			availableShips++
		}
	}

	for _, station := range catalog.StationSpecs {
		if len(station.ShipsForSale) != availableShips {
			t.Fatal("station does not offer every player ship")
		}

		for _, offer := range station.ShipsForSale {
			spec := catalog.ShipSpecs[offer.Ship]

			if spec.NPCOnly {
				t.Fatal("station offers an NPC-only ship")
			}

			price := spec.Price

			for _, entry := range spec.InitialLoadout {
				price += catalog.ModuleSpecs[entry.Module].Price
			}

			if offer.Price != price {
				t.Fatal("purchase price does not include standard equipment")
			}
		}
	}

	for id, spec := range catalog.ShipSpecs {
		if spec.NPCOnly {
			if err := s.applyHangarAction(p, protocol.Control{HangarCommand: "BUY", Text: id}); err == nil || p.ship != starter || p.profile.Credits != balance {
				t.Fatal("NPC-only ship can be bought", id, err)
			}
		}
	}

	hangarAction(t, s, p, "BUY", 0, "kestrel")
	first := p.ship
	price := shipSalePrice(first)

	if len(p.ownedShips()) != 2 || first == starter || first.Name != "Kestrel" || first.Fuel != first.FuelCapacity || first.HullHealthTotal() != first.HullMaxHealth() || len(first.Modules()) != len(catalog.ShipSpecs["kestrel"].InitialLoadout) || p.profile.Credits != balance-price || s.World.Entities.Has(starter.ID) {
		t.Fatal("buy did not add and automatically pilot a fully equipped ship")
	}

	hangarAction(t, s, p, "BUY", 0, "kestrel")
	second := p.ship

	if second.ID == first.ID || len(p.ownedShips()) != 3 {
		t.Fatal("duplicate models must be separate owned ships")
	}

	hangarAction(t, s, p, "RENAME", first.ID, "<b>🦄 & Finch")

	if first.Name != "<b>🦄 & Finch" || second.Name != "Kestrel" || p.profile.DisplayName != "" {
		t.Fatal("rename changed another identity")
	}

	hangarAction(t, s, p, "PILOT", first.ID, "")

	if p.ship != first || s.World.Entities.Has(second.ID) || !s.World.Entities.Has(first.ID) {
		t.Fatal("pilot did not swap world membership")
	}

	hangarAction(t, s, p, "SELL", second.ID, "")
	hangarAction(t, s, p, "SELL", first.ID, "")

	if p.ship != starter || len(p.ownedShips()) != 1 || p.profile.Credits != balance {
		t.Fatal("ship transactions must not lose credits or equipment value")
	}

	cargo := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World}, catalog)
	starter.CargoContents = append(starter.CargoContents, cargo)
	fullPrice := shipSalePrice(starter)
	starter.Fuel = 1
	health := starter.HullHealth()
	health[0] = 2
	starter.SetHullHealth(health)
	starter.Mounts()[1].Health = 1
	fullPrice -= starter.RepairCost(nil) + starter.RefuelCost()

	for _, mount := range starter.Mounts() {
		fullPrice -= starter.RepairCost(mount)
	}

	hangarAction(t, s, p, "SELL", starter.ID, "")

	if !p.noShip || len(p.ownedShips()) != 0 || p.profile.Credits != balance+fullPrice || len(starter.Modules()) != 0 || len(starter.CargoContents) != 0 {
		t.Fatal("last ship sale did not include equipment and cargo")
	}

	if err := s.applyHangarAction(p, protocol.Control{HangarCommand: "SELL", ShipID: starter.ID}); err == nil {
		t.Fatal("sold berth can be sold twice")
	}

	old := p.ship
	s.Receive(protocol.Control{Type: "input", Tick: s.World.Tick, Sequence: 1, Input: protocol.Input{Launch: true, Fire: true, Thrust: 1}}, socket)
	s.Tick(1)
	s.Receive(protocol.Control{Type: "respawn"}, socket)
	s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "buy", Module: 0}}, socket)

	if p.ship != old || p.ship.DockedTo == nil || *p.ship.DockedTo == 0 || p.ship.Launching != 0 || len(p.ship.Modules()) != 0 {
		t.Fatal("an empty hangar can launch, respawn, or buy equipment")
	}

	hangarAction(t, s, p, "BUY", 0, "mustang")

	if p.noShip || len(p.ownedShips()) != 1 || p.ship == old {
		t.Fatal("cannot recover from an empty hangar by buying a ship")
	}
}

func TestHangarStoredShipServicesAndValidation(t *testing.T) {
	t.Parallel()
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	dockHangarPlayer(s, p)
	p.profile.Credits = 100000
	starter := p.ship
	fullSalePrice := shipSalePrice(starter)
	starter.Fuel = 1
	health := starter.HullHealth()
	health[0] = 2
	starter.SetHullHealth(health)
	mount := starter.Mounts()[1]
	mount.Health = 1
	repairCost := starter.RepairCost(nil)

	for _, mount := range starter.Mounts() {
		repairCost += starter.RepairCost(mount)
	}

	if shipSalePrice(starter) != fullSalePrice-repairCost-starter.RefuelCost() {
		t.Fatal("sale price did not deduct full hull, module, and fuel service costs")
	}

	hangarAction(t, s, p, "BUY", 0, "arrow")

	for _, name := range []string{"", strings.Repeat("a", 17), "a\nb"} {
		if err := s.applyHangarAction(p, protocol.Control{HangarCommand: "RENAME", ShipID: starter.ID, Text: name}); err == nil {
			t.Fatal("invalid ship name accepted", name)
		}
	}

	repair := starter.RepairCost(nil)

	for _, mount := range starter.Mounts() {
		repair += starter.RepairCost(mount)
	}

	before := p.profile.Credits
	refuel := starter.RefuelCost()
	hangarAction(t, s, p, "REPAIR", starter.ID, "")
	hangarAction(t, s, p, "PAINT", starter.ID, "2")
	hangarAction(t, s, p, "REFUEL", starter.ID, "")

	if starter.HullHealthTotal() != starter.HullMaxHealth() || mount.Health != mount.Module.Base().Health || starter.Fuel != starter.FuelCapacity || p.profile.Credits != before-repair-refuel {
		t.Fatal("stored ship services did not apply or charged incorrectly")
	}

	if shipSalePrice(starter) != fullSalePrice {
		t.Fatal("fully serviced ship did not regain its full sale value")
	}

	p.profile.Credits = 0

	for _, message := range []protocol.Control{
		{HangarCommand: "BUY", Text: "mustang"},
		{HangarCommand: "BUY", Text: "station"},
		{HangarCommand: "SELL", ShipID: 99999},
		{HangarCommand: "PAINT", ShipID: starter.ID, Text: "999"},
		{HangarCommand: "UNKNOWN", ShipID: starter.ID},
	} {
		if err := s.applyHangarAction(p, message); err == nil {
			t.Fatal("invalid hangar request accepted", message)
		}
	}

	p.ship.DockedTo = nil

	if err := s.applyHangarAction(p, protocol.Control{HangarCommand: "PILOT", ShipID: starter.ID}); err == nil {
		t.Fatal("hangar usable while flying")
	}
}

func TestHangarPersistenceAndEmptyReconnect(t *testing.T) {
	t.Parallel()

	for _, empty := range []bool{false, true} {
		t.Run(map[bool]string{false: "fleet", true: "empty"}[empty], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "world.sqlite")
			s, store := persistedSession(t, path)
			socket := &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			p := s.playersBySocket[socket]
			token := p.profile.ID
			dockHangarPlayer(s, p)
			p.profile.Credits = 100000
			starter := p.ship
			hangarAction(t, s, p, "RENAME", starter.ID, "Old reliable")
			hangarAction(t, s, p, "BUY", 0, "moth")
			hangarAction(t, s, p, "RENAME", p.ship.ID, "New ship")

			if empty {
				hangarAction(t, s, p, "SELL", starter.ID, "")
				hangarAction(t, s, p, "SELL", p.ship.ID, "")
			}

			s.savePlayer(p)
			committedSession(t, s)
			balance, shipID := p.profile.Credits, p.shipID

			if err := store.Close(context.Background()); err != nil {
				t.Fatal(err)
			}

			s, store = persistedSession(t, path)
			defer store.Close(context.Background())
			s.Receive(protocol.Control{Type: "prepare", PlayerToken: token}, socket)
			s.Receive(protocol.Control{Type: "play"}, socket)
			p = s.playersBySocket[socket]
			committedSession(t, s)
			s.Tick(1)

			if p.noShip != empty || p.profile.Credits != balance || p.shipID != shipID || p.ship.DockedTo == nil {
				t.Fatal("fleet identity, berth, or balance lost on restart")
			}

			if !s.World.Entities.Has(p.shipID) || !s.World.Entities.Has(*p.ship.DockedTo) {
				t.Fatal("reconnected berth or its station is not available in the world")
			}

			if empty {
				if len(p.ownedShips()) != 0 {
					t.Fatal("restart gifted a ship")
				}

				hangarAction(t, s, p, "BUY", 0, "finch")
			} else if len(p.ownedShips()) != 2 || p.ship.Name != "New ship" || p.storedShips[0].Name != "Old reliable" {
				t.Fatal("ship names or stored ship lost on restart")
			}
		})
	}
}

func TestHangarUsesEachStationsOwnOffers(t *testing.T) {
	t.Parallel()
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	first := objects.NewStation("corral-5", objects.Properties{ObjectProperties: simulation.ObjectProperties{World: s.World}}, catalog)
	second := objects.NewStation("corral-5", objects.Properties{ObjectProperties: simulation.ObjectProperties{World: s.World}}, catalog)
	simulation.AddEntity(s.World, first)
	simulation.AddEntity(s.World, second)
	first.ShipsForSale[0].Price = 100

	if second.ShipsForSale[0].Price == 100 || catalog.StationSpecs["corral-5"].ShipsForSale[0].Price == 100 {
		t.Fatal("station inventories share mutable offers")
	}

	first.ShipsForSale = []specs.ShipOffer{{Ship: "mustang", Price: 100}}
	second.ShipsForSale = []specs.ShipOffer{{Ship: "finch", Price: 200}}
	p.ship.DockedTo = &first.ID
	p.profile.Credits = 300
	hangarAction(t, s, p, "BUY", 0, "mustang")

	if err := s.applyHangarAction(p, protocol.Control{HangarCommand: "BUY", Text: "finch"}); err == nil {
		t.Fatal("bought a model not sold at this station")
	}

	p.ship.DockedTo = &second.ID
	hangarAction(t, s, p, "BUY", 0, "finch")

	if p.profile.Credits != 0 || len(p.ownedShips()) != 3 {
		t.Fatal("station-specific prices not used")
	}

	hangarAction(t, s, p, "PILOT", p.storedShips[0].ID, "")

	if *p.ship.DockedTo != second.ID {
		t.Fatal("owned ships were not available at another station")
	}
}
