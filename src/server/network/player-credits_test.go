package network

import (
	"context"
	"encoding/json"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"path/filepath"
	"strings"
	"testing"
)

func TestPlayerCreditsTradeAndSurviveShipReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "world.sqlite")
	s, store := persistedSession(t, path)
	socket, otherSocket := &benchmarkSocket{}, &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	s.Receive(protocol.Control{Type: "hello"}, otherSocket)
	p, other := s.playersBySocket[socket], s.playersBySocket[otherSocket]
	committedSession(t, s)

	if p.profile.Credits != 2000 || other.profile.Credits != 2000 {
		t.Fatal("new players did not receive starting credits")
	}

	token := p.profile.ID
	station := s.nearestStation(p.ship.Position)
	stationID := int64(station.ID)
	p.ship.DockedTo = &stationID
	gold := objects.NewItem("gold", simulation.ObjectProperties{World: s.World}, s.World.Specification)
	p.ship.CargoContents = append(p.ship.CargoContents, gold)
	s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "sell", ObjectIDs: []int64{gold.ID}}}, socket)
	committedSession(t, s)

	if p.profile.Credits != 2030 || len(p.ship.CargoContents) != 0 {
		t.Fatal("sale did not credit the player")
	}

	// Insufficient funds leave both the player account and ship cargo intact.
	p.profile.Credits = 530
	s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "buy", Module: 7}}, socket)

	if p.profile.Credits != 530 || len(p.ship.CargoContents) != 0 {
		t.Fatal("rejected purchase changed player balance or cargo")
	}

	s.Receive(protocol.Control{Type: "dock", Dock: protocol.DockAction{Action: "buy", Module: 4}}, socket)
	committedSession(t, s)

	if p.profile.Credits != 380 || len(p.ship.CargoContents) != 1 || other.profile.Credits != 2000 {
		t.Fatal("purchase did not debit only the owning player")
	}

	data, err := json.Marshal(objects.CaptureShip(p.ship))

	if err != nil || strings.Contains(string(data), "credits") {
		t.Fatal("ship save contains player credits", err)
	}

	oldShip := p.shipID
	p.ship.Remove()
	s.Receive(protocol.Control{Type: "respawn"}, socket)
	committedSession(t, s)

	if p.shipID == oldShip || p.profile.Credits != 380 {
		t.Fatal("respawn changed the player's balance")
	}

	worldPlayer, _ := s.World.Players.Get(p.playerID)

	if worldPlayer.Credits != &p.profile.Credits {
		t.Fatal("world player does not use its account balance")
	}

	s.Disconnect(socket)
	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)
	committedSession(t, s)

	if s.playersBySocket[socket].profile.Credits != 380 {
		t.Fatal("reconnecting granted starting credits again")
	}

	if err := s.shutdownPersistence(context.Background()); err != nil {
		t.Fatal(err)
	}

	if err := store.Close(context.Background()); err != nil {
		t.Fatal(err)
	}

	s, store = persistedSession(t, path)
	defer store.Close(context.Background())
	socket = &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)

	if s.playersBySocket[socket].profile.Credits != 380 {
		t.Fatal("server restart lost the player balance")
	}
}
