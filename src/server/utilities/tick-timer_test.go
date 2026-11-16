package utilities

import "testing"

func TestTickTimerDoesNotReplayMissedChecks(t *testing.T) {
	deadline := uint64(9000)
	options := TickTimerOptions{Tick: 8999, Step: 1.0 / 30, Interval: 300}

	if TickDue(&deadline, options) || deadline != 9000 {
		t.Fatal("early calls must preserve the deadline")
	}

	options.Tick = 27000

	if !TickDue(&deadline, options) || deadline != 36000 {
		t.Fatal("late calls must schedule once from the current tick")
	}

	if TickDue(&deadline, options) {
		t.Fatal("repeated calls in the same tick must not fire")
	}
}

func TestTickTimerRandomRangeAndMinimumStep(t *testing.T) {
	options := TickTimerOptions{Tick: 100, Step: 1.0 / 30, Interval: 120, IntervalMax: 300}

	for range 100 {
		next := NextTick(options)

		if next < 3700 || next > 9100 {
			t.Fatal("randomized deadlines must remain within their configured range")
		}
	}

	if next := NextTick(TickTimerOptions{Tick: 100, Step: 1.0 / 30}); next != 101 {
		t.Fatal("zero delays must still advance the clock")
	}

	if next := NextTick(TickTimerOptions{Tick: 100, Step: .1, Interval: .15}); next != 102 {
		t.Fatal("fractional delays must round up to avoid firing early")
	}
}
