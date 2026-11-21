use std::fmt;
use std::io;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug)]
pub struct ProcessSample {
    pub cpu_seconds: f64,
    pub resident_bytes: Option<u64>,
}

impl ProcessSample {
    pub fn capture() -> io::Result<Self> {
        Ok(Self {
            cpu_seconds: process_cpu_seconds()?,
            resident_bytes: resident_bytes(),
        })
    }
}

#[cfg(unix)]
fn process_cpu_seconds() -> io::Result<f64> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: getrusage writes the process counters into a valid rusage allocation.
    let result = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: The allocation was initialized with zeros and getrusage succeeded.
    let usage = unsafe { usage.assume_init() };
    Ok(usage.ru_utime.tv_sec as f64
        + usage.ru_utime.tv_usec as f64 / 1e6
        + usage.ru_stime.tv_sec as f64
        + usage.ru_stime.tv_usec as f64 / 1e6)
}

#[cfg(not(unix))]
fn process_cpu_seconds() -> io::Result<f64> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "process CPU timing requires Unix",
    ))
}

#[cfg(target_os = "linux")]
fn resident_bytes() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|line| {
        let size = line
            .strip_prefix("VmRSS:")?
            .split_whitespace()
            .next()?
            .parse::<u64>()
            .ok()?;
        size.checked_mul(1024)
    })
}

#[cfg(not(target_os = "linux"))]
fn resident_bytes() -> Option<u64> {
    None
}

#[derive(Clone, Copy, Debug, Default)]
struct TickMeasurements {
    calls: u64,
    ticks: u64,
    over: u64,
    catchups: u64,
    catchup_ticks: u64,
    sum: Duration,
    max: Duration,
}

#[derive(Clone, Copy, Debug, Default)]
struct SaveMeasurements {
    batches: u64,
    players: u64,
    entities: u64,
    capture: Duration,
    max_capture: Duration,
}

pub struct ServerLoadStats {
    tick: TickMeasurements,
    save: SaveMeasurements,
    started: Instant,
    baseline: ProcessSample,
}

impl ServerLoadStats {
    pub fn start() -> io::Result<Self> {
        Ok(Self::new(Instant::now(), ProcessSample::capture()?))
    }

    pub fn new(now: Instant, sample: ProcessSample) -> Self {
        Self {
            tick: TickMeasurements::default(),
            save: SaveMeasurements::default(),
            started: now,
            baseline: sample,
        }
    }

    pub fn record_tick(&mut self, elapsed: Duration, ticks: u64, simulation_step: f64) {
        self.tick.calls += 1;
        self.tick.ticks += ticks;
        self.tick.sum += elapsed;
        self.tick.max = self.tick.max.max(elapsed);
        self.tick.over += u64::from(elapsed.as_secs_f64() > simulation_step);
        if ticks > 1 {
            self.tick.catchups += 1;
            self.tick.catchup_ticks += ticks - 1;
        }
    }

    pub fn record_save(&mut self, elapsed: Duration, players: u64, entities: u64) {
        self.save.batches += 1;
        self.save.players += players;
        self.save.entities += entities;
        self.save.capture += elapsed;
        self.save.max_capture = self.save.max_capture.max(elapsed);
    }

    pub fn capture_interval(&mut self, players: usize) -> io::Result<ServerLoadReport> {
        let now = Instant::now();
        let sample = ProcessSample::capture()?;
        Ok(self.finish_interval(now, sample, players))
    }

    pub fn finish_interval(
        &mut self,
        now: Instant,
        sample: ProcessSample,
        players: usize,
    ) -> ServerLoadReport {
        let duration = now.saturating_duration_since(self.started);
        let cpu_seconds = sample.cpu_seconds - self.baseline.cpu_seconds;
        self.started = now;
        self.baseline = sample;
        ServerLoadReport {
            duration,
            cpu_seconds,
            resident_bytes: sample.resident_bytes,
            players,
            tick: std::mem::take(&mut self.tick),
            save: std::mem::take(&mut self.save),
        }
    }
}

pub struct ServerLoadReport {
    duration: Duration,
    cpu_seconds: f64,
    resident_bytes: Option<u64>,
    players: usize,
    tick: TickMeasurements,
    save: SaveMeasurements,
}

impl fmt::Display for ServerLoadReport {
    fn fmt(&self, output: &mut fmt::Formatter<'_>) -> fmt::Result {
        let wall = self.duration.as_secs_f64();
        let cpu_percent = 100.0 * self.cpu_seconds / wall.max(1e-9);
        let cpu_per_tick = if self.tick.ticks > 0 {
            self.cpu_seconds * 1000.0 / self.tick.ticks as f64
        } else {
            0.0
        };
        let mean = if self.tick.calls > 0 {
            self.tick.sum.as_secs_f64() * 1000.0 / self.tick.calls as f64
        } else {
            0.0
        };

        write!(
            output,
            "server-load interval_s={wall:.0} cpu_s={:.2} cpu_percent={cpu_percent:.2} cpu_ms_per_tick={cpu_per_tick:.4} \
             ticks={} tick_mean_ms={mean:.3} tick_max_ms={:.2} ticks_over_step={} catchups={} catchup_ticks={} \
             gc_cycles=0 gc_pause_ms=0.00",
            self.cpu_seconds,
            self.tick.ticks,
            self.tick.max.as_secs_f64() * 1000.0,
            self.tick.over,
            self.tick.catchups,
            self.tick.catchup_ticks,
        )?;
        if let Some(bytes) = self.resident_bytes {
            write!(output, " rss_mib={:.1}", bytes as f64 / (1 << 20) as f64)?;
        }
        write!(
            output,
            " players={} save_batches={} save_players={} save_entities={} save_capture_ms={:.2} save_capture_max_ms={:.2}",
            self.players,
            self.save.batches,
            self.save.players,
            self.save.entities,
            self.save.capture.as_secs_f64() * 1000.0,
            self.save.max_capture.as_secs_f64() * 1000.0,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_report_uses_cpu_time_per_tick_and_resets_interval_counters() {
        let start = Instant::now();
        let mut stats = ServerLoadStats::new(
            start,
            ProcessSample {
                cpu_seconds: 4.0,
                resident_bytes: None,
            },
        );
        let step = 1.0 / 30.0;
        for _ in 0..10 {
            stats.record_tick(Duration::from_millis(2), 1, step);
        }
        stats.record_tick(Duration::from_millis(50), 3, step);
        stats.record_save(Duration::from_millis(4), 2, 8);
        stats.record_save(Duration::from_millis(6), 0, 2);
        let report = stats
            .finish_interval(
                start + Duration::from_secs(10),
                ProcessSample {
                    cpu_seconds: 5.0,
                    resident_bytes: Some(32 << 20),
                },
                1,
            )
            .to_string();
        for field in [
            "interval_s=10",
            "cpu_s=1.00",
            "cpu_percent=10.00",
            "cpu_ms_per_tick=76.9231",
            "ticks=13",
            "tick_mean_ms=6.364",
            "tick_max_ms=50.00",
            "ticks_over_step=1",
            "catchups=1",
            "catchup_ticks=2",
            "gc_cycles=0",
            "rss_mib=32.0",
            "players=1",
            "save_batches=2",
            "save_players=2",
            "save_entities=10",
            "save_capture_ms=10.00",
            "save_capture_max_ms=6.00",
        ] {
            assert!(report.contains(field), "missing {field} in {report}");
        }

        let next = stats
            .finish_interval(
                start + Duration::from_secs(14),
                ProcessSample {
                    cpu_seconds: 7.0,
                    resident_bytes: None,
                },
                0,
            )
            .to_string();
        assert!(next.contains("interval_s=4 cpu_s=2.00"));
        assert!(next.contains("ticks=0"));
        assert!(next.contains("save_batches=0"));
        assert!(!next.contains("rss_mib="));
    }

    #[cfg(unix)]
    #[test]
    fn captures_this_process_cpu_time() {
        let before = ProcessSample::capture().unwrap();
        let after = ProcessSample::capture().unwrap();
        assert!(after.cpu_seconds >= before.cpu_seconds);
        assert!(before.cpu_seconds >= 0.0);
    }
}
