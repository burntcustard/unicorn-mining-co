package network

import (
	"bytes"
	"reflect"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type soundSocket struct {
	benchmarkSocket
	frames   [][]byte
	buffered int
}

func (s *soundSocket) BufferedBytes() int { return s.buffered }

func (s *soundSocket) SendBinary(data []byte) error {
	s.frames = append(s.frames, append([]byte(nil), data...))
	return s.benchmarkSocket.SendBinary(data)
}

func TestWorldSoundsReachEveryNearbyPlayer(t *testing.T) {
	t.Parallel()
	catalog, _ := specs.Load()
	session := NewGameSession(25, catalog)
	actor, observer, distant, menu := &soundSocket{}, &soundSocket{}, &soundSocket{}, &soundSocket{}

	for _, socket := range []*soundSocket{actor, observer, distant} {
		session.Receive(protocol.Control{Type: "hello"}, socket)
	}

	session.Receive(protocol.Control{Type: "prepare"}, menu)
	source := session.playersBySocket[actor]
	source.ship.Position = Vec.Create(100, 200)
	session.playersBySocket[observer].ship.Position = Vec.Create(200, 200)
	session.playersBySocket[distant].ship.Position = Vec.Create(1e9, 0)

	for _, socket := range []*soundSocket{actor, observer, distant, menu} {
		socket.frames = nil
	}

	contact := Vec.Create(150, 200)

	events := []protocol.SimulationEvent{
		protocol.ItemCollected{By: source.playerID},
		protocol.ModuleChanged{PlayerID: source.playerID, Module: "cargoHatch", Active: true},
		protocol.ModuleChanged{PlayerID: source.playerID, Module: "cargoHatch"},
		protocol.ModuleChanged{PlayerID: source.playerID, Module: "shieldGenerator", Active: true},
		protocol.ModuleChanged{PlayerID: source.playerID, Module: "shieldGenerator"},
		protocol.ModuleChanged{PlayerID: source.playerID, Module: "searchLight", Active: true},
		protocol.CollisionEvent{A: source.shipID, B: -99, Impact: 400, Damage: [2]float64{2, 0}, Position: contact},
		protocol.DrillDamage{TargetID: -99, By: source.playerID, Position: contact},
		protocol.AsteroidSplit{AsteroidID: -99},
		protocol.AsteroidDestroyed{AsteroidID: -99, By: source.playerID},
	}

	expected := []protocol.WorldSound{}

	for _, effect := range []byte{2, 0, 1, 6, 7, 9} {
		expected = append(expected, protocol.WorldSound{Effect: effect, ID: source.shipID, By: source.playerID, Position: source.ship.Position})
	}

	expected = append(expected,
		protocol.WorldSound{Effect: 3, ID: source.shipID, By: source.playerID, Position: contact},
		protocol.WorldSound{Effect: 4, ID: -99, By: source.playerID, Position: contact},
		protocol.WorldSound{Effect: 4, ID: -99, By: source.playerID, Position: contact},
	)

	if got := session.worldSounds(events); !reflect.DeepEqual(got, expected) {
		t.Fatalf("sounds: %#v", got)
	}

	session.sendWorldSounds(events)
	packet, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "sounds", Sounds: expected}, catalog.Protocol)

	if err != nil {
		t.Fatal(err)
	}

	for _, socket := range []*soundSocket{actor, observer} {
		if len(socket.frames) != 1 || !bytes.Equal(socket.frames[0], packet) {
			t.Fatal("nearby players did not receive the same authoritative sounds")
		}
	}

	if len(distant.frames) != 0 || len(menu.frames) != 0 {
		t.Fatal("audio reached a distant player or someone still in the menu")
	}

	observer.frames = nil
	observer.buffered = MaxSnapshotBuffer + 1
	session.sendWorldSounds(events)

	if len(observer.frames) != 0 {
		t.Fatal("audio ignored socket backpressure")
	}
}

func TestWorldSoundPacketsExcludeUI(t *testing.T) {
	t.Parallel()
	catalog, _ := specs.Load()
	_, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "sounds", Sounds: []protocol.WorldSound{{Effect: 8}}}, catalog.Protocol)

	if err == nil {
		t.Fatal("UI sounds entered the multiplayer protocol")
	}
}

func TestModuleSoundIsDeliveredOnceFromTick(t *testing.T) {
	t.Parallel()
	catalog, _ := specs.Load()
	session := NewGameSession(25, catalog)
	actor, observer := &soundSocket{}, &soundSocket{}
	session.Receive(protocol.Control{Type: "hello"}, actor)
	session.Receive(protocol.Control{Type: "hello"}, observer)
	player := session.playersBySocket[actor]
	player.ship.Position = Vec.Create(100000, 100000)
	session.playersBySocket[observer].ship.Position = Vec.Create(100200, 100000)
	session.Receive(protocol.Control{Type: "input", Tick: session.World.Tick, Sequence: 1, Input: protocol.Input{SearchLight: true}}, actor)
	observer.frames = nil
	session.Tick(1)
	count := 0

	for _, packet := range observer.frames {
		if len(packet) > 3 && packet[1] == 0x43 && int(packet[3]) == catalog.Protocol.ControlMessageIDs["sounds"] {
			count++
		}
	}

	if count != 1 {
		t.Fatalf("toggle produced %d audio packets", count)
	}

	observer.frames = nil
	session.Tick(1)

	for _, packet := range observer.frames {
		if len(packet) > 3 && packet[1] == 0x43 && int(packet[3]) == catalog.Protocol.ControlMessageIDs["sounds"] {
			t.Fatal("held toggle produced repeated audio")
		}
	}
}
