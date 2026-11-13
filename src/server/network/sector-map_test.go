package network

import (
	"bytes"
	"testing"
	"time"

	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestSectorMapViewportIsPrivateAndRateLimited(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	a, b := &soundSocket{}, &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, a)
	s.Receive(protocol.Control{Type: "hello"}, b)
	p := s.playersBySocket[a]
	other := s.playersBySocket[b]
	p.profile.DisplayName = "Map Pilot"
	other.profile.DisplayName = "Other Pilot"
	other.profile.Role = persistence.RoleAdmin
	a.frames, b.frames = nil, nil
	position := p.ship.Position
	// A player beyond the original 12 km radius is visible at the wider zoom.
	other.ship.Position = Vec.Add(position, Vec.Create(18000, 0))
	before := s.World.Entities.Len()
	s.Receive(protocol.Control{Type: "sectorMap", Position: position}, a)

	if len(a.frames) != 1 || len(b.frames) != 0 {
		t.Fatal("viewport response was not sent only to its requester")
	}

	packet := a.frames[0]

	if packet[3] != byte(catalog.Protocol.ControlMessageIDs["sectorMap"]) || !bytes.Contains(packet, []byte("Map Pilot")) || !bytes.Contains(packet, []byte("Other Pilot")) || !bytes.Contains(packet, []byte("admin")) {
		t.Fatal("map omitted same-sector player names")
	}

	if s.World.Entities.Len() != before {
		t.Fatal("map request changed world membership")
	}

	s.Receive(protocol.Control{Type: "sectorMap", Position: position}, a)

	if len(a.frames) != 1 {
		t.Fatal("map query rate was not bounded")
	}

	p.mapAt = time.Time{}
	position = Vec.Create(200000, 200000)
	s.Receive(protocol.Control{Type: "sectorMap", Position: position}, a)

	if len(a.frames) != 2 || !bytes.Contains(a.frames[1], []byte("Map Pilot")) || !bytes.Contains(a.frames[1], []byte("Other Pilot")) {
		t.Fatal("panning lost sector-wide player data")
	}

	if s.World.Entities.Len() != before {
		t.Fatal("panning loaded distant entities")
	}

	// Prepared accounts receive no map data before entering play.
	prepared := &soundSocket{}
	s.Receive(protocol.Control{Type: "prepare"}, prepared)
	prepared.frames = nil
	s.Receive(protocol.Control{Type: "sectorMap", Position: position}, prepared)

	if len(prepared.frames) != 0 {
		t.Fatal("prepared account received gameplay map")
	}
}

func TestSectorMapSendsAllSectorLandmarks(t *testing.T) {
	catalog, _ := specs.Load()
	s := NewGameSession(25, catalog)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	player := s.playersBySocket[socket]
	stations := s.regions.Procedural.MapStations()
	portals := s.sectors[s.currentSector].portals

	if len(stations) == 0 || len(portals) == 0 {
		t.Fatal("fixture needs stations and portals")
	}

	for _, position := range []Vec.Vector{player.ship.Position, Vec.Create(200000, 200000)} {
		player.mapAt = time.Time{}
		socket.frames = nil
		s.Receive(protocol.Control{Type: "sectorMap", Position: position}, socket)
		markers := append([]protocol.MapMarker{}, stations...)

		for _, portal := range portals {
			markers = append(markers, protocol.MapMarker{Kind: portal.Kind, ID: portal.ID, Position: portal.Position, Name: portal.Name})
		}

		for _, marker := range markers {
			packet, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "sectorMap", MapMarkers: []protocol.MapMarker{marker}}, catalog.Protocol)

			if err != nil || len(socket.frames) != 1 || !bytes.Contains(socket.frames[0], packet[5:]) {
				t.Fatalf("map omitted sector landmark %s %d", marker.Kind, marker.ID)
			}
		}
	}
}
