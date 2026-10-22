package network

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"testing"
)

func BenchmarkReceiveSnapshotAck(b *testing.B) {
	catalog, err := specs.Load()

	if err != nil {
		b.Fatal(err)
	}

	session := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	session.Receive(protocol.Control{Type: "hello"}, socket)
	player := session.playersBySocket[socket]
	session.Tick(30)
	player.joinUntil = 1
	b.ReportAllocs()

	for i := 0; b.Loop(); i++ {
		sequence := uint64(i + 1)
		player.pendingSnapshots = append(player.pendingSnapshots[:0], pendingSnapshot{sequence: sequence, tick: int64(session.World.Tick) - 2, requested: true, window: 9})
		session.Receive(protocol.Control{Type: "snapshotAck", Sequence: sequence}, socket)
	}
}
