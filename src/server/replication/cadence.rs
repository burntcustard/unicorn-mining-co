#[derive(Clone, Copy)]
pub(super) struct Cadence {
    pub(super) tick: u64,
    pub(super) previous: u64,
    pub(super) intervals: [i32; 2],
    pub(super) due: [bool; 2],
    pub(super) ballistic: i32,
    pub(super) masks: [u64; 2],
}

impl Cadence {
    pub(super) fn new(
        tick: u64,
        previous: u64,
        visible: i32,
        distant: i32,
        ballistic: i32,
    ) -> Self {
        let intervals = [distant, visible];
        let due = intervals.map(|interval| replication_due(tick, previous, interval));
        let mut masks = [0; 2];
        if (1..=64).contains(&ballistic) {
            for phase in 0..ballistic as u64 {
                for (index, interval) in intervals.into_iter().enumerate() {
                    if replication_due(
                        tick.wrapping_add(phase),
                        previous.wrapping_add(phase),
                        interval.max(ballistic),
                    ) {
                        masks[index] |= 1 << phase;
                    }
                }
            }
        }
        Self {
            tick,
            previous,
            intervals,
            due,
            ballistic,
            masks,
        }
    }

    pub(super) fn due(&self, id: i64, ballistic: bool, visible: bool) -> bool {
        let index = usize::from(visible);
        if !ballistic || self.ballistic <= 0 {
            return self.due[index];
        }
        let phase = (id % i64::from(self.ballistic)) as u64;
        if self.ballistic <= 64 && phase < 64 {
            return self.masks[index] & (1 << phase) != 0;
        }
        replication_due(
            self.tick.wrapping_add(phase),
            self.previous.wrapping_add(phase),
            self.intervals[index].max(self.ballistic),
        )
    }
}

pub(super) fn replication_due(tick: u64, previous: u64, interval: i32) -> bool {
    let interval = interval.max(1) as u64;
    if interval.is_power_of_two() {
        let mask = interval - 1;
        tick & mask == 0 || tick & !mask != previous & !mask
    } else {
        tick.is_multiple_of(interval) || tick / interval != previous / interval
    }
}
