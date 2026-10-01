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
	// Unacknowledged snapshots still bound the queue, then resume on the next tick.
	session.Tick(1)
	session.Tick(1)
	if socket.packets != 12 || len(player.pendingSnapshots) != 2 {
		t.Fatal("snapshot receipt window must bound pending state")
	}
	acknowledge()
	session.Tick(1)
	if socket.packets != 13 || socket.sequence != 12 || session.World.Tick != 14 {
		t.Fatal("acknowledging must resume snapshots on the next simulation tick")
	}
}
