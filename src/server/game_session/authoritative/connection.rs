use super::*;

impl AuthoritativeSession {
    pub(super) fn greet(&mut self, client: &Client, player_token: Option<String>, play: bool) {
        let now = Instant::now();
        let id = player_token
            .as_ref()
            .and_then(|token| self.tokens.get(token).copied())
            .or_else(|| self.create_account(now));
        let Some(id) = id else {
            client.socket.close_with(1011, "Ship unavailable");
            return;
        };

        let account = self.accounts.get(&id).expect("connected account exists");
        if account.banned {
            client.socket.close_with(BANNED_CODE, BANNED_MESSAGE);
            return;
        }
        if let Some(previous) = account.socket.clone() {
            self.disconnect_with_reason(previous.id, "replaced");
            previous
                .socket
                .close_with(REPLACED_CODE, "Session opened elsewhere");
        }

        let account = self
            .accounts
            .get_mut(&id)
            .expect("connected account exists");
        let world = &mut self.sectors[account.sector].running.world;
        if account.hidden.is_none() {
            account.hidden = world.remove_entity(account.ship_id);
        }
        let held = account
            .hidden
            .as_mut()
            .and_then(|entity| match &mut entity.model {
                EntityKind::Ship(ship) => {
                    ship.craft.object.position = round_spawn(ship.craft.object.position);
                    account.position = ship.craft.object.position;
                    Some(held_input(ship))
                }
                _ => None,
            })
            .unwrap_or_default();

        account.socket = Some(client.clone());
        account.playing = false;
        account.welcome_pending = true;
        account.profile_pending = false;
        account.respawn_pending = false;
        account.progress_pending = false;
        account.hangar.reconnect();
        account.delivery.reset_connection();
        account.selection = ObserverSelection::new(true);
        account.writer = SnapshotWriter::default();
        account.dock_sequence = 0;
        account.dock_aliases.clear();
        account.last_input_at = now;
        account.last_seen_at = unix_seconds();
        account.played_at = None;
        account.disconnected_at = None;
        account.inputs.reset_connection(held);
        account.stats = Some(ConnectionStats::new(now, world.tick));
        self.sockets.insert(client.id, id);
        self.mark_dirty(id, true);
        if play {
            self.play(id);
        } else {
            self.send_snapshot(id);
        }
    }

    pub(super) fn disconnect_with_reason(&mut self, client: ClientId, reason: &'static str) {
        let Some(id) = self.sockets.get(&client).copied() else {
            return;
        };
        let now = Instant::now();
        self.stop_playing(id, now);
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        let world = &mut self.sectors[account.sector].running.world;
        if let Some(mut stats) = account.stats.take() {
            stats.set_end_reason(reason);
            let finished = FinishedConnection {
                now,
                tick: world.tick,
                simulation_step: self.catalog.simulation.simulation_step,
                active_connections: self.sockets.len(),
                held_lag: account.delivery.receipt_lag(),
            };
            if let Some(report) = stats.finish(finished, &mut self.stats)
                && self.load.is_some()
            {
                eprintln!("{report}");
            }
        }
        self.sockets.remove(&client);
        account.socket = None;
        account.inputs = InputQueue::new(self.catalog.simulation.max_prediction_ticks as u32);
        account.selection = ObserverSelection::new(true);
        account.writer = SnapshotWriter::default();
        account.delivery = SnapshotDelivery::default();
        account.dock_aliases = OrderedMap::default();
        account.gate_access.cancel();
        account.disconnected_at = Some(now);
        self.pending_ship_hiding = true;
        self.mark_dirty(id, false);
        #[cfg(feature = "benchmark-fixtures")]
        if reason != "replaced" {
            self.finish_benchmark(id);
        }
    }

    pub(super) fn leave_world(&mut self, id: i64, now: Instant) {
        if !self
            .accounts
            .get(&id)
            .is_some_and(|account| account.playing)
        {
            return;
        }
        self.stop_playing(id, now);
        let account = self.accounts.get_mut(&id).expect("playing account exists");
        let world = &mut self.sectors[account.sector].running.world;
        if account.hidden.is_none() {
            account.hidden = world.remove_entity(account.ship_id);
        }
        let held = account
            .hidden
            .as_ref()
            .and_then(|entity| match &entity.model {
                EntityKind::Ship(ship) => Some(held_input(ship)),
                _ => None,
            })
            .unwrap_or_default();
        account.inputs.reset_connection(held);
        account.dock_sequence = 0;
        account.dock_aliases.clear();
        account.gate_access.cancel();
        account.delivery.clear_pending();
        account.delivery.require_load();
        account.welcome_pending = true;
        account.respawn_pending = false;
        account.progress_pending = false;
        account.hangar.reconnect();
        self.mark_dirty(id, false);
    }

    fn stop_playing(&mut self, id: i64, now: Instant) {
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        let world = &mut self.sectors[account.sector].running.world;
        account.update_session_time(now);
        account.played_at = None;
        world.remove_player(id);
        self.inputs.remove(&id);
        if account.playing {
            account.playing = false;
            let mut docked_to = None;
            if let Some(entity) = world.entity_mut(account.ship_id)
                && let EntityKind::Ship(ship) = &mut entity.model
            {
                docked_to = ship.craft.docked_to;
                reset_disconnected_movement(ship);
                account.position = ship.craft.object.position;
            }
            if let Some(station_id) = docked_to
                && let Some(entity) = world.entity_mut(station_id)
                && let EntityKind::Station(station) = &mut entity.model
            {
                station.end_trade_visit(account.ship_id);
                world.mark_entity_changed(station_id);
            }
        }
    }

    pub(super) fn receive_input(&mut self, id: i64, packet: InputPacket) {
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        let receipt = account.inputs.receive(
            self.sectors[account.sector].running.world.tick,
            account.hangar.no_ship,
            packet,
        );
        if let Some(stats) = &mut account.stats {
            stats.record_input(receipt);
        }
    }

    pub(super) fn receive_ack(&mut self, id: i64, sequence: u64) {
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        let tick = self.sectors[account.sector].running.world.tick;
        let Some(receipt) =
            account
                .delivery
                .acknowledge(sequence, tick, self.catalog.simulation.simulation_step)
        else {
            return;
        };
        let expired = account
            .dock_aliases
            .iter()
            .filter_map(|(&id, &(_, sequence))| (sequence <= receipt.dock_sequence).then_some(id))
            .collect::<SmallVec<[i64; 16]>>();
        for id in expired {
            account.dock_aliases.remove(&id);
        }
        if let Some(stats) = &mut account.stats {
            stats.record_receipt(tick, receipt);
        }
    }

    pub(super) fn disconnect_idle(&mut self, now: Instant) {
        let mut idle = SmallVec::<[Client; 16]>::new();
        for account in self.accounts.values_mut() {
            let Some(client) = &account.socket else {
                continue;
            };
            if account.inputs.held_input().thrust != 0.0 || account.inputs.held_input().turn != 0.0
            {
                account.last_input_at = now;
            }
            if now.saturating_duration_since(account.last_input_at) >= IDLE_TIMEOUT {
                idle.push(client.clone());
            }
        }
        for client in idle {
            self.disconnect_with_reason(client.id, "idle");
            client.socket.close_with(4002, "Idle timeout");
        }
    }
}
