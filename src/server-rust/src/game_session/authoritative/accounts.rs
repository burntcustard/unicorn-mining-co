use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::game_session::world_checkpoint::{CHECKPOINT_BUDGET, WorldCheckpoint};
use crate::npc::world_host::NpcWorld;
use crate::objects::saved_ship::SavedShip;
use crate::persistence::{
    SaveBatch, SaveWriter, SavedPlayer, Store, WorldState, generation_digest,
};
use crate::simulation::saved_entity::SavedModel;

use super::{Account, AuthoritativeSession, EntityKind};

pub(super) type AccountWriter = SaveWriter<SavedShip, SavedModel>;
// The account and sector checkpoints share one SQLite transaction.
const FLUSH_INTERVAL: Duration = Duration::from_secs(30);
const FLUSH_DEADLINE: Duration = Duration::from_secs(60);
const CHECKPOINT_INTERVAL: Duration = Duration::from_secs(3 * 60);
const BATCH_SIZE: usize = 256;

pub(super) struct AccountStorage {
    writer: AccountWriter,
    generation_digest: String,
    sequence: u64,
    pending: BTreeSet<i64>,
    critical: bool,
    flush_at: Instant,
    flush_deadline: Instant,
    checkpoint_at: Instant,
    available: Arc<AtomicBool>,
}

impl AuthoritativeSession {
    /// Open the native SQLite store before accepting clients.
    pub fn open_player_accounts(
        &mut self,
        path: impl AsRef<Path>,
        backup_directory: PathBuf,
    ) -> io::Result<()> {
        if self.storage.is_some() || !self.accounts.is_empty() {
            return Err(io::Error::other(
                "open account storage before accepting connections",
            ));
        }
        let store = Store::open(path).map_err(io::Error::other)?;
        let digest = generation_digest(&self.catalog).map_err(io::Error::other)?;
        let now = Instant::now();
        self.sectors.enable_storage();
        if let Some(saved) = store
            .load_world(self.world_seed)
            .map_err(io::Error::other)?
        {
            if saved.generation_digest != digest {
                return Err(io::Error::other(
                    "world generation rules changed; use a fresh world database before starting",
                ));
            }
            self.sectors.tick = saved.tick;
            self.sectors.next_entity_id = self.sectors.next_entity_id.max(saved.next_entity_id);
            let mut entity_rows = BTreeMap::<_, Vec<_>>::new();
            for entity in store
                .load_entities::<SavedModel>()
                .map_err(io::Error::other)?
            {
                entity_rows
                    .entry(entity.sector_id.clone())
                    .or_default()
                    .push(entity);
            }
            for (name, state) in &saved.sectors {
                let index = self
                    .sectors
                    .index_of(name)
                    .ok_or_else(|| io::Error::other("unknown saved sector"))?;
                self.sectors.load(index, now, state.tick)?;
                let sector = &mut self.sectors[index];
                WorldCheckpoint::restore_sector_state(&mut sector.running.world, state);
                sector
                    .checkpoint
                    .restore(
                        &mut sector.running.world,
                        &mut sector.regions,
                        entity_rows.remove(name).unwrap_or_default(),
                    )
                    .map_err(io::Error::other)?;
                self.sectors.commit_ids(index);
            }
            for (name, rows) in entity_rows {
                let index = self
                    .sectors
                    .index_of(&name)
                    .ok_or_else(|| io::Error::other("unknown saved sector"))?;
                self.sectors.load(index, now, self.sectors.tick)?;
                let sector = &mut self.sectors[index];
                sector
                    .checkpoint
                    .restore(&mut sector.running.world, &mut sector.regions, rows)
                    .map_err(io::Error::other)?;
            }
            let start = self.sectors.start;
            let world = &mut self.sectors[start].running.world;
            world.tick = saved.tick;
            world.ids.next_entity = world.ids.next_entity.max(saved.next_entity_id);
            world.ids.last_object = world.ids.last_object.min(saved.next_object_id);
            store
                .for_each_player(|player| self.restore_account(player, now).map_err(Into::into))
                .map_err(io::Error::other)?;
            for (id, state) in saved.sectors {
                let index = self.sectors.index_of(&id).expect("loaded sector");
                for account in self
                    .accounts
                    .values_mut()
                    .filter(|account| account.sector == index)
                {
                    account.encounter_after = state
                        .pirate_cooldowns
                        .get(&account.token)
                        .copied()
                        .unwrap_or_default();
                }
                self.prepare_npc_players(index);
                let sector = &mut self.sectors[index];
                sector
                    .npcs
                    .restore(
                        NpcWorld {
                            running: &mut sector.running,
                            regions: &mut sector.regions,
                            players: &mut self.npc_players,
                            next_observer_id: &mut self.next_player_id,
                            inputs: &mut self.inputs,
                        },
                        &state,
                    )
                    .map_err(io::Error::other)?;
                self.sectors.commit_ids(index);
            }
        }
        self.storage = Some(AccountStorage {
            writer: store.start(backup_directory).map_err(io::Error::other)?,
            generation_digest: digest,
            sequence: 0,
            pending: BTreeSet::new(),
            critical: false,
            flush_at: now + FLUSH_INTERVAL,
            flush_deadline: now + FLUSH_DEADLINE,
            checkpoint_at: now + CHECKPOINT_INTERVAL,
            available: Arc::new(AtomicBool::new(true)),
        });
        Ok(())
    }

    fn restore_account(
        &mut self,
        mut saved: SavedPlayer<SavedShip>,
        now: Instant,
    ) -> io::Result<()> {
        let index = if saved.sector_id.is_empty() {
            self.sectors.start
        } else {
            self.sectors
                .index_of(&saved.sector_id)
                .ok_or_else(|| io::Error::other("unknown player sector"))?
        };
        self.sectors.load(index, now, self.sectors.tick)?;
        let id = self.next_player_id;
        let ship_id = saved.ship.id;
        let mut ship = saved
            .ship
            .restore(id, &self.catalog)
            .map_err(io::Error::other)?;
        ship.craft
            .object
            .target_label
            .clone_from(&saved.display_name);
        let world = &mut self.sectors[index].running.world;
        world.add_entity(EntityKind::Ship(Box::new(ship)), false);
        let entity = world
            .remove_entity(ship_id)
            .ok_or_else(|| io::Error::other("restored ship missing"))?;
        world.ids.record_entity(ship_id);
        let mut account = Account::new(id, index, saved.id, entity, now, &self.catalog);
        account.hangar.restore(&mut saved.ship, id, world)?;
        self.sectors.commit_ids(index);
        account.name = saved.display_name;
        account.role = saved.role;
        account.banned = saved.banned;
        account.first_joined_at = saved.first_joined_at;
        account.last_seen_at = saved.last_seen_at;
        account.played_for = saved.played_for;
        account.credits = saved.credits;
        account.unlocked_paints = saved.unlocked_paints;
        account.visited = saved.visited;
        self.tokens.insert(account.token.clone(), id);
        self.accounts.set(id, account);
        self.next_player_id += 1;
        Ok(())
    }

    pub fn storage_health(&self) -> impl Fn() -> bool + Send + Sync + 'static {
        let health = self
            .storage
            .as_ref()
            .map(|storage| Arc::clone(&storage.available));
        move || {
            health
                .as_ref()
                .is_none_or(|health| health.load(Ordering::Acquire))
        }
    }

    pub(super) fn mark_dirty(&mut self, id: i64, critical: bool) {
        if let Some(storage) = &mut self.storage {
            storage.pending.insert(id);
            if critical && let Some(account) = self.accounts.get_mut(&id) {
                account.save_sequence = u64::MAX;
                storage.critical = true;
            }
        }
    }

    pub(super) fn persistence_ready(&mut self, now: Instant) -> bool {
        let Some(storage) = &self.storage else {
            return true;
        };
        let ready = storage.writer.failure().is_none();
        storage.available.store(ready, Ordering::Release);
        let backlog = !storage.pending.is_empty()
            || self
                .sectors
                .active()
                .any(|sector| sector.checkpoint.pending_count() != 0);
        ready
            && (!backlog || storage.writer.has_capacity())
            && (!storage.critical || self.flush_accounts(now, false))
    }

    pub(super) fn committed_sequence(&self) -> u64 {
        self.storage
            .as_ref()
            .map_or(0, |storage| storage.writer.committed())
    }

    pub(super) fn background_save(&mut self, now: Instant) {
        let Some(storage) = &mut self.storage else {
            return;
        };
        if now >= storage.checkpoint_at {
            storage.pending.extend(
                self.accounts
                    .values()
                    .filter(|account| account.socket.is_some())
                    .map(|account| account.id),
            );
            storage.checkpoint_at = now + CHECKPOINT_INTERVAL;
        }
        let mut pending = 0;
        let mut budget = CHECKPOINT_BUDGET;
        for sector in self.sectors.active_mut() {
            budget = sector.checkpoint.advance_with_budget(
                now,
                &mut sector.running.world,
                &sector.regions,
                budget,
            );
            pending += sector.checkpoint.pending_count();
        }
        let due = now >= storage.flush_at || pending >= BATCH_SIZE;
        let spare = now.elapsed().as_secs_f64() < self.catalog.simulation.simulation_step / 2.0;
        if now >= storage.flush_deadline || (due && spare) {
            self.flush_accounts(now, false);
        }
    }

    fn flush_accounts(&mut self, now: Instant, force: bool) -> bool {
        let Some(storage) = &mut self.storage else {
            return true;
        };
        for sector in self.sectors.active_mut() {
            for (player_id, ship_id) in sector.running.world.drain_changed_player_ships() {
                if self
                    .accounts
                    .get(&player_id)
                    .is_some_and(|account| account.ship_id == ship_id)
                {
                    storage.pending.insert(player_id);
                }
            }
        }
        if !force
            && storage.pending.is_empty()
            && self
                .sectors
                .active()
                .all(|sector| sector.checkpoint.pending_count() == 0)
        {
            storage.flush_at = now + FLUSH_INTERVAL;
            storage.flush_deadline = now + FLUSH_DEADLINE;
            return true;
        }
        if !storage.writer.has_capacity() {
            return false;
        }
        let started = Instant::now();
        let batch = match self.capture_batch(now) {
            Ok(batch) => batch,
            Err(error) => {
                eprintln!("capture sector checkpoint: {error}");
                self.storage
                    .as_ref()
                    .expect("open storage")
                    .available
                    .store(false, Ordering::Release);
                return false;
            }
        };
        let storage = self.storage.as_mut().expect("open storage");
        let players = batch.players.len();
        let entities = batch.entities.len();
        if !storage.writer.try_submit(batch) {
            return false;
        }
        storage.sequence += 1;
        for id in &storage.pending {
            if let Some(account) = self.accounts.get_mut(id)
                && account.save_sequence == u64::MAX
            {
                account.save_sequence = storage.sequence;
            }
        }
        storage.pending.clear();
        storage.critical = false;
        storage.flush_at = now + FLUSH_INTERVAL;
        storage.flush_deadline = now + FLUSH_DEADLINE;
        if let Some(load) = &mut self.load {
            load.record_save(started.elapsed(), players as u64, entities as u64);
        }
        true
    }

    pub(super) fn finish_storage(
        &mut self,
        deadline: Instant,
    ) -> io::Result<Option<AccountWriter>> {
        let Some(storage) = &mut self.storage else {
            return Ok(None);
        };
        storage
            .pending
            .extend(self.accounts.values().map(|account| account.id));
        for sector in self.sectors.active_mut() {
            sector.checkpoint.stage_active(&sector.running.world);
        }
        while !self.flush_accounts(Instant::now(), true) {
            if Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "account save queue did not drain",
                ));
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        Ok(self.storage.take().map(|storage| storage.writer))
    }
    fn capture_batch(&mut self, now: Instant) -> Result<SaveBatch<SavedShip, SavedModel>, String> {
        let mut states = BTreeMap::new();
        let indices = self
            .sectors
            .indices()
            .collect::<smallvec::SmallVec<[usize; 16]>>();
        for index in indices {
            self.prepare_npc_players(index);
            let sector = &mut self.sectors[index];
            let mut state = WorldCheckpoint::sector_state(&sector.running.world);
            state.pirate_cooldowns.extend(
                self.npc_players
                    .iter()
                    .filter(|player| player.in_sector && player.encounter_after != 0)
                    .map(|player| (player.account.clone(), player.encounter_after)),
            );
            sector.npcs.capture(
                NpcWorld {
                    running: &mut sector.running,
                    regions: &mut sector.regions,
                    players: &mut self.npc_players,
                    next_observer_id: &mut self.next_player_id,
                    inputs: &mut self.inputs,
                },
                &mut state,
            )?;
            states.insert(sector.sector.id.clone(), state);
        }
        let storage = self.storage.as_ref().expect("open storage");
        let players = storage
            .pending
            .iter()
            .filter_map(|id| {
                let account = self.accounts.get_mut(id)?;
                account.update_session_time(now);
                let sector = &self.sectors[account.sector];
                let world = &sector.running.world;
                let entity = account
                    .hidden
                    .as_ref()
                    .or_else(|| world.entity(account.ship_id))?;
                let EntityKind::Ship(ship) = &entity.model else {
                    return None;
                };
                Some(SavedPlayer {
                    id: account.token.clone(),
                    display_name: account.name.clone(),
                    role: account.role,
                    banned: account.banned,
                    first_joined_at: account.first_joined_at,
                    last_seen_at: account.last_seen_at,
                    played_for: account.played_for,
                    credits: account.credits,
                    unlocked_paints: account.unlocked_paints,
                    visited: account.visited.clone(),
                    ship: account.hangar.capture(ship, &self.catalog),
                    sector_id: sector.sector.id.clone(),
                })
            })
            .collect();
        let mut entities = Vec::new();
        for sector in self.sectors.active_mut() {
            let id = &sector.sector.id;
            let world = &mut sector.running.world;
            entities.extend(sector.checkpoint.capture(id, world, &sector.regions));
        }
        let start = &self.sectors[self.sectors.start].running.world;
        Ok(SaveBatch {
            sequence: storage.sequence + 1,
            world: WorldState {
                generation_digest: storage.generation_digest.clone(),
                seed: self.world_seed,
                tick: self.sectors.tick,
                random_state: start.random.state(),
                next_entity_id: self.sectors.next_entity_id,
                next_object_id: start.ids.last_object,
                sectors: states,
            },
            players,
            entities,
        })
    }
}

pub(super) fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use crate::game_server::Session;
    use crate::objects::craft::CargoObject;
    use crate::objects::item::Item;
    use crate::simulation::game_object::{GameObject, ObjectProperties};
    use crate::specs::Catalog;
    use crate::vector::Vector;

    use super::*;

    #[tokio::test]
    async fn graceful_shutdown_saves_current_world_entity_positions() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let path = std::env::temp_dir().join(format!("unicorn-shutdown-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        let db = path.join("world.sqlite");
        let backups = path.join("backups");
        let mut session = AuthoritativeSession::new(25.0, Arc::clone(&catalog)).unwrap();
        session.open_player_accounts(&db, backups.clone()).unwrap();
        let start = session.sectors.start;
        let world = &mut session.sectors[start].running.world;
        let id = world.ids.entity();
        let item = GameObject::new(id, ObjectProperties::default(), &catalog.simulation);
        world.add_entity(EntityKind::Object(Box::new(item)), false);
        assert!(session.flush_accounts(Instant::now(), true));

        let position = Vector::new(120.0, 40.0);
        session.sectors[start]
            .running
            .world
            .entity_mut(id)
            .unwrap()
            .model
            .object_mut()
            .position = position;
        session
            .shutdown(tokio::time::Instant::now() + Duration::from_secs(5))
            .await
            .unwrap();
        drop(session);

        let mut resumed = AuthoritativeSession::new(25.0, catalog).unwrap();
        resumed.open_player_accounts(&db, backups).unwrap();
        let saved = resumed.sectors[start]
            .regions
            .sleeping(id)
            .expect("saved world entity");
        let saved_position = saved.model.object().position;
        resumed
            .shutdown(tokio::time::Instant::now() + Duration::from_secs(5))
            .await
            .unwrap();
        std::fs::remove_dir_all(path).unwrap();
        assert_eq!(saved_position, position);
    }

    #[test]
    fn dropped_cargo_and_its_owner_commit_in_the_same_batch() {
        fn ship(
            session: &mut AuthoritativeSession,
            sector: usize,
            id: i64,
        ) -> &mut super::super::Ship {
            let entity = session.sectors[sector]
                .running
                .world
                .entity_mut(id)
                .unwrap();
            let EntityKind::Ship(ship) = &mut entity.model else {
                panic!("missing player ship");
            };
            ship
        }

        let catalog = Arc::new(Catalog::load().unwrap());
        let path =
            std::env::temp_dir().join(format!("unicorn-cargo-save-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        let db = path.join("world.sqlite");
        let mut session = AuthoritativeSession::new(25.0, Arc::clone(&catalog)).unwrap();
        session
            .open_player_accounts(&db, path.join("backups"))
            .unwrap();
        let id = session.create_account(Instant::now()).unwrap();
        session.play(id);
        let ship_id = session.accounts.get(&id).unwrap().ship_id;
        let start = session.sectors.start;
        let item = Item::new(-50, "gold", ObjectProperties::default(), &catalog).unwrap();
        ship(&mut session, start, ship_id)
            .craft
            .cargo_contents
            .push(CargoObject::Item(Box::new(item)));
        assert!(session.flush_accounts(Instant::now(), true));
        assert!(session.storage.as_ref().unwrap().pending.is_empty());

        let player_ship = ship(&mut session, start, ship_id);
        player_ship.cargo_release(&catalog);
        player_ship.craft.update_modules(5.0, 1.0, None);
        session.tick(1);
        assert!(
            ship(&mut session, start, ship_id)
                .craft
                .cargo_contents
                .is_empty()
        );
        let dropped_id = session.sectors[start]
            .running
            .world
            .entities()
            .find_map(|entity| {
                (entity.model.object().dropped_by == Some(id)).then_some(entity.model.object().id)
            })
            .unwrap();
        let now = Instant::now();
        session.storage.as_mut().unwrap().flush_deadline = now;
        session.background_save(now);

        // Drain only submitted writes. Do not stage the shutdown checkpoint.
        let storage = session.storage.take().unwrap();
        storage.writer.close(now + Duration::from_secs(5)).unwrap();
        let store = Store::open(&db).unwrap();
        let saved = store.load::<SavedShip, SavedModel>(25.0).unwrap().unwrap();
        drop(store);
        std::fs::remove_dir_all(path).unwrap();
        assert!(
            saved
                .entities
                .iter()
                .any(|entity| entity.id == dropped_id && entity.state.is_some())
        );
        assert!(saved.players[0].ship.cargo.is_empty());
    }
}
