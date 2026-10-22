package network

import (
	"encoding/binary"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

func lateInputSession(t *testing.T) (*GameSession, *playerRecord, *benchmarkSocket) {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	session := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	session.Receive(protocol.Control{Type: "hello"}, socket)
	player := session.playersBySocket[socket]
	player.ship.DockedTo, player.ship.Launching = nil, 0
	session.Tick(1)
	socket.acknowledge(session)
	return session, player, socket
}

func armLateInputShip(t *testing.T, session *GameSession, player *playerRecord) *objects.Item {
	t.Helper()
	catalog := session.World.Specification
	gunID := simulation.EntityID(session.World)
	gun := modules.Create("autogun", simulation.ObjectProperties{World: session.World, ID: &gunID}, catalog)

	for _, mount := range player.ship.Mounts() {
		if slices.Contains(mount.Fits, "autogun") {
			player.ship.Fit(gun, mount)
			break
		}
	}

	if gun.ModuleBase().Mount == nil {
		t.Fatal("fixture ship has no autogun mount")
	}

	ammoID := simulation.EntityID(session.World)
	ammo := objects.NewItem("autogunAmmo", simulation.ObjectProperties{World: session.World, ID: &ammoID}, catalog)
	player.ship.CargoContents = append(player.ship.CargoContents, ammo)
	player.ship.SetModuleActive("autogun", true)
	player.ship.UpdateModules(3)
	gun.ModuleBase().FireCooldown, gun.ModuleBase().ChargeCooldown = 0, 0
	player.lastInput.AutogunActive = true
	return ammo
}

func TestLateInputWireTap(t *testing.T) {
	t.Parallel()
	session, player, socket := lateInputSession(t)
	ammo := armLateInputShip(t, session, player)
	fuel, position := player.ship.Fuel, player.ship.Position
	staleTick := session.World.Tick - 1

	for _, edge := range []struct {
		sequence uint64
		code     byte
		flags    byte
		offset   float64
	}{{1, 32, 1 | 2 | 8, .005}, {2, 0, 1 | 8, .015}} {
		packet := []byte{0x55, 0x43, 1, byte(session.World.Specification.Protocol.ControlMessageIDs["input"])}
		packet = binary.AppendUvarint(packet, staleTick)
		packet = binary.AppendUvarint(packet, edge.sequence)
		packet = append(packet, edge.code, edge.flags)
		packet = binary.LittleEndian.AppendUint64(packet, math.Float64bits(edge.offset))
		message, err := protocol.DecodeClientControl(packet, session.World.Specification.Protocol, session.World.Specification.Simulation.SimulationStep)

		if err != nil || !message.HasOffset {
			t.Fatalf("decode wire input: %+v %v", message, err)
		}

		session.Receive(message, socket)
	}

	if player.lastSequence != 0 || player.lastInput.Fire || *ammo.Rounds != 200 {
		t.Fatal("receiving overdue controls must not apply or acknowledge them before simulation")
	}

	session.Tick(1)

	if len(player.frame.Changes) != 2 || player.frame.Changes[0].Offset != 0 || math.Abs(player.frame.Changes[1].Offset-.010) > 1e-12 {
		t.Fatalf("late tap duration changed: %+v", player.frame.Changes)
	}

	shots := 0

	session.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		if projectile, ok := entity.(*objects.Projectile); ok && projectile.PlayerID != nil && *projectile.PlayerID == player.playerID {
			shots++
		}
	})

	if shots != 1 || *ammo.Rounds != 199 || player.ship.Firing || player.ship.Forward != 0 {
		t.Fatalf("a released late tap must fire once: shots=%d ammo=%d firing=%v forward=%v", shots, *ammo.Rounds, player.ship.Firing, player.ship.Forward)
	}

	if player.ship.Fuel >= fuel || Vec.Distance(player.ship.Position, position) == 0 || Vec.Length(player.ship.Velocity) == 0 {
		t.Fatal("the late thrust interval must really consume fuel and move the ship")
	}

	if player.lastSequence != 2 || socket.inputSequence != 2 {
		t.Fatal("the completed snapshot must acknowledge both simulated edges")
	}
}

func TestLateInputImmediatePress(t *testing.T) {
	t.Parallel()

	for _, tick := range []uint64{0, math.MaxUint64} {
		session, player, socket := lateInputSession(t)
		fuel := player.ship.Fuel
		session.Receive(protocol.Control{Type: "input", Tick: tick, Sequence: 1, Offset: .030, Input: protocol.Input{Thrust: 1}}, socket)

		if player.lastSequence != 0 {
			t.Fatal("an out-of-range input was acknowledged before its simulation")
		}

		session.Tick(1)

		if len(player.frame.Changes) != 1 || player.frame.Changes[0].Offset != 0 || player.ship.Forward != 1 || player.ship.Fuel >= fuel || socket.inputSequence != 1 {
			t.Fatal("a lone overdue or excessive-future press must apply at the current tick's start")
		}
	}
}

func TestLateInputBacklogCompression(t *testing.T) {
	t.Parallel()
	session, player, socket := lateInputSession(t)
	ammo := armLateInputShip(t, session, player)
	session.Tick(12)
	socket.acknowledge(session)
	step := session.World.Specification.Simulation.SimulationStep

	for index, tick := range []uint64{0, 3, 6, 9} {
		session.Receive(protocol.Control{Type: "input", Tick: tick, Sequence: uint64(index + 1), Offset: .005, Input: protocol.Input{Fire: index%2 == 0, AutogunActive: true}}, socket)
	}

	session.Tick(1)

	if len(player.frame.Changes) != 4 || *ammo.Rounds != 199 || player.ship.Firing || socket.inputSequence != 4 {
		t.Fatal("a backlog must fit one current simulation tick without replaying historical weapon damage")
	}

	for index, change := range player.frame.Changes {
		expected := float64(index) / 3 * (step - 1e-9)

		if math.Abs(change.Offset-expected) > 1e-12 || change.Offset >= step {
			t.Fatalf("backlog timing must compress proportionally within one tick: %+v", player.frame.Changes)
		}
	}
}

func TestLateInputAfterRegularEdge(t *testing.T) {
	t.Parallel()
	session, player, socket := lateInputSession(t)
	ammo := armLateInputShip(t, session, player)
	step := session.World.Specification.Simulation.SimulationStep
	session.Receive(protocol.Control{Type: "input", Tick: session.World.Tick, Sequence: 1, Offset: step - 1e-9, Input: protocol.Input{AutogunActive: true}}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: 0, Sequence: 2, Offset: .005, Input: protocol.Input{Fire: true, AutogunActive: true}}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: 0, Sequence: 3, Offset: .015, Input: protocol.Input{AutogunActive: true}}, socket)
	session.Tick(1)
	changes := player.frame.Changes

	if len(changes) != 3 || changes[0].Offset != changes[1].Offset || changes[1].Offset >= changes[2].Offset || changes[2].Offset >= step || *ammo.Rounds != 199 || player.ship.Firing {
		t.Fatal("a regular edge near the tick's end must not erase a later overdue fire tap")
	}
}

func TestLateInputBurst(t *testing.T) {
	t.Parallel()
	session, player, socket := lateInputSession(t)
	ammo := armLateInputShip(t, session, player)
	slot := &player.inputs[session.World.Tick%uint64(len(player.inputs))]

	// Sixty edges and their duplicates fit the existing 120-message read limit.
	for index := 0; index < 60; index++ {
		message := protocol.Control{Type: "input", Tick: 0, Sequence: uint64(index + 1), Offset: float64(index) * .0004, Input: protocol.Input{Fire: index%2 == 0, AutogunActive: true}}
		session.Receive(message, socket)
		message.Input.Fire = !message.Input.Fire
		session.Receive(message, socket)
	}

	if len(slot.changes) != 60 || player.lastSequence != 0 {
		t.Fatal("duplicates expanded the queued burst or advanced its acknowledgment")
	}

	session.Tick(1)

	if len(player.frame.Changes) != 60 || len(slot.changes) != 0 || player.lastSequence != 60 || socket.inputSequence != 60 || *ammo.Rounds != 199 || player.ship.Firing {
		t.Fatal("a late burst must consume one bounded tick, preserve edges, and avoid historical damage replay")
	}

	for index, change := range player.frame.Changes {
		if change.Input.Fire != (index%2 == 0) || math.Abs(change.Offset-float64(index)*.0004) > 1e-12 {
			t.Fatal("a duplicate changed a burst edge or its held duration")
		}
	}
}

func TestLateInputInterleavedTimeline(t *testing.T) {
	t.Parallel()
	session, player, socket := lateInputSession(t)
	ammo := armLateInputShip(t, session, player)
	session.Receive(protocol.Control{Type: "input", Tick: 0, Sequence: 1, Offset: .001, Input: protocol.Input{AutogunActive: true}}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: session.World.Tick, Sequence: 2, Offset: .030, Input: protocol.Input{AutogunActive: true}}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: 0, Sequence: 3, Offset: .005, Input: protocol.Input{AutogunActive: true, Fire: true}}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: 0, Sequence: 4, Offset: .015, Input: protocol.Input{AutogunActive: true}}, socket)
	session.Tick(1)
	changes := player.frame.Changes

	if len(changes) != 4 || changes[1].Offset >= changes[2].Offset || changes[2].Offset >= changes[3].Offset || *ammo.Rounds != 199 || player.ship.Firing {
		t.Fatalf("an interleaved current edge must not erase the next overdue tap: %+v ammo=%d", changes, *ammo.Rounds)
	}
}

func TestLateInputSequenceOrder(t *testing.T) {
	t.Parallel()
	session, player, socket := lateInputSession(t)
	future := session.World.Tick + 2
	session.Receive(protocol.Control{Type: "input", Tick: future, Sequence: 1, Input: protocol.Input{Turn: -1}}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: 0, Sequence: 1, Input: protocol.Input{Turn: 1}}, socket)

	if len(player.inputs[0].changes) != 0 {
		t.Fatal("an overdue duplicate must not replace a queued future input")
	}

	session.Receive(protocol.Control{Type: "input", Tick: 0, Sequence: 2, Offset: .005, Input: protocol.Input{Thrust: 1}}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: 0, Sequence: 2, Offset: .015, Input: protocol.Input{}}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: session.World.Tick, Sequence: 3, Offset: .015, Input: protocol.Input{}}, socket)
	session.Tick(1)

	if len(player.frame.Changes) != 2 || player.frame.Changes[0].Input.Thrust != 1 || player.frame.Changes[1].Input.Thrust != 0 || player.lastSequence != 3 {
		t.Fatal("a duplicate replaced the accepted late press or a newer release was lost")
	}

	session.Tick(2)

	if player.lastSequence != 3 || player.ship.Turn != 0 {
		t.Fatal("an older queued future input replaced a newer consumed input")
	}

	future = session.World.Tick + 1
	session.Receive(protocol.Control{Type: "input", Tick: future, Sequence: 4, Offset: .010, Input: protocol.Input{Turn: 1}}, socket)
	session.Tick(1)

	if player.lastSequence != 3 {
		t.Fatal("a future input was consumed early")
	}

	session.Tick(1)

	if player.lastSequence != 4 || len(player.frame.Changes) != 1 || player.frame.Changes[0].Offset != .010 || player.ship.Turn != 1 {
		t.Fatal("a newer future input lost its intended tick or offset")
	}

	token := player.profile.ID
	session.Disconnect(socket)
	session.Receive(protocol.Control{Type: "hello", PlayerToken: token}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: session.World.Tick, Sequence: 1, Input: protocol.Input{Turn: -1}}, socket)
	session.Tick(1)

	if player.lastSequence != 1 || player.ship.Turn != -1 {
		t.Fatal("reconnecting retained the previous connection's received sequence")
	}
}
