package network

import (
	"runtime"
	"time"
)

// tickStats measures each Tick call. A call covering several ticks means the
// loop fell behind its schedule.
type tickStats struct {
	calls, ticks, over, catchups, catchupTicks uint64
	sum, max                                   time.Duration
}

// loadBaseline is the process state at the previous server-load line.
type loadBaseline struct {
	at       time.Time
	cpu      float64
	ticks    uint64
	gcCycles uint32
	gcPause  uint64
}

func (s *GameSession) recordTick(elapsed time.Duration, ticks uint64) {
	stats := &s.tickStats
	stats.calls++
	stats.ticks += ticks
	stats.sum += elapsed
	stats.max = max(stats.max, elapsed)

	if elapsed.Seconds() > s.World.Specification.Simulation.SimulationStep {
		stats.over++
	}

	if ticks > 1 {
		stats.catchups++
		stats.catchupTicks += ticks - 1
	}
}

func (s *GameSession) startLoadStats() {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	s.loadSince = loadBaseline{at: time.Now(), cpu: processCPUSeconds(), gcCycles: memory.NumGC, gcPause: memory.PauseTotalNs}
	s.tickStats = tickStats{}
}

// logLoad reports process CPU, tick duration and garbage collection since the
// previous call, so server cost and stalls can be read beside connection lag.
func (s *GameSession) logLoad() {
	if s.loadSince.at.IsZero() {
		s.startLoadStats()
		return
	}

	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	now := time.Now()
	cpu := processCPUSeconds()
	ticks := &s.tickStats
	wall := now.Sub(s.loadSince.at).Seconds()
	cpuSeconds := cpu - s.loadSince.cpu
	cpuPerTick, mean := 0.0, 0.0

	if ticks.ticks > 0 {
		cpuPerTick = cpuSeconds * 1000 / float64(ticks.ticks)
	}

	if ticks.calls > 0 {
		mean = ticks.sum.Seconds() * 1000 / float64(ticks.calls)
	}

	s.logf("server-load interval_s=%.0f cpu_s=%.2f cpu_percent=%.2f cpu_ms_per_tick=%.4f ticks=%d tick_mean_ms=%.3f tick_max_ms=%.2f "+
		"ticks_over_step=%d catchups=%d catchup_ticks=%d gc_cycles=%d gc_pause_ms=%.2f heap_mib=%.1f players=%d",
		wall, cpuSeconds, 100*cpuSeconds/max(wall, 1e-9), cpuPerTick, ticks.ticks, mean, ticks.max.Seconds()*1000,
		ticks.over, ticks.catchups, ticks.catchupTicks, memory.NumGC-s.loadSince.gcCycles, float64(memory.PauseTotalNs-s.loadSince.gcPause)/1e6,
		float64(memory.HeapAlloc)/(1<<20), len(s.playersBySocket))

	s.loadSince = loadBaseline{at: now, cpu: cpu, gcCycles: memory.NumGC, gcPause: memory.PauseTotalNs}
	s.tickStats = tickStats{}
}
