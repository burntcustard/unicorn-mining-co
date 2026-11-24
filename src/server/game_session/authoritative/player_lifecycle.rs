use super::*;

impl AuthoritativeSession {
    pub(super) fn create_account(&mut self, now: Instant) -> Option<i64> {
        let player_number = self.next_player_number;
        let sector = self.sectors.start;
        let nearest = self.sectors[sector].regions.nearest_station(Vector::ZERO);
        let (position, radius) = nearest.map_or((Vector::ZERO, 0.0), |station| {
            (station.position, station.radius)
        });
        let (sin, cos) = (player_number as f64 * 2.4).sin_cos();
        let position = round_spawn(position.add_scaled(Vector::new(cos, sin), radius + 250.0));
        let definition = "mustang".to_owned();
        let ship_id = self.spawn_ship(sector, player_number, &definition, position, 0.0, None)?;
        let hidden = self.sectors[sector].running.world.remove_entity(ship_id)?;
        let player_id = uuid::Uuid::new_v4().to_string();
        self.next_player_number += 1;
        self.player_numbers_by_id
            .insert(player_id.clone(), player_number);
        self.accounts.set(
            player_number,
            Account::new(player_number, sector, player_id, hidden, now, &self.catalog),
        );
        self.mark_dirty(player_number, true);
        Some(player_number)
    }

    pub(super) fn spawn_ship(
        &mut self,
        sector: usize,
        player_number: i64,
        definition: &str,
        position: Vector,
        rotation: f64,
        docked_to: Option<i64>,
    ) -> Option<i64> {
        self.sectors.update_ids(sector);
        let world = &mut self.sectors[sector].running.world;
        let id = world.ids.entity();
        let properties = ObjectProperties {
            position,
            rotation,
            player_number: Some(player_number),
            ..Default::default()
        };
        let mut ship = Ship::new_player(id, definition, properties, &self.catalog, || {
            world.ids.object()
        })?;
        ship.craft.docked_to = docked_to;
        world.add_entity(EntityKind::Ship(Box::new(ship)), false);
        self.sectors.commit_ids(sector);
        Some(id)
    }

    pub(super) fn play(&mut self, id: i64) {
        #[cfg(feature = "benchmark-fixtures")]
        self.prepare_benchmark(id);
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        if account.playing {
            return;
        }
        let sector = account.sector;
        let world = &mut self.sectors[sector].running.world;
        if account
            .hidden
            .as_ref()
            .is_some_and(|entity| !entity.model.object().dead)
            && let Some(entity) = account.hidden.take()
        {
            world.wake(entity);
        }
        account.playing = true;
        account.played_at = Some(Instant::now());
        world.set_player(Player {
            player_number: id,
            ship_id: account.ship_id,
            observer_range: 0.0,
        });
        if let Some(client) = &account.socket {
            client.socket.advertise_movement();
        }
        self.sync_regions(sector, None);
        self.send_snapshot(id);
    }

    pub(super) fn set_name(&mut self, id: i64, name: String) {
        let change = set_profile_name(self, id, name);
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        let change = match change {
            Ok(ProfileChange::Ignored) => return,
            Ok(change) => change,
            Err(error) => {
                eprintln!("check player display name: {error}");
                if let Some(client) = &account.socket {
                    client
                        .socket
                        .close_with(1013, "Storage temporarily unavailable");
                }
                return;
            }
        };
        account.profile_pending = true;
        if matches!(change, ProfileChange::Changed { .. }) {
            if let Some(player) = self
                .npc_players
                .iter_mut()
                .find(|player| player.observer_id == id)
            {
                player.display_name.clone_from(&account.name);
            }
            let entity = account.hidden.as_mut().or_else(|| {
                self.sectors[account.sector]
                    .running
                    .world
                    .entity_mut(account.ship_id)
            });
            if let Some(entity) = entity {
                entity
                    .model
                    .object_mut()
                    .target_label
                    .clone_from(&account.name);
            }
        }
        if let ProfileChange::Changed { assigned_owner } = change {
            self.mark_dirty(id, true);
            if let Some(owner) = assigned_owner.filter(|&owner| owner != id) {
                self.mark_dirty(owner, true);
            }
        }
        self.send_snapshot(id);
    }

    pub(super) fn respawn(&mut self, id: i64) {
        let Some(account) = self.accounts.get(&id) else {
            return;
        };
        if account.hangar.no_ship {
            return;
        }
        let ship_id = account.ship_id;
        let source = account.sector;
        let sector = &mut self.sectors[source];
        let world = &sector.running.world;
        if let Some(entity) = world.entity(ship_id)
            && let EntityKind::Ship(ship) = &entity.model
            && (ship.engine().is_some() && ship.fuel > 0.0
                || ship.craft.docked()
                || ship.craft.launching != 0.0)
        {
            return;
        }

        let position = world
            .entity(ship_id)
            .map_or(account.position, |entity| entity.model.object().position);
        let nearest = sector.regions.nearest_station(position);
        let relocating = nearest.is_none();
        let (index, nearest) = if relocating {
            let start = self.sectors.start;
            (
                start,
                self.sectors[start].regions.nearest_station(Vector::ZERO),
            )
        } else {
            (source, nearest)
        };
        let Some(nearest) = nearest else {
            return;
        };
        let station_id = self.sectors[index].regions.id_offset + i64::from(nearest.id);
        let definition = account.definition.clone();
        self.sync_regions(index, Some(nearest.position));
        let world = &mut self.sectors[index].running.world;
        let Some(station) = world
            .entity(station_id)
            .filter(|station| matches!(station.model, EntityKind::Station(_)))
        else {
            return;
        };
        let object = station.model.object();
        let (position, rotation) = (object.position, object.rotation);
        let Some(replacement) =
            self.spawn_ship(index, id, &definition, position, rotation, Some(station_id))
        else {
            return;
        };
        let source_world = &mut self.sectors[source].running.world;
        source_world.remove_entity(ship_id);
        let source_tick = source_world.tick;
        if relocating {
            source_world.remove_player(id);
            self.inputs.remove(&id);
        }
        let account = self
            .accounts
            .get_mut(&id)
            .expect("respawning account exists");
        if let Some(entity) = self.sectors[index].running.world.entity_mut(replacement) {
            entity
                .model
                .object_mut()
                .target_label
                .clone_from(&account.name);
        }
        account.ship_id = replacement;
        account.hidden = None;
        if relocating {
            account.sector = index;
            reset_location(
                account,
                SectorArrival {
                    position,
                    ..Default::default()
                },
                source_tick,
            );
        } else {
            account.position = position;
            account.inputs.discard_pending(Input::default());
            account.delivery.require_load();
        }
        account.inputs.clear_input_lead();
        self.sectors[index].running.world.set_player(Player {
            player_number: id,
            ship_id: replacement,
            observer_range: 0.0,
        });
        account.respawn_pending = true;
        account.hangar.response = Some("");
        self.mark_dirty(id, false);
        self.send_snapshot(id);
    }

    pub(super) fn hide_disconnected(&mut self, now: Instant) {
        if !self.pending_ship_hiding {
            return;
        }
        self.pending_ship_hiding = false;
        let cooldown = Duration::from_secs_f64(self.catalog.simulation.flight.launch_duration);
        let mut hidden = SmallVec::<[i64; 16]>::new();
        for account in self.accounts.values_mut() {
            let Some(disconnected_at) = account.disconnected_at else {
                continue;
            };
            if account.socket.is_some() || account.hidden.is_some() {
                continue;
            }
            if now.saturating_duration_since(disconnected_at) < cooldown {
                self.pending_ship_hiding = true;
                continue;
            }
            let world = &mut self.sectors[account.sector].running.world;
            let Some(mut entity) = world.remove_entity(account.ship_id) else {
                self.pending_ship_hiding = true;
                continue;
            };
            if let EntityKind::Ship(ship) = &mut entity.model {
                reset_disconnected_movement(ship);
                account.position = ship.craft.object.position;
            }
            account.hidden = Some(entity);
            hidden.push(account.player_number);
        }
        for id in hidden {
            self.mark_dirty(id, false);
        }
    }

    pub(super) fn keep_destroyed_ships(&mut self, index: usize) {
        let destroyed = self.sectors[index].running.world.take_destroyed_ships();
        for entity in destroyed {
            self.sectors[index].npcs.remember_destroyed_ship(&entity);
            let object = entity.model.object();
            let Some(id) = object.player_number else {
                continue;
            };
            if let Some(account) = self.accounts.get_mut(&id)
                && account.sector == index
                && account.ship_id == object.id
            {
                if let Some(player) = self
                    .npc_players
                    .iter_mut()
                    .find(|player| player.observer_id == id)
                {
                    player.ship_dead = true;
                }
                account.position = object.position;
                account.hidden = Some(entity);
                self.mark_dirty(id, false);
            }
        }
    }
}
