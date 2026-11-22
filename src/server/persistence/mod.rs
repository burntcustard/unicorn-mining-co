use std::collections::{BTreeMap, HashMap};
use std::error::Error;
use std::fs::{File, OpenOptions};
use std::io;
use std::ops::Range;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use rusqlite::{Connection, OpenFlags, OptionalExtension, Row, Transaction, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::mpsc as inbox;

use crate::game_session::name_key;
use crate::specs::Catalog;

mod backups;
#[cfg(test)]
mod tests;
pub use backups::{BackupAction, create_backup, manage_backups, reset};

type Result<T> = std::result::Result<T, Box<dyn Error + Send + Sync>>;

const QUEUE_CAPACITY: usize = 64;
const BACKUP_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const RETRY_INTERVAL: Duration = Duration::from_secs(1);
pub const DEFAULT_PAINTS: u16 = (1 << 9) - 1;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum PlayerRole {
    #[default]
    User,
    Admin,
    Owner,
}

impl PlayerRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Admin => "admin",
            Self::Owner => "owner",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "user" => Ok(Self::User),
            "admin" => Ok(Self::Admin),
            "owner" => Ok(Self::Owner),
            _ => Err(format!("unknown saved role {value:?}").into()),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct SectorState {
    pub tick: u64,
    pub random_state: f64,
    pub next_entity_id: i64,
    pub next_object_id: i64,
    pub pirate_dispatch_at: u64,
    pub pirate_cooldowns: BTreeMap<String, u64>,
    pub npcs: Vec<SavedNpc>,
    pub npc_dispatch: serde_json::Value,
    pub marauder_dispatch: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SavedNpc {
    pub kind: String,
    pub id: i64,
    pub state: serde_json::Value,
    pub model: String,
}

#[derive(Debug, Default)]
pub struct WorldState {
    pub sectors: BTreeMap<String, SectorState>,
    pub generation_digest: String,
    pub seed: f64,
    pub tick: u64,
    pub random_state: f64,
    pub next_entity_id: i64,
    pub next_object_id: i64,
}

pub fn generation_digest(catalog: &Catalog) -> Result<String> {
    let contents = serde_json::to_vec(&(
        &catalog.sector_generation,
        &catalog.sector_names,
        &catalog.region_generation,
        catalog.simulation.region_size,
        &catalog.item_ids,
    ))?;
    Ok(format!("{:x}", Sha256::digest(contents)))
}

#[derive(Debug)]
pub struct SavedPlayer<Ship> {
    pub id: String,
    pub display_name: String,
    pub role: PlayerRole,
    pub banned: bool,
    pub first_joined_at: i64,
    pub last_seen_at: i64,
    pub played_for: f64,
    pub credits: f64,
    pub unlocked_paints: u16,
    pub visited: Vec<i64>,
    pub ship: Ship,
    pub sector_id: String,
}

/// A live record has a state. A generated entity may instead have a tombstone.
#[derive(Debug)]
pub struct SavedEntity<State> {
    pub id: i64,
    pub sector_id: String,
    pub generated: bool,
    pub state: Option<State>,
}

pub trait EntityState {
    fn id(&self) -> i64;
}

#[derive(Debug)]
pub struct SaveBatch<Ship, Entity> {
    pub sequence: u64,
    pub world: WorldState,
    pub players: Vec<SavedPlayer<Ship>>,
    pub entities: Vec<SavedEntity<Entity>>,
}

#[derive(Debug)]
pub struct SavedWorld<Ship, Entity> {
    pub world: WorldState,
    pub players: Vec<SavedPlayer<Ship>>,
    pub entities: Vec<SavedEntity<Entity>>,
}

pub struct Store {
    path: PathBuf,
    connection: Connection,
    _lock: File,
}

pub(crate) struct AccountReader {
    connection: Connection,
}

const PLAYER_COLUMNS: &str = "id,display_name,role,banned,first_joined_at,last_seen_at,played_for,credits,unlocked_paints,visited,ship,sector";
const OWNER_LOOKUP: &str = "SELECT EXISTS(SELECT 1 FROM players WHERE role='owner')";
const PROFILE_LOOKUP: &str = "SELECT id,role FROM players WHERE display_name_key=?";
const UPDATE_NAME_KEY: &str =
    "UPDATE players SET display_name_key=? WHERE id=? AND display_name_key IS NULL";

fn read_player<Ship: DeserializeOwned>(row: &Row<'_>) -> Result<SavedPlayer<Ship>> {
    Ok(SavedPlayer {
        id: row.get(0)?,
        display_name: row.get(1)?,
        role: PlayerRole::parse(row.get_ref(2)?.as_str()?)?,
        banned: row.get(3)?,
        first_joined_at: row.get(4)?,
        last_seen_at: row.get(5)?,
        played_for: row.get::<_, i64>(6)? as f64,
        credits: row.get::<_, i64>(7)? as f64,
        unlocked_paints: row.get(8)?,
        visited: serde_json::from_str(row.get_ref(9)?.as_str()?)?,
        ship: serde_json::from_str(row.get_ref(10)?.as_str()?)?,
        sector_id: row.get(11)?,
    })
}

impl AccountReader {
    pub(crate) fn player<Ship: DeserializeOwned>(
        &self,
        token: &str,
    ) -> Result<Option<SavedPlayer<Ship>>> {
        self.connection
            .prepare_cached(&format!("SELECT {PLAYER_COLUMNS} FROM players WHERE id=?"))?
            .query([token])?
            .next()?
            .map(read_player)
            .transpose()
    }

    pub(crate) fn observer(&self, token: &str) -> Result<Option<i64>> {
        Ok(self
            .connection
            .prepare_cached("SELECT observer FROM player_observers WHERE id=?")?
            .query_row([token], |row| row.get(0))
            .optional()?)
    }

    pub(crate) fn record_observer(&self, token: &str, observer: i64) -> Result<()> {
        self.connection
            .prepare_cached(
                "INSERT INTO player_observers(id,observer) VALUES(?,?) ON CONFLICT(id) DO NOTHING",
            )?
            .execute(params![token, observer])?;
        Ok(())
    }

    pub(crate) fn has_owner(&self) -> Result<bool> {
        Ok(self
            .connection
            .prepare_cached(OWNER_LOOKUP)?
            .query_row([], |row| row.get(0))?)
    }

    pub(crate) fn matching_profiles(
        &self,
        name: &str,
        mut include: impl FnMut(&str) -> bool,
    ) -> Result<Vec<(String, PlayerRole)>> {
        if name.is_empty() {
            return Ok(Vec::new());
        }
        let mut query = self.connection.prepare_cached(PROFILE_LOOKUP)?;
        let mut rows = query.query([name_key(name)])?;
        let mut found = Vec::new();
        while let Some(row) = rows.next()? {
            let token = row.get_ref(0)?.as_str()?;
            if include(token) {
                found.push((
                    token.to_owned(),
                    PlayerRole::parse(row.get_ref(1)?.as_str()?)?,
                ));
                if found.len() == 2 {
                    break;
                }
            }
        }
        Ok(found)
    }
}

const CREATE_SCHEMA: &str = "CREATE TABLE world (
    id INTEGER PRIMARY KEY CHECK(id=1), seed REAL NOT NULL,
    generation_digest TEXT NOT NULL, tick INTEGER NOT NULL,
    random_state REAL NOT NULL, next_entity_id INTEGER NOT NULL,
    next_object_id INTEGER NOT NULL, sectors TEXT NOT NULL
);
CREATE TABLE players (
    id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, display_name_key TEXT,
    role TEXT NOT NULL CHECK(role IN ('user','admin','owner')),
    banned INTEGER NOT NULL CHECK(banned IN (0,1)),
    first_joined_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
    played_for INTEGER NOT NULL CHECK(typeof(played_for)='integer' AND played_for>=0),
    credits INTEGER NOT NULL CHECK(typeof(credits)='integer' AND credits>=0),
    unlocked_paints INTEGER NOT NULL CHECK(unlocked_paints BETWEEN 0 AND 511),
    visited TEXT NOT NULL, ship TEXT NOT NULL, sector TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE entities (
    id INTEGER PRIMARY KEY, sector TEXT NOT NULL, generated INTEGER NOT NULL, state BLOB
);
CREATE INDEX players_display_name_key ON players(display_name_key);
CREATE INDEX players_owner ON players(role) WHERE role='owner';
CREATE TRIGGER players_invalidate_name_key AFTER UPDATE OF display_name ON players
WHEN NEW.display_name IS NOT OLD.display_name
BEGIN
    UPDATE players SET display_name_key=NULL WHERE id=NEW.id;
END;";

fn refresh_name_keys(tx: &Transaction<'_>) -> Result<()> {
    let mut missing_keys =
        tx.prepare("SELECT id,display_name FROM players WHERE display_name_key IS NULL LIMIT 256")?;
    let mut update_key = tx.prepare(UPDATE_NAME_KEY)?;
    loop {
        let names = missing_keys
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if names.is_empty() {
            return Ok(());
        }
        for (id, name) in names {
            update_key.execute(params![name_key(&name), id])?;
        }
    }
}

pub(super) fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    name.into()
}

pub(super) fn directory_of(path: &Path) -> &Path {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
}

pub(super) fn create_directory(path: &Path) -> io::Result<()> {
    std::fs::DirBuilder::new()
        .mode(0o700)
        .recursive(true)
        .create(path)
}

pub(super) fn lock_database(path: &Path) -> io::Result<File> {
    create_directory(directory_of(path))?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .mode(0o600)
        .create(true)
        .truncate(false)
        .open(with_suffix(path, ".lock"))?;
    lock.try_lock().map_err(io::Error::from)?;
    Ok(lock)
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let lock =
            lock_database(path).map_err(|error| format!("cannot lock world database: {error}"))?;
        let fresh = match std::fs::metadata(path) {
            Ok(metadata) => metadata.len() == 0,
            Err(error) if error.kind() == io::ErrorKind::NotFound => true,
            Err(error) => return Err(error.into()),
        };
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(1))?;
        connection.execute_batch("PRAGMA synchronous=FULL;")?;
        let tx = connection.transaction()?;
        if fresh {
            tx.execute_batch(CREATE_SCHEMA)?;
        } else {
            // Maintenance can edit names directly while the server is stopped.
            refresh_name_keys(&tx)?;
        }
        tx.commit()?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=1000;")?;
        Ok(Self {
            path: path.to_owned(),
            connection,
            _lock: lock,
        })
    }

    pub fn load<Ship: DeserializeOwned, Entity: DeserializeOwned + EntityState>(
        &self,
        seed: f64,
    ) -> Result<Option<SavedWorld<Ship, Entity>>> {
        let Some(world) = self.load_world(seed)? else {
            return Ok(None);
        };
        let mut players = Vec::new();
        self.for_each_player(|player| {
            players.push(player);
            Ok(())
        })?;
        Ok(Some(SavedWorld {
            world,
            players,
            entities: self.load_entities()?,
        }))
    }

    pub(crate) fn account_reader(&self) -> Result<AccountReader> {
        let connection = Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        connection.busy_timeout(Duration::from_millis(10))?;
        // World objects may still refer to a player who reconnects in this run.
        connection.execute_batch(
            "PRAGMA temp_store=FILE;
             CREATE TEMP TABLE player_observers (id TEXT PRIMARY KEY, observer INTEGER NOT NULL) WITHOUT ROWID;",
        )?;
        Ok(AccountReader { connection })
    }

    pub(crate) fn load_world(&self, seed: f64) -> Result<Option<WorldState>> {
        let world_row = self.connection.query_row(
            "SELECT seed,generation_digest,tick,random_state,next_entity_id,next_object_id,sectors FROM world WHERE id=1",
            [],
            |row| Ok((WorldState {
                seed: row.get(0)?, generation_digest: row.get(1)?, tick: row.get::<_, i64>(2)? as u64, random_state: row.get(3)?,
                next_entity_id: row.get(4)?, next_object_id: row.get(5)?, ..WorldState::default()
            }, row.get::<_, String>(6)?)),
        ).optional()?;
        let Some((mut world, sectors)) = world_row else {
            return Ok(None);
        };
        if world.seed != seed {
            return Err(
                "saved world seed differs; use a fresh world database before changing WORLD_SEED"
                    .into(),
            );
        }
        world.sectors = serde_json::from_str(&sectors)?;
        Ok(Some(world))
    }

    pub(crate) fn for_each_player<Ship: DeserializeOwned>(
        &self,
        mut restore: impl FnMut(SavedPlayer<Ship>) -> Result<()>,
    ) -> Result<()> {
        let mut player_query = self
            .connection
            .prepare(&format!("SELECT {PLAYER_COLUMNS} FROM players ORDER BY id"))?;
        let mut rows = player_query.query([])?;
        while let Some(row) = rows.next()? {
            restore(read_player(row)?)?;
        }
        Ok(())
    }

    pub(crate) fn load_entities<Entity: DeserializeOwned + EntityState>(
        &self,
    ) -> Result<Vec<SavedEntity<Entity>>> {
        let mut entities = Vec::new();
        let mut entity_query = self
            .connection
            .prepare("SELECT id,sector,generated,state FROM entities ORDER BY id")?;
        let mut rows = entity_query.query([])?;
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let state: Option<Entity> = match row.get_ref(3)? {
                rusqlite::types::ValueRef::Null => None,
                value => Some(ciborium::from_reader(value.as_blob()?)?),
            };
            if state.as_ref().is_some_and(|state| state.id() != id) {
                return Err(format!("saved entity ID mismatch: {id}").into());
            }
            entities.push(SavedEntity {
                id,
                sector_id: row.get(1)?,
                generated: row.get(2)?,
                state,
            });
        }
        Ok(entities)
    }

    fn save<Ship: Serialize, Entity: Serialize + EntityState>(
        &mut self,
        batch: &SaveBatch<Ship, Entity>,
    ) -> Result<()> {
        let world = &batch.world;
        let sectors = serde_json::to_string(&world.sectors)?;
        let mut player_values = Vec::with_capacity(batch.players.len());
        for player in &batch.players {
            player_values.push((
                serde_json::to_string(&player.visited)?,
                serde_json::to_string(&player.ship)?,
            ));
        }
        // Encode into one buffer outside the transaction. A state may contain
        // non-finite floating point values, which CBOR retains as numbers.
        let mut bytes = Vec::new();
        let mut entity_values: Vec<Option<Range<usize>>> = Vec::with_capacity(batch.entities.len());
        for entity in &batch.entities {
            let slot = if let Some(state) = &entity.state {
                if state.id() != entity.id {
                    return Err(format!("saved entity ID mismatch: {}", entity.id).into());
                }
                let start = bytes.len();
                ciborium::into_writer(state, &mut bytes)?;
                Some(start..bytes.len())
            } else {
                None
            };
            entity_values.push(slot);
        }
        let tx = self.connection.transaction()?;
        tx.execute(
            "INSERT INTO world(id,seed,generation_digest,tick,random_state,next_entity_id,next_object_id,sectors)
             VALUES(1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET seed=excluded.seed,generation_digest=excluded.generation_digest,
             tick=excluded.tick,random_state=excluded.random_state,next_entity_id=excluded.next_entity_id,next_object_id=excluded.next_object_id,sectors=excluded.sectors",
            params![world.seed, world.generation_digest, i64::try_from(world.tick)?, world.random_state, world.next_entity_id, world.next_object_id, sectors],
        )?;
        if !batch.players.is_empty() {
            let mut upsert = tx.prepare_cached(
                "INSERT INTO players(id,display_name,role,banned,first_joined_at,last_seen_at,played_for,credits,unlocked_paints,visited,ship,sector,display_name_key)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,banned=excluded.banned,
                 last_seen_at=excluded.last_seen_at,played_for=excluded.played_for,credits=excluded.credits,unlocked_paints=excluded.unlocked_paints,
                 visited=excluded.visited,ship=excluded.ship,sector=excluded.sector",
            )?;
            let mut update_key = tx.prepare_cached(UPDATE_NAME_KEY)?;
            for (player, (visits, ship)) in batch.players.iter().zip(player_values) {
                let key = name_key(&player.display_name);
                upsert.execute(params![
                    player.id,
                    player.display_name,
                    player.role.as_str(),
                    player.banned,
                    player.first_joined_at,
                    player.last_seen_at,
                    player.played_for.round() as i64,
                    player.credits.round() as i64,
                    player.unlocked_paints,
                    visits,
                    ship,
                    player.sector_id,
                    key,
                ])?;
                update_key.execute(params![key, player.id])?;
            }
        }
        if !batch.entities.is_empty() {
            let mut upsert = tx.prepare_cached(
                "INSERT INTO entities(id,sector,generated,state) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                 sector=excluded.sector,generated=excluded.generated,state=excluded.state
                 WHERE entities.state IS NOT excluded.state OR entities.generated!=excluded.generated OR entities.sector!=excluded.sector",
            )?;
            let mut delete = tx.prepare_cached("DELETE FROM entities WHERE id=?")?;
            for (entity, value) in batch.entities.iter().zip(entity_values) {
                if entity.state.is_none() && !entity.generated {
                    delete.execute([entity.id])?;
                } else {
                    upsert.execute(params![
                        entity.id,
                        entity.sector_id,
                        entity.generated,
                        value.map(|range| &bytes[range])
                    ])?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn start<Ship, Entity>(self, backup_directory: PathBuf) -> Result<SaveWriter<Ship, Entity>>
    where
        Ship: Serialize + Send + 'static,
        Entity: Serialize + EntityState + Send + 'static,
    {
        let (sender, receiver) = inbox::channel(QUEUE_CAPACITY);
        let (finish, finished) = mpsc::channel();
        let state = Arc::new(WriterState::default());
        let writer_state = Arc::clone(&state);
        let backup_state = Arc::clone(&state);
        let backup_source = self.path.clone();
        let writer = thread::Builder::new()
            .name("world-save".to_owned())
            .spawn(move || {
                run_writer(self, receiver, &writer_state);
                let _ = finish.send(());
            })?;
        let backups = thread::Builder::new()
            .name("world-backup".to_owned())
            .spawn(move || {
                while !backup_state.stop_backups.load(Ordering::Acquire) {
                    thread::park_timeout(BACKUP_INTERVAL);
                    if backup_state.stop_backups.load(Ordering::Acquire) {
                        return;
                    }
                    if backup_state.committed.load(Ordering::Acquire) > 0
                        && let Err(error) = backups::backup(
                            &backup_source,
                            &backup_directory,
                            &backup_state.stop_backups,
                        )
                        && !backup_state.stop_backups.load(Ordering::Acquire)
                    {
                        eprintln!("SQLite backup failed: {error}");
                    }
                }
            })?;
        Ok(SaveWriter {
            sender: Some(sender),
            state,
            writer: Some(writer),
            backups: Some(backups),
            finished,
        })
    }
}

#[derive(Default)]
struct WriterState {
    committed: AtomicU64,
    stop: AtomicBool,
    stop_backups: AtomicBool,
    failure: Mutex<Option<String>>,
}

pub struct SaveWriter<Ship, Entity> {
    sender: Option<inbox::Sender<SaveBatch<Ship, Entity>>>,
    state: Arc<WriterState>,
    writer: Option<JoinHandle<()>>,
    backups: Option<JoinHandle<()>>,
    finished: mpsc::Receiver<()>,
}

impl<Ship, Entity> SaveWriter<Ship, Entity> {
    pub fn has_capacity(&self) -> bool {
        self.sender
            .as_ref()
            .is_some_and(|sender| !sender.is_closed() && sender.capacity() > 0)
    }

    pub fn try_submit(&self, batch: SaveBatch<Ship, Entity>) -> bool {
        self.sender
            .as_ref()
            .is_some_and(|sender| sender.try_send(batch).is_ok())
    }

    pub fn committed(&self) -> u64 {
        self.state.committed.load(Ordering::Acquire)
    }

    pub fn failure(&self) -> Option<String> {
        self.state
            .failure
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub fn close(mut self, deadline: Instant) -> Result<()> {
        self.sender.take();
        let timed_out = matches!(
            self.finished
                .recv_timeout(deadline.saturating_duration_since(Instant::now())),
            Err(mpsc::RecvTimeoutError::Timeout)
        );
        self.cancel();
        if let Some(writer) = self.writer.take() {
            writer.join().map_err(|_| "world save worker panicked")?;
        }
        if let Some(backups) = self.backups.take() {
            backups.join().map_err(|_| "world backup worker panicked")?;
        }
        if timed_out {
            return Err("world save shutdown timed out".into());
        }
        if let Some(error) = self.failure() {
            return Err(error.into());
        }
        Ok(())
    }

    fn cancel(&self) {
        self.state.stop.store(true, Ordering::Release);
        self.state.stop_backups.store(true, Ordering::Release);
        if let Some(writer) = &self.writer {
            writer.thread().unpark();
        }
        if let Some(backups) = &self.backups {
            backups.thread().unpark();
        }
    }
}

impl<Ship, Entity> Drop for SaveWriter<Ship, Entity> {
    fn drop(&mut self) {
        self.cancel();
    }
}

fn run_writer<Ship: Serialize, Entity: Serialize + EntityState>(
    mut store: Store,
    mut receiver: inbox::Receiver<SaveBatch<Ship, Entity>>,
    state: &WriterState,
) {
    while let Some(batch) = receiver.blocking_recv() {
        let batch = coalesce(batch, &mut receiver);
        while !state.stop.load(Ordering::Acquire) {
            let result = store.save(&batch);
            let mut failure = state
                .failure
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            match result {
                Ok(()) => {
                    *failure = None;
                    state.committed.store(batch.sequence, Ordering::Release);
                    break;
                }
                Err(error) => {
                    if failure.is_none() {
                        eprintln!("SQLite writes failed; durable gameplay paused: {error}");
                    }
                    *failure = Some(error.to_string());
                }
            }
            drop(failure);
            thread::park_timeout(RETRY_INTERVAL);
        }
        if state.stop.load(Ordering::Acquire) {
            return;
        }
    }
}

fn coalesce<Ship, Entity>(
    first: SaveBatch<Ship, Entity>,
    receiver: &mut inbox::Receiver<SaveBatch<Ship, Entity>>,
) -> SaveBatch<Ship, Entity> {
    let Ok(second) = receiver.try_recv() else {
        return first;
    };
    let mut players: HashMap<_, _> = first
        .players
        .into_iter()
        .map(|player| (player.id.clone(), player))
        .collect();
    let mut entities: HashMap<_, _> = first
        .entities
        .into_iter()
        .map(|entity| (entity.id, entity))
        .collect();
    let mut sequence = first.sequence;
    let mut world = first.world;
    for batch in
        std::iter::once(second).chain((1..QUEUE_CAPACITY).map_while(|_| receiver.try_recv().ok()))
    {
        sequence = batch.sequence;
        world = batch.world;
        players.extend(
            batch
                .players
                .into_iter()
                .map(|player| (player.id.clone(), player)),
        );
        entities.extend(batch.entities.into_iter().map(|entity| (entity.id, entity)));
    }
    SaveBatch {
        sequence,
        world,
        players: players.into_values().collect(),
        entities: entities.into_values().collect(),
    }
}
