package server

import (
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	"testing"
)

func TestSnapshotCadence(t *testing.T) {
	catalog, err := specification.Load()
	if err != nil {
		t.Fatal(err)
	}
	session := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	session.Receive(protocol.Control{Type: "hello"}, socket)
	if socket.packets != 2 || socket.sequence != 1 {
		t.Fatal("hello must immediately send welcome and load")
	}
	player := session.playersBySocket[socket]
	acknowledge := func() {
		session.Receive(protocol.Control{Type: "snapshotAck", Sequence: socket.sequence}, socket)
	}
	for tick := uint64(1); tick <= 8; tick++ {
		acknowledge()
		session.Receive(protocol.Control{Type: "input", Tick: session.World.Tick, Sequence: tick, Input: protocol.Input{Thrust: float64(tick % 2)}}, socket)
		session.Tick(1)
		if socket.packets != int(tick)+2 || socket.sequence != tick+1 || player.lastSequence != tick || session.World.Tick != tick {
			t.Fatalf("tick %d: packets=%d sequence=%d input=%d world=%d", tick, socket.packets, socket.sequence, player.lastSequence, session.World.Tick)
		}
	}
	acknowledge()
	session.Tick(3)
	if session.World.Tick != 11 || socket.packets != 11 || socket.sequence != 10 {
		t.Fatal("a catch-up batch must send only its completed state")
	}
	// Stop after nine unacknowledged snapshots, then send only current state.
	for i := 0; i < 10; i++ {
		session.Tick(1)
	}
	if socket.packets != 19 || len(player.pendingSnapshots) != 9 {
		t.Fatal("receipts must bound the window to nine snapshots")
	}
	session.Receive(protocol.Control{Type: "snapshotAck", Sequence: socket.sequence + 1}, socket)
	if len(player.pendingSnapshots) != 9 {
		t.Fatal("an unsent sequence cannot free capacity")
	}
	acknowledge()
	session.Tick(1)
	if socket.packets != 20 || socket.sequence != 19 || session.World.Tick != 22 {
		t.Fatal("acknowledging must resume snapshots on the next simulation tick")
	}
}

func TestSnapshotRoundTrips(t *testing.T) {
	catalog, err := specification.Load()
	if err != nil {
		t.Fatal(err)
	}
	for _, roundTrip := range []uint64{2, 6, 8, 18} {
		session := NewGameSession(25, catalog)
		socket := &benchmarkSocket{}
		session.Receive(protocol.Control{Type: "hello"}, socket)
		type receipt struct{ at, sequence uint64 }
		receipts := []receipt{{roundTrip, socket.sequence}}
		lateSnapshots := 0
		for tick := 0; tick < 90; tick++ {
			for len(receipts) > 0 && receipts[0].at <= session.World.Tick {
				session.Receive(protocol.Control{Type: "snapshotAck", Sequence: receipts[0].sequence}, socket)
				receipts = receipts[1:]
			}
			previous := socket.sequence
			session.Tick(1)
			if socket.sequence != previous {
				receipts = append(receipts, receipt{session.World.Tick + roundTrip, socket.sequence})
				if session.World.Tick > 60 {
					lateSnapshots++
				}
			}
		}
		player := session.playersBySocket[socket]
		if len(player.pendingSnapshots) > player.snapshotWindow {
			t.Fatal("receipts must bound pending snapshots")
		}
		if roundTrip <= 8 {
			if lateSnapshots != 30 || player.snapshotWindow != 9 {
				t.Fatalf("round trip %d: snapshots=%d", roundTrip, lateSnapshots)
			}
		} else if player.snapshotWindow != 2 {
			t.Fatal("slow receipts must keep two slots")
		}
	}
}

func TestInputsAcrossServerStall(t *testing.T) {
	catalog, err := specification.Load()
	if err != nil {
		t.Fatal(err)
	}
	session := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	session.Receive(protocol.Control{Type: "hello"}, socket)
	player := session.playersBySocket[socket]
	session.Receive(protocol.Control{Type: "snapshotAck", Sequence: socket.sequence}, socket)
	// These edges arrive while the server is stalled. Catch-up must apply them
	// on their own ticks, even when they are more than one catch-up batch ahead.
	session.Receive(protocol.Control{Type: "input", Tick: 10, Sequence: 1, Input: protocol.Input{Turn: 1}}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: 25, Sequence: 2, Input: protocol.Input{Turn: -1}}, socket)
	for tick := 0; tick < 34; tick++ {
		session.Tick(1)
		session.Receive(protocol.Control{Type: "snapshotAck", Sequence: socket.sequence}, socket)
		expected := float64(0)
		if tick >= 10 {
			expected = 1
		}
		if tick >= 25 {
			expected = -1
		}
		if player.ship.Turn != expected {
			t.Fatalf("tick %d: turn=%v, want %v", tick, player.ship.Turn, expected)
		}
	}
	if player.lastSequence != 2 {
		t.Fatal("catch-up must consume both control edges")
	}
}
