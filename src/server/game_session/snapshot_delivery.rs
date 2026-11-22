use std::collections::VecDeque;

use crate::websocket::{MAX_SNAPSHOT_BUFFER, MAX_SOCKET_BUFFER};

const INITIAL_WINDOW: usize = 2;
const HEALTHY_WINDOW: usize = 9;
const MAX_HEALTHY_LAG: u64 = 8;
const RECOVERY_SECONDS: f64 = 1.0;
const JOIN_WARMUP_SECONDS: f64 = 10.0;

#[derive(Clone, Copy, Debug)]
struct PendingSnapshot {
    sequence: u64,
    tick: Option<u64>,
    dock_sequence: u64,
    requested: bool,
    window: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct SnapshotRequest {
    pub tick: u64,
    pub step: f64,
    pub regular: bool,
    pub buffered_bytes: usize,
    pub dock_sequence: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SnapshotStall {
    SocketLimit,
    Buffer,
    Window,
}

#[derive(Clone, Copy, Debug)]
pub struct SnapshotPlan {
    pub sequence: u64,
    pub receipt_sequence: Option<u64>,
    pub load: bool,
    pub force_ship_update: bool,
}

/// A packet plan reserves the delivery state until encoding has succeeded.
pub struct PreparedSnapshot<'a> {
    delivery: &'a mut SnapshotDelivery,
    request: SnapshotRequest,
    plan: SnapshotPlan,
}

impl PreparedSnapshot<'_> {
    pub fn plan(&self) -> SnapshotPlan {
        self.plan
    }

    pub fn commit(self) {
        let Self {
            delivery,
            request,
            plan,
        } = self;
        delivery.sequence = plan.sequence;
        delivery.needs_load = false;
        delivery.sent_dock_sequence = request.dock_sequence;
        delivery.pending.push_back(PendingSnapshot {
            sequence: plan.sequence,
            tick: (!plan.load).then_some(request.tick),
            dock_sequence: request.dock_sequence,
            requested: plan.receipt_sequence.is_some(),
            window: delivery.window,
        });

        if request.regular && delivery.join_until == 0 {
            let warmup_ticks = (JOIN_WARMUP_SECONDS / request.step).ceil() as u64;
            delivery.join_until = request.tick.wrapping_add(warmup_ticks);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SnapshotReceipt {
    pub dock_sequence: u64,
    pub lag: Option<i64>,
    pub joining: bool,
    pub recovery_started: bool,
}

/// Per-connection receipt pacing and snapshot backpressure.
pub struct SnapshotDelivery {
    pending: VecDeque<PendingSnapshot>,
    needs_load: bool,
    sequence: u64,
    sent_dock_sequence: u64,
    recovery_until: u64,
    last_receipt: u64,
    join_until: u64,
    window: usize,
    ack_interval: usize,
    receipt_lag: usize,
}

impl Default for SnapshotDelivery {
    fn default() -> Self {
        Self {
            pending: VecDeque::new(),
            needs_load: true,
            sequence: 0,
            sent_dock_sequence: 0,
            recovery_until: 0,
            last_receipt: 0,
            join_until: 0,
            window: INITIAL_WINDOW,
            ack_interval: 0,
            receipt_lag: 0,
        }
    }
}

impl SnapshotDelivery {
    pub fn prepare(
        &mut self,
        request: SnapshotRequest,
    ) -> Result<PreparedSnapshot<'_>, SnapshotStall> {
        if request.buffered_bytes > MAX_SOCKET_BUFFER {
            return Err(SnapshotStall::SocketLimit);
        }
        if request.buffered_bytes > MAX_SNAPSHOT_BUFFER {
            return Err(SnapshotStall::Buffer);
        }

        // Keep the allowance of an existing tail if a slow receipt reduces the window.
        let pending = self.pending.len();
        let mut window = self.window;
        if pending >= window {
            for snapshot in &self.pending {
                window = window.max(snapshot.window);
            }
        }
        if pending >= window && self.pending.iter().any(|snapshot| snapshot.requested) {
            return Err(SnapshotStall::Window);
        }

        let sequence = self.sequence.wrapping_add(1);
        let force_ship_update =
            !request.regular || self.sent_dock_sequence != request.dock_sequence;
        let batch_receipt = !self.needs_load
            && !force_ship_update
            && self.ack_interval > 1
            && !sequence.is_multiple_of(self.ack_interval as u64)
            && pending < window - 1;
        let plan = SnapshotPlan {
            sequence,
            receipt_sequence: (!batch_receipt).then_some(sequence),
            load: self.needs_load,
            force_ship_update,
        };
        Ok(PreparedSnapshot {
            delivery: self,
            request,
            plan,
        })
    }

    pub fn acknowledge(&mut self, sequence: u64, tick: u64, step: f64) -> Option<SnapshotReceipt> {
        let index = self
            .pending
            .iter()
            .position(|snapshot| snapshot.sequence == sequence)?;
        let receipt = self.pending[index];
        let joining = self.joining(tick);
        let mut recovery_started = false;
        let mut observed_lag = 0;

        let lag = receipt.tick.map(|sent_tick| {
            let lag = (tick as i64).wrapping_sub(sent_tick as i64);
            let receipt_gap = tick.wrapping_sub(self.last_receipt);
            self.last_receipt = tick;
            if lag > MAX_HEALTHY_LAG as i64
                || self.recovery_until != 0 && receipt_gap > MAX_HEALTHY_LAG
            {
                recovery_started = self.recovery_until == 0;
                let recovery_ticks = (RECOVERY_SECONDS / step).ceil() as u64;
                self.recovery_until = tick.wrapping_add(recovery_ticks);
            }

            self.window = INITIAL_WINDOW;
            if lag <= MAX_HEALTHY_LAG as i64 && tick >= self.recovery_until {
                self.window = HEALTHY_WINDOW;
                self.recovery_until = 0;
            }

            // A jittery client retains its observed lag after the join warmup.
            observed_lag = lag.clamp(0, MAX_HEALTHY_LAG as i64) as usize;
            if !joining {
                self.receipt_lag = self.receipt_lag.max(observed_lag);
            }
            lag
        });

        self.ack_interval = self
            .window
            .saturating_sub(self.receipt_lag.max(observed_lag) + 2)
            .max(1);
        self.pending.drain(..=index);
        Some(SnapshotReceipt {
            dock_sequence: receipt.dock_sequence,
            lag,
            joining,
            recovery_started,
        })
    }

    pub fn needs_load(&self) -> bool {
        self.needs_load
    }

    pub fn require_load(&mut self) {
        self.needs_load = true;
    }

    pub fn clear_pending(&mut self) {
        self.pending.clear();
    }

    pub fn reset_connection(&mut self) {
        self.pending.clear();
        self.pending.reserve(HEALTHY_WINDOW);
        self.needs_load = true;
        self.sequence = 0;
        self.sent_dock_sequence = 0;
        self.recovery_until = 0;
        self.last_receipt = 0;
        self.join_until = 0;
        self.window = INITIAL_WINDOW;
        self.ack_interval = 0;
        self.receipt_lag = 0;
    }

    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    pub fn window(&self) -> usize {
        self.window
    }

    pub fn receipt_lag(&self) -> usize {
        self.receipt_lag
    }

    pub(crate) fn wants_movement(&self, tick: u64) -> bool {
        self.pending
            .back()
            .and_then(|snapshot| snapshot.tick)
            .is_none_or(|sent| tick.wrapping_sub(sent) > MAX_HEALTHY_LAG)
    }

    pub fn joining(&self, tick: u64) -> bool {
        self.join_until == 0 || tick < self.join_until
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STEP: f64 = 1.0 / 30.0;

    struct Fixture {
        delivery: SnapshotDelivery,
        packets: usize,
        requested_sequence: u64,
        tick: u64,
    }

    impl Fixture {
        fn new() -> Self {
            let mut fixture = Self {
                delivery: SnapshotDelivery::default(),
                packets: 0,
                requested_sequence: 0,
                tick: 0,
            };
            let load = fixture.send(false).unwrap();
            assert!(load.load);
            assert_eq!(load.receipt_sequence, Some(1));
            fixture
        }

        fn send(&mut self, regular: bool) -> Result<SnapshotPlan, SnapshotStall> {
            let prepared = self.delivery.prepare(SnapshotRequest {
                tick: self.tick,
                step: STEP,
                regular,
                buffered_bytes: 0,
                dock_sequence: 0,
            })?;
            let plan = prepared.plan();
            prepared.commit();
            self.packets += 1;
            if let Some(sequence) = plan.receipt_sequence {
                self.requested_sequence = sequence;
            }
            Ok(plan)
        }

        fn advance(&mut self, ticks: u64) {
            self.tick += ticks;
            let _ = self.send(true);
        }

        fn acknowledge(&mut self, sequence: u64) -> Option<SnapshotReceipt> {
            self.delivery.acknowledge(sequence, self.tick, STEP)
        }

        fn acknowledge_last(&mut self) -> Option<SnapshotReceipt> {
            self.acknowledge(self.requested_sequence)
        }
    }

    #[test]
    fn catch_up_sends_one_snapshot_and_unsent_receipts_never_open_the_window() {
        let mut fixture = Fixture::new();
        for tick in 1..=8 {
            fixture.acknowledge_last();
            fixture.advance(1);
            assert_eq!(fixture.packets as u64, tick + 1);
            assert_eq!(fixture.delivery.sequence, tick + 1);
            assert_eq!(fixture.tick, tick);
        }
        fixture.acknowledge_last();
        fixture.advance(3);
        assert_eq!(fixture.tick, 11);
        assert_eq!(fixture.packets, 10);

        let window = fixture.delivery.window;
        let expected = fixture.packets + window - fixture.delivery.pending_count();
        for _ in 0..20 {
            fixture.advance(1);
        }
        assert_eq!(fixture.packets, expected);
        assert_eq!(fixture.delivery.pending_count(), window);
        assert!(fixture.acknowledge(fixture.delivery.sequence + 1).is_none());
        assert_eq!(fixture.delivery.pending_count(), window);
        fixture.acknowledge_last();
        fixture.advance(1);
        assert_eq!(fixture.tick, 32);
        assert_eq!(fixture.packets, expected + 1);
    }

    #[test]
    fn round_trip_delays_preserve_original_windows_and_healthy_cadence() {
        for delay in [2, 6, 8, 18] {
            let mut fixture = Fixture::new();
            let mut receipts = VecDeque::from([(delay, fixture.requested_sequence)]);
            let mut late_snapshots = 0;
            for _ in 0..90 {
                while let Some(&(arrival, sequence)) = receipts.front()
                    && arrival <= fixture.tick
                {
                    receipts.pop_front();
                    fixture.acknowledge(sequence);
                }
                let previous_packets = fixture.packets;
                let previous_receipt = fixture.requested_sequence;
                fixture.advance(1);
                if fixture.requested_sequence != previous_receipt {
                    receipts.push_back((fixture.tick + delay, fixture.requested_sequence));
                }
                if fixture.packets != previous_packets && fixture.tick > 60 {
                    late_snapshots += 1;
                }
            }

            assert!(fixture.delivery.pending_count() <= fixture.delivery.window);
            if delay <= MAX_HEALTHY_LAG {
                assert_eq!(late_snapshots, 30, "round trip {delay}");
                assert_eq!(fixture.delivery.window, HEALTHY_WINDOW);
            } else {
                assert_eq!(fixture.delivery.window, INITIAL_WINDOW);
            }
        }
    }

    #[test]
    fn jitter_scenarios_recover_with_ordered_receipts() {
        let wide = [2, 8, 3, 1];
        let mut scenarios = vec![
            (vec![2, 4, 3, 2], 0),
            (wide.to_vec(), 0),
            (vec![1, 2, 10, 2], 0),
            (vec![18], 0),
        ];
        for start in 0..wide.len() {
            let mut pattern = wide.to_vec();
            pattern.rotate_left(start);
            scenarios.push((pattern, 1));
        }
        let mut spikes = vec![1; 21];
        spikes[0] = 8;
        scenarios.push((spikes, 0));

        for (delays, first_request) in scenarios {
            for recovery_delay in [2, 6, 8] {
                let mut fixture = Fixture::new();
                fixture.delivery.join_until = 1;
                let mut receipts = VecDeque::from([(delays[0], fixture.requested_sequence)]);
                let mut last_receipt = delays[0];
                let mut request_index = first_request;
                let mut snapshots = 0;
                let mut recovered = 0;

                for tick in 0..300 {
                    while let Some(&(arrival, sequence)) = receipts.front()
                        && arrival <= fixture.tick
                    {
                        receipts.pop_front();
                        fixture.acknowledge(sequence);
                    }

                    let previous_packets = fixture.packets;
                    let previous_request = fixture.requested_sequence;
                    fixture.advance(1);
                    assert!(fixture.delivery.pending_count() <= HEALTHY_WINDOW);
                    if delays.len() == 1 && tick < 180 {
                        assert!(fixture.delivery.pending_count() <= INITIAL_WINDOW);
                    }

                    if fixture.requested_sequence != previous_request {
                        let delay = if tick < 180 {
                            delays[request_index % delays.len()]
                        } else {
                            recovery_delay
                        };
                        last_receipt = last_receipt.max(fixture.tick + delay);
                        receipts.push_back((last_receipt, fixture.requested_sequence));
                        request_index += 1;
                    }
                    if fixture.packets != previous_packets {
                        if (60..180).contains(&tick) {
                            snapshots += 1;
                        }
                        if tick >= 270 {
                            recovered += 1;
                        }
                    }
                }

                if delays.iter().all(|delay| *delay <= MAX_HEALTHY_LAG) {
                    assert_eq!(
                        snapshots, 120,
                        "delays {delays:?}, recovery {recovery_delay}"
                    );
                }
                assert_eq!(
                    recovered, 30,
                    "delays {delays:?}, recovery {recovery_delay}"
                );
                assert_eq!(fixture.delivery.window, HEALTHY_WINDOW);
            }
        }
    }

    #[test]
    fn stalled_receipts_reduce_window_until_a_continuous_recovery_second() {
        let mut fixture = Fixture::new();
        fixture.delivery.join_until = 1;
        for _ in 0..30 {
            fixture.acknowledge_last();
            fixture.advance(1);
        }
        assert_eq!(fixture.delivery.window, HEALTHY_WINDOW);
        assert!(fixture.delivery.ack_interval > 1);

        for _ in 0..30 {
            fixture.advance(1);
            assert!(fixture.delivery.pending_count() <= HEALTHY_WINDOW);
        }
        assert_eq!(fixture.delivery.pending_count(), HEALTHY_WINDOW);
        assert_eq!(fixture.requested_sequence, fixture.delivery.sequence);
        let previous = fixture.packets;
        let receipt = fixture.acknowledge_last().unwrap();
        assert!(receipt.recovery_started);
        let recovery_seconds = (fixture.delivery.recovery_until - fixture.tick) as f64 * STEP;
        assert!((1.0..1.0 + STEP).contains(&recovery_seconds));

        fixture.advance(1);
        assert_eq!(fixture.packets, previous + 1);
        assert_eq!(fixture.delivery.pending_count(), 1);
        fixture.acknowledge_last();
        assert_eq!(fixture.delivery.window, INITIAL_WINDOW);
        assert_eq!(fixture.delivery.ack_interval, 1);
        assert!(fixture.delivery.recovery_until > fixture.tick);

        let previous_recovery = fixture.delivery.recovery_until;
        fixture.advance(1);
        let requested = fixture.requested_sequence;
        fixture.advance(9);
        fixture.acknowledge(requested);
        fixture.acknowledge_last();
        assert!(fixture.delivery.recovery_until > previous_recovery);
        assert_eq!(fixture.delivery.window, INITIAL_WINDOW);

        let previous_recovery = fixture.delivery.recovery_until;
        fixture.advance(fixture.delivery.recovery_until - fixture.tick + 1);
        fixture.acknowledge_last();
        assert!(fixture.delivery.recovery_until > previous_recovery);
        assert_eq!(fixture.delivery.last_receipt, fixture.tick);
        assert_eq!(fixture.delivery.window, INITIAL_WINDOW);

        while fixture.tick < fixture.delivery.recovery_until {
            let previous = fixture.packets;
            fixture.advance(1);
            fixture.acknowledge_last();
            assert_eq!(fixture.packets, previous + 1);
            if fixture.tick < fixture.delivery.recovery_until {
                assert_eq!(fixture.delivery.window, INITIAL_WINDOW);
            }
        }
        assert_eq!(fixture.delivery.window, HEALTHY_WINDOW);
        assert_eq!(fixture.delivery.ack_interval, 1);
        assert_eq!(fixture.delivery.recovery_until, 0);
        fixture.delivery.reset_connection();
        assert_eq!(fixture.delivery.ack_interval, 0);
        assert_eq!(fixture.delivery.last_receipt, 0);
        assert_eq!(fixture.delivery.receipt_lag, 0);
        assert!(fixture.delivery.needs_load);
    }

    #[test]
    fn unrequested_tail_can_progress_after_window_shrinks() {
        let mut fixture = Fixture::new();
        fixture.acknowledge_last();
        fixture.advance(1);
        fixture.acknowledge_last();

        for _ in 0..6 {
            fixture.advance(1);
        }
        let requested = fixture.requested_sequence;
        fixture.advance(9);
        fixture.acknowledge(requested);
        assert_eq!(fixture.delivery.window, INITIAL_WINDOW);
        assert_eq!(fixture.delivery.pending_count(), 2);
        assert!(
            fixture
                .delivery
                .pending
                .iter()
                .all(|snapshot| !snapshot.requested)
        );

        let previous = fixture.packets;
        fixture.advance(1);
        assert_eq!(fixture.packets, previous + 1);
        assert_eq!(fixture.requested_sequence, fixture.delivery.sequence);
    }

    #[test]
    fn load_and_dock_updates_request_receipts_and_buffer_limits_are_distinct() {
        let mut delivery = SnapshotDelivery::default();
        let request = SnapshotRequest {
            tick: 0,
            step: STEP,
            regular: false,
            buffered_bytes: MAX_SNAPSHOT_BUFFER,
            dock_sequence: 1,
        };

        assert!(matches!(
            delivery.prepare(SnapshotRequest {
                buffered_bytes: MAX_SOCKET_BUFFER + 1,
                ..request
            }),
            Err(SnapshotStall::SocketLimit)
        ));
        assert!(matches!(
            delivery.prepare(SnapshotRequest {
                buffered_bytes: MAX_SNAPSHOT_BUFFER + 1,
                ..request
            }),
            Err(SnapshotStall::Buffer)
        ));
        {
            let prepared = delivery.prepare(request).unwrap();
            assert_eq!(prepared.plan().receipt_sequence, Some(1));
            assert!(prepared.plan().force_ship_update);
        }
        assert_eq!(delivery.pending_count(), 0);
        assert!(delivery.needs_load());

        delivery.prepare(request).unwrap().commit();
        let ack = delivery.acknowledge(1, 4, STEP).unwrap();
        assert_eq!(ack.dock_sequence, 1);
        assert_eq!(ack.lag, None);

        let dock_request = SnapshotRequest {
            tick: 5,
            regular: true,
            dock_sequence: 2,
            ..request
        };
        let prepared = delivery.prepare(dock_request).unwrap();
        assert!(!prepared.plan().load);
        assert!(prepared.plan().force_ship_update);
        assert_eq!(prepared.plan().receipt_sequence, Some(2));
        prepared.commit();

        let ack = delivery.acknowledge(2, 7, STEP).unwrap();
        assert_eq!(ack.lag, Some(2));
        assert!(ack.joining);
        assert_eq!(delivery.receipt_lag, 0);
        assert!(delivery.joining(5 + (JOIN_WARMUP_SECONDS / STEP).ceil() as u64 - 1));
        assert!(!delivery.joining(5 + (JOIN_WARMUP_SECONDS / STEP).ceil() as u64));
    }
}
