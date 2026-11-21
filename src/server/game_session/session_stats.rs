use std::fmt;
use std::time::{Duration, Instant};

use super::{InputDisposition, InputReceipt, SnapshotDelivery, SnapshotReceipt, SnapshotStall};

const LAG_BUCKETS: usize = 9;
const PINNED_LAG: u64 = 6;
const STATS_INTERVAL: Duration = Duration::from_secs(10 * 60);

pub fn stats_due(tick: u64, ticks: u64, step: f64) -> bool {
    let every = (STATS_INTERVAL.as_secs_f64() / step) as u64;
    every > 0 && (tick.is_multiple_of(every) || tick % every + ticks > every)
}

fn duration_bucket(duration: Duration) -> usize {
    match duration.as_secs() {
        0..=59 => 0,
        60..=599 => 1,
        _ => 2,
    }
}

pub struct FinishedConnection {
    pub now: Instant,
    pub tick: u64,
    pub simulation_step: f64,
    pub active_connections: usize,
    pub held_lag: usize,
}

pub struct SnapshotSample {
    pub tick: u64,
    pub regular: bool,
    pub requested: bool,
    pub bytes: usize,
}

pub struct ConnectionStats {
    connected_at: Option<Instant>,
    connected_tick: u64,
    end_reason: &'static str,
    snapshots: u64,
    direct_replies: u64,
    slow_snapshots: u64,
    snapshot_bytes: u64,
    max_snapshot_bytes: usize,
    last_snapshot_tick: u64,
    max_snapshot_gap: u64,
    window_stalls: u64,
    buffer_stalls: u64,
    max_pending: usize,
    receipts_requested: u64,
    receipts_received: u64,
    lag_sum: u64,
    lag_samples: u64,
    max_lag: u64,
    join_lag: u64,
    high_lag_tick: Option<u64>,
    recoveries: u64,
    inputs: u64,
    late_inputs: u64,
    far_inputs: u64,
    duplicates: u64,
    compressed_ticks: u64,
    input_lead_range: Option<(i64, i64)>,
}

impl ConnectionStats {
    pub fn new(now: Instant, tick: u64) -> Self {
        Self {
            connected_at: Some(now),
            connected_tick: tick,
            end_reason: "closed",
            snapshots: 0,
            direct_replies: 0,
            slow_snapshots: 0,
            snapshot_bytes: 0,
            max_snapshot_bytes: 0,
            last_snapshot_tick: 0,
            max_snapshot_gap: 0,
            window_stalls: 0,
            buffer_stalls: 0,
            max_pending: 0,
            receipts_requested: 0,
            receipts_received: 0,
            lag_sum: 0,
            lag_samples: 0,
            max_lag: 0,
            join_lag: 0,
            high_lag_tick: None,
            recoveries: 0,
            inputs: 0,
            late_inputs: 0,
            far_inputs: 0,
            duplicates: 0,
            compressed_ticks: 0,
            input_lead_range: None,
        }
    }

    pub fn set_end_reason(&mut self, reason: &'static str) {
        self.end_reason = reason;
    }

    pub fn record_snapshot(&mut self, delivery: &SnapshotDelivery, sample: SnapshotSample) {
        self.snapshot_bytes += sample.bytes as u64;
        self.max_snapshot_bytes = self.max_snapshot_bytes.max(sample.bytes);
        self.max_pending = self.max_pending.max(delivery.pending_count());
        self.receipts_requested += u64::from(sample.requested);
        if !sample.regular {
            self.direct_replies += 1;
            return;
        }

        // Timing starts at the first regular snapshot, after the load.
        if self.snapshots > 0 {
            self.max_snapshot_gap = self
                .max_snapshot_gap
                .max(sample.tick.saturating_sub(self.last_snapshot_tick));
        }
        self.snapshots += 1;
        self.last_snapshot_tick = sample.tick;
        self.slow_snapshots += u64::from(delivery.window() == 2);
    }

    pub fn record_stall(&mut self, stall: SnapshotStall) {
        match stall {
            SnapshotStall::Buffer => self.buffer_stalls += 1,
            SnapshotStall::Window => self.window_stalls += 1,
            SnapshotStall::SocketLimit => {}
        }
    }

    pub fn record_receipt(&mut self, tick: u64, receipt: SnapshotReceipt) {
        self.receipts_received += 1;
        self.recoveries += u64::from(receipt.recovery_started);
        let Some(lag) = receipt.lag else {
            return;
        };

        let lag = lag.max(0) as u64;
        self.lag_sum += lag;
        self.lag_samples += 1;
        self.max_lag = self.max_lag.max(lag);
        if receipt.joining {
            self.join_lag = self.join_lag.max(lag);
        } else if lag >= PINNED_LAG && self.high_lag_tick.is_none() {
            self.high_lag_tick = Some(tick.wrapping_sub(self.connected_tick));
        }
    }

    pub fn record_input(&mut self, receipt: InputReceipt) {
        self.inputs += 1;
        match receipt.disposition {
            InputDisposition::Queued => {}
            InputDisposition::Duplicate => self.duplicates += 1,
            InputDisposition::Late => self.late_inputs += 1,
            InputDisposition::FutureFallback => self.far_inputs += 1,
        }
        let (minimum, maximum) = self
            .input_lead_range
            .unwrap_or((receipt.lead, receipt.lead));
        self.input_lead_range = Some((minimum.min(receipt.lead), maximum.max(receipt.lead)));
    }

    pub fn record_compression(&mut self, ticks: u64) {
        self.compressed_ticks += ticks;
    }

    pub fn finish(
        &mut self,
        finished: FinishedConnection,
        totals: &mut SessionTotals,
    ) -> Option<ConnectionReport<'_>> {
        let connected_at = self.connected_at.take()?;
        if self.snapshots == 0 {
            return None;
        }

        let duration = finished.now.saturating_duration_since(connected_at);
        totals.connections += 1;
        totals.receipts += self.receipts_received;
        totals.snapshots += self.snapshots;
        totals.duration += duration;
        totals.lag[duration_bucket(duration)][finished.held_lag.min(LAG_BUCKETS - 1)] += 1;

        Some(ConnectionReport {
            stats: self,
            connection: finished,
            duration,
        })
    }
}

pub struct ConnectionReport<'a> {
    stats: &'a ConnectionStats,
    connection: FinishedConnection,
    duration: Duration,
}

impl fmt::Display for ConnectionReport<'_> {
    fn fmt(&self, output: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = self.stats;
        let c = &self.connection;
        let mean_lag = if s.lag_samples > 0 {
            s.lag_sum as f64 / s.lag_samples as f64
        } else {
            0.0
        };
        let high_lag = s
            .high_lag_tick
            .map_or(-1.0, |tick| tick as f64 * c.simulation_step);
        let (min_lead, max_lead) = s.input_lead_range.unwrap_or_default();

        write!(
            output,
            "connection-stats reason={} seconds={:.1} ticks={} players={} snapshots={} direct={} slow={} \
             snapshot_bytes={} max_snapshot_bytes={} max_gap_ms={:.1} window_stalls={} buffer_stalls={} max_pending={} \
             receipts={} receipt_requests={} mean_lag={:.2} max_lag={} join_lag={} held_lag={} high_lag_s={:.1} recoveries={} \
             inputs={} late={} far={} duplicates={} compressed={} lead_min={} lead_max={}",
            s.end_reason,
            self.duration.as_secs_f64(),
            c.tick.wrapping_sub(s.connected_tick),
            c.active_connections,
            s.snapshots,
            s.direct_replies,
            s.slow_snapshots,
            s.snapshot_bytes,
            s.max_snapshot_bytes,
            s.max_snapshot_gap as f64 * c.simulation_step * 1000.0,
            s.window_stalls,
            s.buffer_stalls,
            s.max_pending,
            s.receipts_received,
            s.receipts_requested,
            mean_lag,
            s.max_lag,
            s.join_lag,
            c.held_lag,
            high_lag,
            s.recoveries,
            s.inputs,
            s.late_inputs,
            s.far_inputs,
            s.duplicates,
            s.compressed_ticks,
            min_lead,
            max_lead
        )
    }
}

#[derive(Default)]
pub struct SessionTotals {
    connections: u64,
    receipts: u64,
    snapshots: u64,
    duration: Duration,
    lag: [[u64; LAG_BUCKETS]; 3],
}

pub struct OpenConnection<'a> {
    pub stats: &'a ConnectionStats,
    pub held_lag: usize,
}

impl SessionTotals {
    pub fn report<'a>(
        &self,
        now: Instant,
        connections: impl IntoIterator<Item = OpenConnection<'a>>,
    ) -> SessionTotalsReport<'_> {
        let mut open = 0;
        let mut live = [[0; LAG_BUCKETS]; 3];
        for connection in connections {
            open += 1;
            if let Some(started) = connection.stats.connected_at {
                let duration = now.saturating_duration_since(started);
                live[duration_bucket(duration)][connection.held_lag.min(LAG_BUCKETS - 1)] += 1;
            }
        }
        SessionTotalsReport {
            totals: self,
            open,
            live,
        }
    }
}

pub struct SessionTotalsReport<'a> {
    totals: &'a SessionTotals,
    open: usize,
    live: [[u64; LAG_BUCKETS]; 3],
}

struct LagBuckets([u64; LAG_BUCKETS]);

impl fmt::Display for LagBuckets {
    fn fmt(&self, output: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (index, count) in self.0.iter().enumerate() {
            if index > 0 {
                output.write_str(",")?;
            }
            write!(output, "{count}")?;
        }
        Ok(())
    }
}

impl fmt::Display for SessionTotalsReport<'_> {
    fn fmt(&self, output: &mut fmt::Formatter<'_>) -> fmt::Result {
        let totals = self.totals;
        let rate = if totals.duration.is_zero() {
            0.0
        } else {
            totals.receipts as f64 / totals.duration.as_secs_f64()
        };
        write!(
            output,
            "server-stats pinned_lag={PINNED_LAG} ended={} receipts_per_s={rate:.2} snapshots={} open={} \
             ended_lag_lt1m={} ended_lag_1m_10m={} ended_lag_gt10m={} open_lag_lt1m={} open_lag_1m_10m={} open_lag_gt10m={}",
            totals.connections,
            totals.snapshots,
            self.open,
            LagBuckets(totals.lag[0]),
            LagBuckets(totals.lag[1]),
            LagBuckets(totals.lag[2]),
            LagBuckets(self.live[0]),
            LagBuckets(self.live[1]),
            LagBuckets(self.live[2]),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_session::SnapshotRequest;

    const STEP: f64 = 1.0 / 30.0;

    #[test]
    fn connection_log_counts_delivered_snapshots_receipts_and_input_leads() {
        let clock = Instant::now();
        let mut stats = ConnectionStats::new(clock, 1);
        let mut delivery = SnapshotDelivery::default();
        let mut totals = SessionTotals::default();
        let mut requested = None;

        for tick in 1..=91 {
            if let Some(sequence) = requested.take() {
                let receipt = delivery.acknowledge(sequence, tick, STEP).unwrap();
                stats.record_receipt(tick, receipt);
            }

            let regular = tick != 1;
            let prepared = delivery
                .prepare(SnapshotRequest {
                    tick,
                    step: STEP,
                    regular,
                    buffered_bytes: 0,
                    dock_sequence: 0,
                })
                .unwrap();
            let plan = prepared.plan();
            prepared.commit();
            requested = plan.receipt_sequence;
            stats.record_snapshot(
                &delivery,
                SnapshotSample {
                    tick,
                    regular,
                    requested: requested.is_some(),
                    bytes: 128,
                },
            );
        }

        for (lead, disposition) in [
            (1, InputDisposition::Queued),
            (-1, InputDisposition::Late),
            (1, InputDisposition::Duplicate),
        ] {
            stats.record_input(InputReceipt { lead, disposition });
        }
        stats.set_end_reason("test");
        let finished = FinishedConnection {
            now: clock + Duration::from_secs(3),
            tick: 91,
            simulation_step: STEP,
            active_connections: 1,
            held_lag: delivery.receipt_lag(),
        };
        let line = stats.finish(finished, &mut totals).unwrap().to_string();

        for field in [
            "reason=test",
            "ticks=90",
            "players=1",
            "snapshots=90",
            "direct=1",
            "inputs=3",
            "late=1",
            "far=0",
            "duplicates=1",
            "lead_min=-1",
            "lead_max=1",
            "high_lag_s=-1.0",
            "window_stalls=0",
            "max_gap_ms=33.3",
        ] {
            assert!(line.contains(field), "missing {field} in {line}");
        }
        assert!(stats.receipts_received > 0 && stats.receipts_received < stats.snapshots);
        assert!(stats.lag_samples > 0);
        assert!(
            stats
                .finish(
                    FinishedConnection {
                        now: clock + Duration::from_secs(3),
                        tick: 91,
                        simulation_step: STEP,
                        active_connections: 1,
                        held_lag: delivery.receipt_lag(),
                    },
                    &mut totals
                )
                .is_none()
        );

        let line = totals
            .report(clock + Duration::from_secs(3), [])
            .to_string();
        assert!(line.contains("ended=1"));
        assert!(line.contains("open=0"));
        assert!(line.contains("ended_lag_lt1m=1,0,0,0,0,0,0,0,0"));
    }

    #[test]
    fn live_totals_keep_duration_buckets_and_join_lag_is_reported_separately() {
        let start = Instant::now();
        let mut older = ConnectionStats::new(start, 0);
        older.record_receipt(
            20,
            SnapshotReceipt {
                dock_sequence: 0,
                lag: Some(20),
                joining: true,
                recovery_started: true,
            },
        );

        assert_eq!(older.join_lag, 20);
        assert_eq!(older.max_lag, 20);
        assert_eq!(older.high_lag_tick, None);
        assert_eq!(older.recoveries, 1);
        older.record_receipt(
            321,
            SnapshotReceipt {
                dock_sequence: 0,
                lag: Some(6),
                joining: false,
                recovery_started: false,
            },
        );
        assert_eq!(older.high_lag_tick, Some(321));

        let now = start + Duration::from_secs(70);
        let newer = ConnectionStats::new(now - Duration::from_secs(30), 1000);
        let totals = SessionTotals::default();
        let line = totals
            .report(
                now,
                [
                    OpenConnection {
                        stats: &older,
                        held_lag: 8,
                    },
                    OpenConnection {
                        stats: &newer,
                        held_lag: 1,
                    },
                ],
            )
            .to_string();

        for field in [
            "ended=0",
            "open=2",
            "open_lag_lt1m=0,1,0,0,0,0,0,0,0",
            "open_lag_1m_10m=0,0,0,0,0,0,0,0,1",
        ] {
            assert!(line.contains(field), "{line}");
        }
    }

    #[test]
    fn tick_boundaries_trigger_summary_once_for_start_or_crossing() {
        assert!(stats_due(0, 1, STEP));
        assert!(!stats_due(17999, 1, STEP));
        assert!(stats_due(17999, 2, STEP));
        assert!(stats_due(18000, 1, STEP));
        assert!(!stats_due(18001, 1, STEP));
    }
}
