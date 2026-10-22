package network

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"strings"
	"testing"
	"time"
)

func TestConnectionStatsLog(t *testing.T) {
	t.Parallel()
	session, player, socket := lateInputSession(t)
	var lines []string

	session.statsLogf = func(format string, args ...any) { lines = append(lines, fmt.Sprintf(format, args...)) }

	clock := time.Unix(100000, 0)

	session.now = func() time.Time { return clock }

	session.startStats(player)

	step := session.World.Specification.Simulation.SimulationStep

	for range 90 {
		clock = clock.Add(time.Duration(step * float64(time.Second)))
		session.Tick(1)
		socket.acknowledge(session)
	}

	tick := session.World.Tick
	session.Receive(protocol.Control{Type: "input", Tick: tick + 1, Sequence: 1, Input: protocol.Input{Thrust: 1}}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: tick - 1, Sequence: 2, Input: protocol.Input{}}, socket)
	session.Receive(protocol.Control{Type: "input", Tick: tick + 1, Sequence: 2, Input: protocol.Input{}}, socket)

	player.stats.endReason = "test"
	session.Disconnect(socket)
	session.Disconnect(socket)

	if len(lines) != 1 {
		t.Fatalf("expected one connection line, got %d: %v", len(lines), lines)
	}

	for _, want := range []string{"reason=test", "inputs=3", "late=1", "duplicates=1", "far=0", "high_lag_s=-1.0", "window_stalls=0", "players=1"} {
		if !strings.Contains(lines[0], want) {
			t.Errorf("missing %q in %s", want, lines[0])
		}
	}

	if player.stats.snapshots < 80 || player.stats.receiptsReceived == 0 || player.stats.receiptsReceived >= player.stats.snapshots || player.stats.receiptsRequested == 0 {
		t.Errorf("unexpected snapshot or receipt counts: %+v", player.stats)
	}

	if player.stats.lagSamples == 0 || player.stats.maxSnapshotGap != 1 {
		t.Errorf("unexpected lag or gap: %+v", player.stats)
	}

	lines = nil
	session.logTotals()

	if len(lines) != 1 || !strings.Contains(lines[0], "ended=1") || !strings.Contains(lines[0], "open=0") || !strings.Contains(lines[0], "ended_lag_lt1m=") {
		t.Fatalf("unexpected totals line: %v", lines)
	}
}

func TestConnectionStatsHighLagAndRecovery(t *testing.T) {
	t.Parallel()
	session, player, socket := lateInputSession(t)
	session.startStats(player)

	for range 20 {
		session.Tick(1)
	}

	// Receipts are cumulative, so acknowledging the oldest requested snapshot
	// is a slow round trip even though newer snapshots were sent.
	var oldest uint64

	for _, snapshot := range player.pendingSnapshots {
		if snapshot.requested {
			oldest = snapshot.sequence
			break
		}
	}

	session.Receive(protocol.Control{Type: "snapshotAck", Sequence: oldest}, socket)

	if player.stats.maxLag < statsPinnedLag || player.stats.highLagTick < 0 || player.stats.recoveries != 1 {
		t.Fatalf("expected high lag and one recovery: %+v", player.stats)
	}
}

func TestConnectionStatsOpenConnectionsInTotals(t *testing.T) {
	t.Parallel()
	session, _, _ := lateInputSession(t)
	var lines []string

	session.statsLogf = func(format string, args ...any) { lines = append(lines, fmt.Sprintf(format, args...)) }

	session.Receive(protocol.Control{Type: "hello"}, &benchmarkSocket{})
	session.logTotals()

	if len(lines) != 1 || !strings.Contains(lines[0], "open=2") {
		t.Fatalf("expected one totals line with two open connections: %v", lines)
	}
}
