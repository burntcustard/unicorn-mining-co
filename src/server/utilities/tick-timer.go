package utilities

import (
	"math"
	"math/rand/v2"
)

type TickTimerOptions struct {
	Tick                        uint64
	Step, Interval, IntervalMax float64
}

/*
NextTick schedules a fixed or uniformly randomized simulation-time delay.
No wall-clock callbacks run while the simulation is paused. A delayed check
schedules from the current tick rather than replaying missed checks.
*/
func NextTick(options TickTimerOptions) uint64 {
	delay := options.Interval

	if options.IntervalMax > delay {
		delay += rand.Float64() * (options.IntervalMax - delay)
	}

	return options.Tick + max(1, uint64(math.Ceil(delay/options.Step)))
}

/*
TickDue advances a due clock once. The caller owns and persists its deadline.
*/
func TickDue(deadline *uint64, options TickTimerOptions) bool {
	if options.Tick < *deadline {
		return false
	}

	*deadline = NextTick(options)
	return true
}
