use super::*;

impl AuthoritativeSession {
    pub(super) fn sync_regions(&mut self, index: usize, include: Option<Vector>) {
        self.refresh_sector_positions(index);
        let sector = &mut self.sectors[index];
        sector.positions.extend(include);
        sector
            .regions
            .sync(&mut sector.running.world, &sector.positions);
    }

    pub(super) fn refresh_sector_positions(&mut self, index: usize) {
        let sector = &mut self.sectors[index];
        sector.positions.clear();
        sector.positions.extend(
            self.accounts
                .values()
                .filter(|account| {
                    account.sector == index && (account.playing || account.hidden.is_none())
                })
                .filter_map(|account| {
                    let entity = sector.running.world.entity(account.ship_id);
                    (account.playing || entity.is_some()).then(|| {
                        entity.map_or(account.position, |entity| entity.model.object().position)
                    })
                }),
        );
    }

    pub(super) fn tick_sector(&mut self, index: usize, tick: u64, ticks: u64, step: f64) {
        #[cfg(feature = "benchmark-fixtures")]
        self.start_benchmark_tick(index);
        self.prepare_npc_players(index);
        self.run_npcs(index, NpcPhase::Dispatch);
        self.refresh_sector_positions(index);
        let sector = &mut self.sectors[index];
        if sector
            .last_sync
            .is_none_or(|last| tick.saturating_sub(last) >= REGION_INTERVAL)
        {
            sector
                .regions
                .sync(&mut sector.running.world, &sector.positions);
            sector.last_sync = Some(tick);
        }
        sector
            .running
            .world
            .activate_station_physics(&sector.positions);

        self.inputs.clear();
        for account in self
            .accounts
            .values_mut()
            .filter(|account| account.sector == index && account.playing)
        {
            let prepared = account.inputs.prepare(tick, ticks, step);
            if let Some(stats) = &mut account.stats {
                stats.record_compression(prepared.compressed_ticks);
            }
            let frame = self.inputs.entry(account.player_number).or_default();
            frame.input = prepared.frame.input;
            frame.changes.clone_from(&prepared.frame.changes);
        }

        let duration = ticks as f64 * step;
        self.prepare_portals(index);
        self.run_npcs(index, NpcPhase::Update);
        #[cfg(feature = "benchmark-fixtures")]
        self.update_pirate_benchmark(index);
        self.update_gate_access(index, duration);
        self.sectors[index].running.update(
            WorldStepOptions {
                ticks,
                duration: Some(duration),
                inputs: Some(&self.inputs),
            },
            &mut self.events,
        );
        self.keep_destroyed_ships(index);

        self.run_npcs(index, NpcPhase::AfterTick);
        #[cfg(feature = "benchmark-fixtures")]
        self.record_benchmarks(index);
        self.sectors.commit_ids(index);
        self.finish_portals(index);

        for event in &self.events {
            let removed = match event {
                SimulationEvent::AsteroidDestroyed { asteroid_id, .. }
                | SimulationEvent::AsteroidSplit { asteroid_id, .. } => Some(*asteroid_id),
                SimulationEvent::ObjectDestroyed { object_id, .. } => Some(*object_id),
                _ => None,
            };
            if let Some(id) = removed
                && self.sectors[index].running.world.entity(id).is_none()
            {
                self.sectors[index].regions.removed(id);
            }
        }
        self.apply_progress(index);
        self.sectors[index].begin_replication();
        let committed = self.committed_sequence();
        for account in self
            .accounts
            .values_mut()
            .filter(|account| account.sector == index && account.socket.is_some())
        {
            if let Some(entity) = self.sectors[index].running.world.entity(account.ship_id) {
                account.position = entity.model.object().position;
            }
            send_snapshot(
                account,
                &mut self.sectors[index],
                &self.catalog,
                self.world_seed,
                committed,
                true,
            );
        }
        self.send_world_sounds(index);
    }

    pub(super) fn apply_progress(&mut self, index: usize) {
        let mut changed = SmallVec::<[i64; 16]>::new();
        for event in &self.events {
            match event {
                SimulationEvent::ItemCollected { by, unlock, .. } => {
                    if let Some(account) = self.accounts.get_mut(by) {
                        changed.push(*by);
                        if let Some(index) = ["RED", "ORANGE", "YELLOW", "GREEN", "CYAN"]
                            .iter()
                            .position(|color| Some(*color) == unlock.as_deref())
                        {
                            unlock_paint(account, index);
                        }
                    }
                }
                SimulationEvent::Docked {
                    player_number,
                    docked_to,
                } => {
                    if let Some(account) = self.accounts.get_mut(player_number) {
                        changed.push(*player_number);
                        account.visited.push(*docked_to);
                        if account.unlocked_paints & (1 << 3) == 0 {
                            let mut unique = SmallVec::<[i64; 3]>::new();
                            for &visit in &account.visited {
                                if !unique.contains(&visit) {
                                    unique.push(visit);
                                }
                                if unique.len() == 3 {
                                    unlock_paint(account, 3);
                                    break;
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        for account in self
            .accounts
            .values_mut()
            .filter(|account| account.sector == index && account.unlocked_paints & 1 == 0)
        {
            let dead = account
                .hidden
                .as_ref()
                .or_else(|| self.sectors[index].running.world.entity(account.ship_id))
                .is_some_and(|entity| entity.model.object().dead);
            if dead && unlock_paint(account, 0) {
                changed.push(account.player_number);
            }
        }
        for id in changed {
            self.mark_dirty(id, false);
        }
    }

    pub(super) fn send_world_sounds(&mut self, index: usize) {
        let world = &self.sectors[index].running.world;
        let lookup = SoundLookup {
            accounts: &self.accounts,
            sector: index,
            world,
        };
        build_world_sounds(&self.events, &lookup, &mut self.sounds);
        if self.sounds.is_empty() {
            return;
        }

        for account in self
            .accounts
            .values()
            .filter(|account| account.sector == index)
        {
            let Some(client) = &account.socket else {
                continue;
            };
            let sounds = nearby_world_sounds(
                &self.sounds,
                SoundRecipient {
                    player_number: account.player_number,
                    position: account.position,
                    socket_open: client.socket.is_open(),
                    needs_load: account.delivery.needs_load(),
                    welcome_pending: account.welcome_pending,
                    in_world: account.playing,
                    buffered_bytes: client.socket.buffered_bytes(),
                },
                self.catalog.simulation.replication.entity_unload,
                &mut self.nearby_sounds,
            );
            if !sounds.is_empty() {
                send_control(
                    &client.socket,
                    ServerControl::Sounds { sounds },
                    &self.catalog,
                );
            }
        }
    }
}
