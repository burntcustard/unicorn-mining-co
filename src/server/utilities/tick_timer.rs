#[derive(Clone, Copy, Debug)]
pub struct TickTimerOptions {
    pub tick: u64,
    pub step: f64,
    pub interval: f64,
    pub interval_max: f64,
}

/// Schedule from the current simulation tick. Sampling is needed only for a range.
pub fn next_tick(options: TickTimerOptions, sample: impl FnOnce() -> f64) -> u64 {
    let mut delay = options.interval;
    if options.interval_max > delay {
        delay += sample() * (options.interval_max - delay);
    }
    options
        .tick
        .wrapping_add(1.max((delay / options.step).ceil() as u64))
}

pub fn tick_due(
    deadline: &mut u64,
    options: TickTimerOptions,
    sample: impl FnOnce() -> f64,
) -> bool {
    if options.tick < *deadline {
        return false;
    }
    *deadline = next_tick(options, sample);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missed_checks_schedule_from_current_tick() {
        let mut deadline = 9000;
        let mut options = TickTimerOptions {
            tick: 8999,
            step: 1.0 / 30.0,
            interval: 300.0,
            interval_max: 0.0,
        };
        assert!(!tick_due(&mut deadline, options, || unreachable!()));
        assert_eq!(deadline, 9000);
        options.tick = 27000;
        assert!(tick_due(&mut deadline, options, || unreachable!()));
        assert_eq!(deadline, 36000);
        assert!(!tick_due(&mut deadline, options, || unreachable!()));
    }

    #[test]
    fn randomized_range_and_minimum_step() {
        let options = TickTimerOptions {
            tick: 100,
            step: 1.0 / 30.0,
            interval: 120.0,
            interval_max: 300.0,
        };
        assert_eq!(next_tick(options, || 0.0), 3700);
        assert_eq!(next_tick(options, || 0.5), 6400);
        assert_eq!(next_tick(options, || 1.0_f64.next_down()), 9100);
        assert_eq!(
            next_tick(
                TickTimerOptions {
                    interval: 0.0,
                    interval_max: 0.0,
                    ..options
                },
                || unreachable!()
            ),
            101
        );
        assert_eq!(
            next_tick(
                TickTimerOptions {
                    step: 0.1,
                    interval: 0.15,
                    interval_max: 0.0,
                    ..options
                },
                || unreachable!()
            ),
            102
        );
    }
}
