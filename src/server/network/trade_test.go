package network

import (
	"context"
	"path/filepath"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func sellTradeCargo(t *testing.T, s *GameSession, socket *benchmarkSocket) (*objects.Station, *objects.Item, simulation.Module) {
	t.Helper()
	p := s.playersBySocket[socket]
	description := s.nearestStation(p.ship.Position)
	p.ship.Position = description.Position
	stationID := int64(description.ID)
	p.ship.DockedTo = &stationID
	s.regions.View(p.ship.Position, nil)
	station := p.ship.TradeStation()

	if station == nil {
		t.Fatal("station must be loaded before trading")
	}

	itemID := simulation.EntityID(s.World)
	item := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World, ID: &itemID}, s.World.Specification)
	module := modules.Create("shieldGeneratorSm", simulation.ObjectProperties{World: s.World}, s.World.Specification)
	module.Base().Shades = s.World.Specification.PaintColors[0]
	module.Base().Health = 3
	p.ship.CargoContents = append(p.ship.CargoContents, item, module)
	credits := p.profile.Credits
	s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "sell", ObjectIDs: []int64{item.ID, module.Base().ID}}}, socket)

	if len(p.ship.CargoContents) != 0 || len(station.CargoContents) != 302 || p.profile.Credits != credits+item.Price+module.Base().Price {
		t.Fatal("sale must transfer cargo to station stock and credit the seller")
	}

	return station, item, module
}

func TestTradeModuleBuybackEndsWithVisit(t *testing.T) {
	t.Parallel()

	for _, exit := range []string{"undock", "disconnect"} {
		t.Run(exit, func(t *testing.T) {
			catalog, _ := specs.Load()
			s := NewGameSession(25, catalog)
			socket := &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			p := s.playersBySocket[socket]
			station, item, module := sellTradeCargo(t, s, socket)
			buy := protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "buyStock", ObjectIDs: []int64{module.Base().ID}}}
			credits := p.profile.Credits
			s.Receive(buy, socket)

			if len(p.ship.CargoContents) != 1 || p.ship.CargoContents[0] != module || module.Base().Health != 3 || !slices.Equal(module.Base().Shades, catalog.PaintColors[0]) || p.profile.Credits != credits-module.Base().Price {
				t.Fatal("buyback must return the same module with its condition and paint")
			}

			s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "sell", ObjectIDs: []int64{module.Base().ID}}}, socket)
			staleID := module.Base().ID

			if exit == "undock" {
				p.ship.Launch()
				p.ship.DockedTo = &station.ID
			} else {
				s.Disconnect(socket)
				socket = &benchmarkSocket{}
				s.Receive(protocol.Control{Type: "hello", PlayerToken: p.profile.ID}, socket)
			}

			if len(station.CargoContents) != 301 || !slices.Contains(station.CargoContents, simulation.Entity(item)) {
				t.Fatal("ending a visit must discard modules but keep items")
			}

			credits = p.profile.Credits
			s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "buyStock", ObjectIDs: []int64{staleID}}}, socket)

			if len(p.ship.CargoContents) != 0 || p.profile.Credits != credits {
				t.Fatal("an expired module cannot be purchased through a stale Trade row")
			}

			// A different pilot can buy the retained item, but cannot buy it twice.
			buyerSocket := &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, buyerSocket)
			buyer := s.playersBySocket[buyerSocket]
			buyer.ship.DockedTo = &station.ID
			buyer.profile.Credits = 1000
			buy.Dock.ObjectIDs = []int64{item.ID}
			s.Receive(buy, buyerSocket)
			s.Receive(buy, socket)

			if len(station.CargoContents) != 300 || len(buyer.ship.CargoContents) != 1 || buyer.ship.CargoContents[0] != item || len(p.ship.CargoContents) != 0 || p.profile.Credits != credits {
				t.Fatal("station items must transfer once to another pilot")
			}
		})
	}
}

func TestTradeItemsSurviveRestart(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	station, item, _ := sellTradeCargo(t, s, socket)
	stationID, itemID := station.ID, item.ID
	committedSession(t, s)

	// Save while the seller is still docked: temporary modules must never persist.
	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	entity, ok := s.World.Entities.Get(stationID)

	if !ok {
		t.Fatal("saved station was not restored")
	}

	station = entity.(*objects.Station)

	if len(station.CargoContents) != 301 || !slices.ContainsFunc(station.CargoContents, func(e simulation.Entity) bool { return e.Base().ID == itemID }) || len(station.Modules()) != 0 {
		t.Fatal("restart must retain sold items and discard temporary modules")
	}

	p := s.playersBySocket[socket]
	p.ship.DockedTo = &station.ID
	p.profile.Credits = 1000
	s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "buyStock", ObjectIDs: []int64{itemID}}}, socket)

	if len(station.CargoContents) != 300 || len(p.ship.CargoContents) != 1 || p.ship.CargoContents[0].Base().ID != itemID {
		t.Fatal("another player must be able to buy persisted station stock")
	}

	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	entity, ok = s.regions.sleeping.Get(stationID)

	if !ok || len(entity.(*objects.Station).CargoContents) != 300 {
		t.Fatal("purchased stock reappeared after restart")
	}
}

func TestStationAmmoSupplySurvivesRestart(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	description := s.nearestStation(p.ship.Position)
	p.ship.Position = description.Position
	stationID := int64(description.ID)
	p.ship.DockedTo = &stationID
	s.regions.View(p.ship.Position, nil)
	station := p.ship.TradeStation()

	if station == nil || len(station.CargoContents) != 300 {
		t.Fatal("new stations must stock 300 ammunition packs")
	}

	stockedID := station.CargoContents[0].Base().ID
	s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "buyStock", ObjectIDs: []int64{stockedID}}}, socket)

	if len(station.CargoContents) != 299 || len(p.ship.CargoContents) != 1 || p.ship.CargoContents[0].Base().ID != stockedID {
		t.Fatal("Trade must transfer one stocked pack and decrease supply")
	}

	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	entity, ok := s.World.Entities.Get(stationID)

	if !ok || len(entity.(*objects.Station).CargoContents) != 299 {
		t.Fatal("restart must preserve the remaining supply")
	}

	station = entity.(*objects.Station)
	p = s.playersBySocket[socket]
	p.ship.DockedTo = &stationID
	p.profile.Credits = 1000

	for range 299 {
		p.ship.CargoContents = nil

		if _, ok := p.ship.ApplyDockAction(protocol.DockAction{Action: "buyAmmo"}, &p.profile.Credits); !ok {
			t.Fatal("Buy ammo must use the remaining finite supply")
		}
	}

	p.ship.CargoContents = nil
	credits := p.profile.Credits
	s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "buyAmmo"}}, socket)

	if len(station.CargoContents) != 0 || len(p.ship.CargoContents) != 0 || p.profile.Credits != credits {
		t.Fatal("exhausted stock must not create ammunition or charge credits")
	}

	committedSession(t, s)

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	entity, ok = s.regions.sleeping.Get(stationID)

	if !ok || len(entity.(*objects.Station).CargoContents) != 0 {
		t.Fatal("empty station stock must remain empty after restart")
	}
}
