use crate::protocol::{Input, InputChange, InputFrame};

const FINAL_EDGE_MARGIN: f64 = 1e-9;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct InputPacket {
    pub tick: u64,
    pub sequence: u64,
    pub input: Input,
    pub offset: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputDisposition {
    Queued,
    Late,
    FutureFallback,
    Duplicate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InputReceipt {
    pub lead: i64,
    pub disposition: InputDisposition,
}

#[derive(Debug)]
pub struct PreparedInput<'a> {
    pub frame: &'a InputFrame,
    pub acknowledged_sequence: u64,
    pub compressed_ticks: u64,
}

#[derive(Debug, Default)]
struct InputSlot {
    tick: u64,
    changes: Vec<InputPacket>,
}

impl InputSlot {
    fn late_interval(&self, current: &InputPacket, previous: Option<usize>, step: f64) -> f64 {
        let Some(previous) = previous.map(|index| &self.changes[index]) else {
            return 0.0;
        };
        if current.tick < previous.tick {
            return 0.0;
        }

        ((current.tick - previous.tick) as f64 * step + current.offset.unwrap_or_default()
            - previous.offset.unwrap_or_default())
        .max(0.0)
    }

    fn timeline(
        &self,
        step: f64,
        last_sequence: u64,
        mut consume: impl FnMut(f64, &InputPacket),
    ) -> f64 {
        let mut previous = None;
        let mut elapsed: f64 = 0.0;
        let limit = step - FINAL_EDGE_MARGIN;

        for (index, input) in self.changes.iter().enumerate() {
            if input.sequence <= last_sequence {
                continue;
            }

            if input.tick < self.tick {
                elapsed += self.late_interval(input, previous, step);
                previous = Some(index);
            } else {
                elapsed = elapsed.max(limit.min(input.offset.unwrap_or_default().max(0.0)));
            }
            consume(elapsed, input);
        }
        elapsed
    }
}

/// Queues one player's controls by simulation tick and reuses the frame buffers.
pub struct InputQueue {
    slots: Vec<InputSlot>,
    slot_count: usize,
    frame: InputFrame,
    held_input: Input,
    last_sequence: u64,
    last_received_sequence: u64,
    input_lead: Option<i64>,
}

impl InputQueue {
    pub fn new(max_prediction_ticks: u32) -> Self {
        Self {
            slots: Vec::new(),
            slot_count: max_prediction_ticks as usize + 1,
            frame: InputFrame::default(),
            held_input: Input::default(),
            last_sequence: 0,
            last_received_sequence: 0,
            input_lead: None,
        }
    }

    pub fn receive(
        &mut self,
        world_tick: u64,
        no_ship: bool,
        mut packet: InputPacket,
    ) -> InputReceipt {
        let lead = (packet.tick as i64).wrapping_sub(world_tick as i64);
        self.input_lead = Some(lead);
        if packet.sequence <= self.last_sequence.max(self.last_received_sequence) {
            return InputReceipt {
                lead,
                disposition: InputDisposition::Duplicate,
            };
        }
        if no_ship {
            packet.input = Input::default();
        }
        if self.slots.is_empty() {
            self.slots.resize_with(self.slot_count, InputSlot::default);
        }

        let (tick, disposition) = if packet.tick < world_tick {
            (world_tick, InputDisposition::Late)
        } else if packet.tick - world_tick >= self.slots.len() as u64 {
            // A client predicting past the queue's horizon supplies its latest state immediately.
            packet.tick = world_tick;
            packet.offset = None;
            (world_tick, InputDisposition::FutureFallback)
        } else {
            (packet.tick, InputDisposition::Queued)
        };

        let index = (tick % self.slots.len() as u64) as usize;
        let slot = &mut self.slots[index];
        if slot.tick != tick {
            slot.tick = tick;
            slot.changes.clear();
        }
        slot.changes.push(packet);
        self.last_received_sequence = packet.sequence;
        InputReceipt { lead, disposition }
    }

    pub fn prepare(&mut self, world_tick: u64, ticks: u64, step: f64) -> PreparedInput<'_> {
        self.frame.input = self.held_input;
        self.frame.changes.clear();
        if self.slots.is_empty() {
            return PreparedInput {
                frame: &self.frame,
                acknowledged_sequence: self.last_sequence,
                compressed_ticks: 0,
            };
        }
        let mut compressed_ticks = 0;
        let slot_count = self.slots.len() as u64;
        let limit = step - FINAL_EDGE_MARGIN;

        for index in 0..ticks {
            let tick = world_tick.wrapping_add(index);
            let slot = &mut self.slots[(tick % slot_count) as usize];
            if slot.tick != tick || slot.changes.is_empty() {
                continue;
            }

            // Keep the relative order of late edges without replaying earlier simulation ticks.
            let span = slot.timeline(step, self.last_sequence, |_, _| {});
            let scale = if span > limit {
                compressed_ticks += 1;
                limit / span
            } else {
                1.0
            };

            let tick_offset = index as f64 * step;
            slot.timeline(step, self.last_sequence, |elapsed, packet| {
                let previous = self
                    .frame
                    .changes
                    .last()
                    .map_or(0.0, |change| change.offset);
                let offset = previous.max(tick_offset + limit.min(elapsed * scale));
                self.frame.changes.push(InputChange {
                    input: packet.input,
                    offset,
                });
                self.held_input = packet.input;
                self.last_sequence = packet.sequence;
            });
            slot.changes.clear();
        }

        PreparedInput {
            frame: &self.frame,
            acknowledged_sequence: self.last_sequence,
            compressed_ticks,
        }
    }

    pub fn acknowledged_sequence(&self) -> u64 {
        self.last_sequence
    }

    pub fn held_input(&self) -> Input {
        self.held_input
    }

    pub fn input_lead(&self) -> Option<i64> {
        self.input_lead
    }

    pub fn clear_input_lead(&mut self) {
        self.input_lead = None;
    }

    pub fn discard_pending(&mut self, held_input: Input) {
        for slot in &mut self.slots {
            slot.changes.clear();
        }
        self.held_input = held_input;
    }

    pub fn reset_connection(&mut self, held_input: Input) {
        self.discard_pending(held_input);
        self.last_sequence = 0;
        self.last_received_sequence = 0;
        self.clear_input_lead();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STEP: f64 = 1.0 / 30.0;

    fn packet(tick: u64, sequence: u64, offset: f64, input: Input) -> InputPacket {
        InputPacket {
            tick,
            sequence,
            offset: Some(offset),
            input,
        }
    }

    fn autogun(fire: bool) -> Input {
        Input {
            autogun_active: true,
            fire,
            ..Input::default()
        }
    }

    fn close_to(actual: f64, expected: f64) {
        assert!((actual - expected).abs() <= 1e-12, "{actual} vs {expected}");
    }

    #[test]
    fn lone_late_and_far_future_edges_apply_at_current_tick_start() {
        for (tick, disposition) in [
            (0, InputDisposition::Late),
            (u64::MAX, InputDisposition::FutureFallback),
        ] {
            let mut queue = InputQueue::new(8);
            let thrust = Input {
                thrust: 1.0,
                ..Input::default()
            };
            assert_eq!(
                queue
                    .receive(1, false, packet(tick, 1, 0.030, thrust))
                    .disposition,
                disposition
            );
            assert_eq!(queue.acknowledged_sequence(), 0);
            let prepared = queue.prepare(1, 1, STEP);
            assert_eq!(
                prepared.frame.changes,
                [InputChange {
                    offset: 0.0,
                    input: thrust
                }]
            );
            assert_eq!(prepared.acknowledged_sequence, 1);
        }
    }

    #[test]
    fn late_backlog_compresses_proportionally_into_one_tick() {
        let mut queue = InputQueue::new(8);
        for (index, tick) in [0, 3, 6, 9].into_iter().enumerate() {
            queue.receive(
                13,
                false,
                packet(tick, (index + 1) as u64, 0.005, autogun(index % 2 == 0)),
            );
        }

        let prepared = queue.prepare(13, 1, STEP);
        assert_eq!(prepared.frame.changes.len(), 4);
        assert_eq!(prepared.compressed_ticks, 1);
        assert_eq!(prepared.acknowledged_sequence, 4);
        for (index, change) in prepared.frame.changes.iter().enumerate() {
            close_to(
                change.offset,
                index as f64 / 3.0 * (STEP - FINAL_EDGE_MARGIN),
            );
            assert!(change.offset < STEP);
            assert_eq!(change.input, autogun(index % 2 == 0));
        }
    }

    #[test]
    fn regular_edges_keep_interleaved_overdue_taps() {
        for (include_initial_late, offset) in [(false, STEP - FINAL_EDGE_MARGIN), (true, 0.030)] {
            let mut queue = InputQueue::new(8);
            if include_initial_late {
                queue.receive(1, false, packet(0, 1, 0.001, autogun(false)));
            }
            queue.receive(1, false, packet(1, 2, offset, autogun(false)));
            queue.receive(1, false, packet(0, 3, 0.005, autogun(true)));
            queue.receive(1, false, packet(0, 4, 0.015, autogun(false)));
            let prepared = queue.prepare(1, 1, STEP);
            let changes = &prepared.frame.changes;
            assert_eq!(changes.len(), if include_initial_late { 4 } else { 3 });
            let [regular, press, release] = changes[changes.len() - 3..] else {
                panic!("fixture needs a regular edge and an overdue tap");
            };

            if include_initial_late {
                assert!(regular.offset < press.offset);
            } else {
                assert_eq!(regular.offset, press.offset);
            }
            assert!(press.offset < release.offset);
            assert!(release.offset < STEP);
            assert!(press.input.fire);
            assert!(!release.input.fire);
            assert_eq!(prepared.compressed_ticks, 1);
        }
    }

    #[test]
    fn newer_sequence_wins_across_ticks_and_reconnect_resets_both_sequences() {
        let mut queue = InputQueue::new(8);
        let left = Input {
            turn: -1.0,
            ..Input::default()
        };
        let right = Input {
            turn: 1.0,
            ..Input::default()
        };
        let thrust = Input {
            thrust: 1.0,
            ..Input::default()
        };
        let neutral = Input::default();

        assert_eq!(
            queue
                .receive(1, false, packet(3, 1, 0.010, left))
                .disposition,
            InputDisposition::Queued
        );
        assert_eq!(
            queue
                .receive(1, false, packet(0, 1, 0.0, right))
                .disposition,
            InputDisposition::Duplicate
        );
        queue.receive(1, false, packet(0, 2, 0.005, thrust));
        queue.receive(1, false, packet(0, 2, 0.015, neutral));
        queue.receive(1, false, packet(1, 3, 0.015, neutral));

        {
            let prepared = queue.prepare(1, 1, STEP);
            assert_eq!(prepared.acknowledged_sequence, 3);
            assert_eq!(prepared.frame.changes[0].input, thrust);
            assert_eq!(prepared.frame.changes[1].input, neutral);
        }
        let prepared = queue.prepare(2, 2, STEP);
        assert_eq!(prepared.acknowledged_sequence, 3);
        assert!(prepared.frame.changes.is_empty());

        queue.receive(4, false, packet(5, 4, 0.010, right));
        assert_eq!(queue.prepare(4, 1, STEP).acknowledged_sequence, 3);
        let prepared = queue.prepare(5, 1, STEP);
        assert_eq!(prepared.acknowledged_sequence, 4);
        assert_eq!(
            prepared.frame.changes,
            [InputChange {
                input: right,
                offset: 0.010
            }]
        );

        queue.receive(6, false, packet(7, 9, 0.015, neutral));
        queue.reset_connection(autogun(false));
        assert_eq!(queue.acknowledged_sequence(), 0);
        assert_eq!(queue.input_lead(), None);
        queue.receive(6, false, packet(6, 1, 0.0, left));
        let prepared = queue.prepare(6, 2, STEP);
        assert_eq!(prepared.frame.input, autogun(false));
        assert_eq!(
            prepared.frame.changes,
            [InputChange {
                input: left,
                offset: 0.0
            }]
        );
        assert_eq!(prepared.acknowledged_sequence, 1);
    }

    #[test]
    fn catch_up_frames_keep_absolute_offsets_and_shipless_inputs_stay_neutral() {
        let mut queue = InputQueue::new(8);
        queue.receive(10, false, packet(11, 1, 0.005, autogun(true)));
        queue.receive(10, true, packet(12, 2, 0.002, autogun(true)));
        assert_eq!(queue.input_lead(), Some(2));
        let prepared = queue.prepare(10, 3, STEP);
        let changes = &prepared.frame.changes;
        assert_eq!(changes.len(), 2);
        assert_eq!(
            changes[0],
            InputChange {
                input: autogun(true),
                offset: STEP + 0.005
            }
        );
        assert_eq!(
            changes[1],
            InputChange {
                input: Input::default(),
                offset: STEP * 2.0 + 0.002
            }
        );
        assert_eq!(prepared.acknowledged_sequence, 2);
        queue.clear_input_lead();
        assert_eq!(queue.input_lead(), None);
    }
}
