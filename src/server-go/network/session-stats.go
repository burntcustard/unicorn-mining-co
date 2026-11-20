package network

import (
	"fmt"
	"strings"
	"time"
)

const (
	statsLagBuckets = 9
	// High-water receipt lag at which receipts are requested for every snapshot.
	statsPinnedLag = 6
	statsInterval  = 10 * time.Minute
)

// connectionStats holds plain per-connection counters for the disconnect log.
// Every update is a single increment or comparison on a path that already runs.
type connectionStats struct {
	connectedAt   time.Time
	connectedTick uint64
	endReason     string

	snapshots, directReplies, slowSnapshots   uint64
	snapshotBytes                             uint64
	maxSnapshotBytes                          int
	lastSnapshotTick, maxSnapshotGap          uint64
	windowStalls, bufferStalls, maxPending    uint64
	receiptsRequested, receiptsReceived       uint64
	lagSum, lagSamples, maxLag, joinLag       uint64
	highLagTick                               int64
	recoveries                                uint64
	inputs, lateInputs, farInputs, duplicates uint64
	compressedTicks                           uint64
	minLead, maxLead                          int64
	leadSeen                                  bool
}

// sessionTotals accumulates finished connections for the periodic summary.
// Rows are connections under a minute, up to ten minutes, and longer.
type sessionTotals struct {
	connections, receipts, snapshots uint64
	seconds                          float64
	lag                              [3][statsLagBuckets]uint64
}

func (s *GameSession) logf(format string, args ...any) {
	if s.statsLogf != nil {
		s.statsLogf(format, args...)
	}
}

func durationBucket(duration time.Duration) int {
	switch {
	case duration < time.Minute:
		return 0
	case duration < 10*time.Minute:
		return 1
	}

	return 2
}

func (s *GameSession) startStats(p *playerRecord) {
	p.stats = connectionStats{connectedAt: s.now(), connectedTick: s.World.Tick, endReason: "closed", highLagTick: -1}
}

func (s *GameSession) recordSnapshot(p *playerRecord, regular, requested bool, size int) {
	stats := &p.stats
	tick := s.World.Tick
	stats.snapshotBytes += uint64(size)
	stats.maxSnapshotBytes = max(stats.maxSnapshotBytes, size)
	stats.maxPending = max(stats.maxPending, uint64(len(p.pendingSnapshots)))

	if requested {
		stats.receiptsRequested++
	}

	if !regular {
		stats.directReplies++
		return
	}

	// The first gap is the time spent joining, not a delivery gap.
	if stats.snapshots > 0 && tick > stats.lastSnapshotTick {
		stats.maxSnapshotGap = max(stats.maxSnapshotGap, tick-stats.lastSnapshotTick)
	}

	stats.snapshots++
	stats.lastSnapshotTick = tick

	if p.snapshotWindow == 2 {
		stats.slowSnapshots++
	}
}

func (s *GameSession) recordLag(p *playerRecord, lag int64) {
	stats := &p.stats
	lag = max(0, lag)
	stats.lagSum += uint64(lag)
	stats.lagSamples++
	stats.maxLag = max(stats.maxLag, uint64(lag))

	if s.joining(p) {
		stats.joinLag = max(stats.joinLag, uint64(lag))
		return
	}

	if lag >= statsPinnedLag && stats.highLagTick < 0 {
		stats.highLagTick = int64(s.World.Tick - stats.connectedTick)
	}
}

func (s *GameSession) recordInputLead(p *playerRecord, lead int64) {
	stats := &p.stats

	if !stats.leadSeen {
		stats.minLead, stats.maxLead, stats.leadSeen = lead, lead, true
		return
	}

	stats.minLead, stats.maxLead = min(stats.minLead, lead), max(stats.maxLead, lead)
}

func (s *GameSession) finishStats(p *playerRecord) {
	stats := &p.stats

	if stats.connectedAt.IsZero() {
		return
	}

	// Authenticated connections that never received a snapshot are not sessions.
	defer func() { stats.connectedAt = time.Time{} }()

	if stats.snapshots == 0 {
		return
	}

	duration := s.now().Sub(stats.connectedAt)
	ticks := s.World.Tick - stats.connectedTick
	seconds := duration.Seconds()
	meanLag := 0.0

	if stats.lagSamples > 0 {
		meanLag = float64(stats.lagSum) / float64(stats.lagSamples)
	}

	highLagSeconds := -1.0

	if stats.highLagTick >= 0 {
		highLagSeconds = float64(stats.highLagTick) * s.World.Specification.Simulation.SimulationStep
	}

	totals := &s.statsTotals
	totals.connections++
	totals.receipts += stats.receiptsReceived
	totals.snapshots += stats.snapshots
	totals.seconds += seconds
	totals.lag[durationBucket(duration)][min(p.receiptLag, statsLagBuckets-1)]++

	if s.statsLogf != nil {
		step := s.World.Specification.Simulation.SimulationStep
		s.logf("connection-stats reason=%s seconds=%.1f ticks=%d players=%d snapshots=%d direct=%d slow=%d "+
			"snapshot_bytes=%d max_snapshot_bytes=%d max_gap_ms=%.1f window_stalls=%d buffer_stalls=%d max_pending=%d "+
			"receipts=%d receipt_requests=%d mean_lag=%.2f max_lag=%d join_lag=%d held_lag=%d high_lag_s=%.1f recoveries=%d "+
			"inputs=%d late=%d far=%d duplicates=%d compressed=%d lead_min=%d lead_max=%d",
			stats.endReason, seconds, ticks, len(s.playersBySocket), stats.snapshots, stats.directReplies, stats.slowSnapshots,
			stats.snapshotBytes, stats.maxSnapshotBytes, float64(stats.maxSnapshotGap)*step*1000, stats.windowStalls, stats.bufferStalls, stats.maxPending,
			stats.receiptsReceived, stats.receiptsRequested, meanLag, stats.maxLag, stats.joinLag, p.receiptLag, highLagSeconds, stats.recoveries,
			stats.inputs, stats.lateInputs, stats.farInputs, stats.duplicates, stats.compressedTicks, stats.minLead, stats.maxLead)
	}
}

func formatLagBuckets(row [statsLagBuckets]uint64) string {
	parts := make([]string, len(row))

	for i, count := range row {
		parts[i] = fmt.Sprint(count)
	}

	return strings.Join(parts, ",")
}

// logTotals prints finished-connection totals plus the lag distribution of
// connections still open, which covers long sessions that have not ended yet.
func (s *GameSession) logTotals() {
	if s.statsLogf == nil {
		return
	}

	var live [3][statsLagBuckets]uint64
	now := s.now()

	for _, p := range s.playersBySocket {
		if !p.stats.connectedAt.IsZero() {
			live[durationBucket(now.Sub(p.stats.connectedAt))][min(p.receiptLag, statsLagBuckets-1)]++
		}
	}

	totals := &s.statsTotals
	rate := 0.0

	if totals.seconds > 0 {
		rate = float64(totals.receipts) / totals.seconds
	}

	s.logf("server-stats pinned_lag=%d ended=%d receipts_per_s=%.2f snapshots=%d open=%d "+
		"ended_lag_lt1m=%s ended_lag_1m_10m=%s ended_lag_gt10m=%s open_lag_lt1m=%s open_lag_1m_10m=%s open_lag_gt10m=%s",
		statsPinnedLag, totals.connections, rate, totals.snapshots, len(s.playersBySocket),
		formatLagBuckets(totals.lag[0]), formatLagBuckets(totals.lag[1]), formatLagBuckets(totals.lag[2]),
		formatLagBuckets(live[0]), formatLagBuckets(live[1]), formatLagBuckets(live[2]))
	s.logLoad()
}
