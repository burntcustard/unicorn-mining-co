//! Authoritative multiplayer session over the Rust simulation and wire protocol.

use std::collections::HashMap;
use std::io;
use std::sync::Arc;
use std::time::{Duration, Instant};

use smallvec::SmallVec;

use crate::game_server::{Client, ClientId, Session};
use crate::game_session::sector_transit::{SectorArrival, relocate_local_player};
use crate::npc::world_host::NpcPlayer;
use crate::objects::craft::CargoObject;
use crate::objects::ship::Ship;
use crate::persistence::{DEFAULT_PAINTS, PlayerRole};
use crate::protocol::{
    Control, DockAction, Input, InputFrame, MapMarker, ServerControl, SimulationEvent, WorldSound,
    encode_server_control,
};
use crate::replication::snapshot_writer::{SnapshotMetadata, SnapshotWriter};
use crate::replication::{ObserverSelection, SelectOptions};
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::streaming::StreamingWorld;
use crate::simulation::update_world::WorldStepOptions;
use crate::simulation::world::{Entity, EntityKind, Player};
use crate::specs::Catalog;
use crate::utilities::seeded_random::SeededRandom;
use crate::utilities::vector::Vector;
use crate::utilities::{OrderedMap, round_ties_up};
use crate::websocket::{MAX_SOCKET_BUFFER, WebSocket};

#[cfg(feature = "benchmark-fixtures")]
mod benchmark_fixtures;
mod connection;
mod snapshot;
use snapshot::send_snapshot;
mod accounts;
mod player_lifecycle;
mod sector_tick;
mod sectors;
use sectors::{NpcPhase, SectorRuntime, Sectors, reset_location};
mod hangar;
#[cfg(feature = "test-fixtures")]
pub mod session_fixture;
#[cfg(feature = "test-fixtures")]
pub mod trade_fixture;
use accounts::{AccountStorage, unix_seconds};
use hangar::Hangar;

use super::{
    BANNED_CODE, BANNED_MESSAGE, ChatDispatch, ChatThrottle, ConnectionStats, FinishedConnection,
    GateAccess, InputPacket, InputQueue, OnlinePlayer, ProfileChange, ProfileFields, ProfileMatch,
    ProfileRoster, ProfileView, ServerLoadStats, SessionTotals, SnapshotDelivery, SnapshotRequest,
    SnapshotSample, SnapshotStall, SoundRecipient, SoundShip, WorldSoundLookup, build_world_sounds,
    list_players, nearby_world_sounds, player_chat, set_profile_name, system_chat, teleport_reply,
};

const REPLACED_CODE: u16 = 4001;
const IDLE_TIMEOUT: Duration = Duration::from_secs(300);
const REGION_INTERVAL: u64 = 8;

struct Account {
    player_number: i64,
    sector: usize,
    travelled_tick: Option<u64>,
    encounter_after: u64,
    arrival_message: Option<(String, String)>,
    player_id: String,
    name: String,
    role: PlayerRole,
    banned: bool,
    first_joined_at: i64,
    last_seen_at: i64,
    played_for: f64,
    played_at: Option<Instant>,
    ship_id: i64,
    definition: String,
    position: Vector,
    hidden: Option<Entity>,
    socket: Option<Client>,
    playing: bool,
    credits: f64,
    unlocked_paints: u16,
    visited: Vec<i64>,
    save_sequence: u64,
    welcome_pending: bool,
    profile_pending: bool,
    respawn_pending: bool,
    progress_pending: bool,
    hangar: Hangar,
    last_input_at: Instant,
    disconnected_at: Option<Instant>,
    inputs: InputQueue,
    selection: ObserverSelection,
    writer: SnapshotWriter,
    delivery: SnapshotDelivery,
    dock_sequence: u64,
    dock_aliases: OrderedMap<i64, (i64, u64)>,
    chat: ChatThrottle,
    map_at: Option<Instant>,
    gate_access: GateAccess,
    stats: Option<ConnectionStats>,
}

impl Account {
    fn new(
        player_number: i64,
        sector: usize,
        player_id: String,
        entity: Entity,
        now: Instant,
        catalog: &Catalog,
    ) -> Self {
        let ship = entity.model.object();
        let timestamp = unix_seconds();
        Self {
            player_number,
            sector,
            travelled_tick: None,
            encounter_after: 0,
            arrival_message: None,
            player_id,
            name: String::new(),
            role: PlayerRole::User,
            banned: false,
            first_joined_at: timestamp,
            last_seen_at: timestamp,
            played_for: 0.0,
            played_at: None,
            ship_id: ship.id,
            definition: ship.definition_id.clone(),
            position: ship.position,
            hidden: Some(entity),
            socket: None,
            playing: false,
            credits: catalog.starting_credits,
            unlocked_paints: DEFAULT_PAINTS,
            visited: Vec::new(),
            save_sequence: 0,
            welcome_pending: false,
            profile_pending: false,
            respawn_pending: false,
            progress_pending: false,
            hangar: Hangar::default(),
            last_input_at: now,
            disconnected_at: None,
            inputs: InputQueue::new(catalog.simulation.max_prediction_ticks as u32),
            selection: ObserverSelection::new(true),
            writer: SnapshotWriter::default(),
            delivery: SnapshotDelivery::default(),
            dock_sequence: 0,
            dock_aliases: OrderedMap::default(),
            chat: ChatThrottle::default(),
            map_at: None,
            gate_access: GateAccess::default(),
            stats: None,
        }
    }

    fn as_profile(&self) -> ProfileView<'_> {
        ProfileView {
            player_number: self.player_number,
            display_name: &self.name,
            role: self.role,
            banned: self.banned,
        }
    }

    fn update_session_time(&mut self, now: Instant) {
        if self.socket.is_some() {
            self.last_seen_at = unix_seconds();
        }
        if let Some(started) = &mut self.played_at {
            self.played_for += now.saturating_duration_since(*started).as_secs_f64();
            *started = now;
        }
    }
}

pub struct AuthoritativeSession {
    #[cfg(feature = "benchmark-fixtures")]
    fixtures: benchmark_fixtures::Fixtures,
    catalog: Arc<Catalog>,
    world_seed: f64,
    sectors: Sectors,
    dialog_random: SeededRandom,
    npc_players: Vec<NpcPlayer>,
    accounts: OrderedMap<i64, Account>,
    player_numbers_by_id: HashMap<String, i64>,
    sockets: HashMap<ClientId, i64>,
    pending_ship_hiding: bool,
    next_player_number: i64,
    inputs: HashMap<i64, InputFrame>,
    events: Vec<SimulationEvent>,
    sounds: Vec<WorldSound>,
    nearby_sounds: Vec<WorldSound>,
    stats: SessionTotals,
    load: Option<ServerLoadStats>,
    storage: Option<AccountStorage>,
}

impl AuthoritativeSession {
    /// Create the session in the catalog's starting sector.
    pub fn new(world_seed: f64, catalog: Arc<Catalog>) -> io::Result<Self> {
        let sectors = Sectors::new(world_seed, Arc::clone(&catalog))?;
        Ok(Self {
            #[cfg(feature = "benchmark-fixtures")]
            fixtures: benchmark_fixtures::Fixtures::default(),
            catalog,
            world_seed,
            sectors,
            dialog_random: SeededRandom::new(unix_seconds() as f64),
            npc_players: Vec::new(),
            accounts: OrderedMap::default(),
            player_numbers_by_id: HashMap::new(),
            sockets: HashMap::new(),
            pending_ship_hiding: false,
            next_player_number: 1,
            inputs: HashMap::new(),
            events: Vec::new(),
            sounds: Vec::new(),
            nearby_sounds: Vec::new(),
            stats: SessionTotals::default(),
            load: None,
            storage: None,
        })
    }

    pub fn enable_stats(&mut self) -> io::Result<()> {
        self.load = Some(ServerLoadStats::start()?);
        Ok(())
    }

    fn send_snapshot(&mut self, id: i64) {
        let committed = self.committed_sequence();
        if let Some(account) = self.accounts.get_mut(&id) {
            let sector = &mut self.sectors[account.sector];
            sector.begin_replication();
            send_snapshot(
                account,
                sector,
                &self.catalog,
                self.world_seed,
                committed,
                false,
            );
        }
    }

    fn dock(&mut self, id: i64, mut action: DockAction, sequence: u64) {
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        if account.hangar.no_ship {
            account.hangar.response = Some("Buy or pilot a ship first.");
            self.send_snapshot(id);
            return;
        }
        let sector = account.sector;
        self.sectors.update_ids(sector);
        let accepted = if sequence == 0 || sequence > account.dock_sequence {
            if sequence != 0 {
                account.dock_sequence = sequence;
            }
            let originals = match &action {
                DockAction::Sell { object_ids } => object_ids.clone(),
                DockAction::Buy { module_id, .. } => {
                    account.dock_aliases.remove(module_id);
                    Vec::new()
                }
                _ => Vec::new(),
            };
            resolve_dock_aliases(&mut action, &account.dock_aliases);
            apply_dock(
                account,
                &mut self.sectors[sector],
                &self.catalog,
                &action,
                &originals,
                sequence,
            )
        } else {
            false
        };
        self.sectors.commit_ids(sector);
        if !accepted {
            account.delivery.require_load();
        }
        account.progress_pending = true;
        if accepted {
            self.mark_dirty(id, false);
        }
        self.send_snapshot(id);
    }

    fn route_chat(&mut self, id: i64, channel: u8, text: String, now: Instant) {
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        let mut throttle = std::mem::take(&mut account.chat);
        let command = throttle.dispatch(self, id, channel, &text, now);
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        account.chat = throttle;
        let account = self.accounts.get(&id).expect("chat account exists");
        let Some(socket) = account.socket.as_ref().map(|client| client.socket.clone()) else {
            return;
        };
        match command {
            ChatDispatch::Ignore => {}
            ChatDispatch::Reply { channel, text } => {
                send_control(&socket, system_chat(channel, &text), &self.catalog)
            }
            ChatDispatch::Relay { channel, text } => {
                let message = player_chat(account.as_profile(), channel, text);
                for recipient in self.accounts.values().filter(|recipient| {
                    recipient.playing && (channel == 1 || recipient.sector == account.sector)
                }) {
                    if let Some(client) = &recipient.socket {
                        send_control(&client.socket, message, &self.catalog);
                    }
                }
            }
            ChatDispatch::Moderated {
                channel,
                text,
                target_id,
                disconnect_if_connected,
            } => {
                self.mark_dirty(target_id, true);
                send_control(&socket, system_chat(channel, &text), &self.catalog);
                if disconnect_if_connected
                    && let Some(client) = self
                        .accounts
                        .get(&target_id)
                        .and_then(|account| account.socket.clone())
                {
                    self.disconnect_with_reason(client.id, "banned");
                    client.socket.close_with(BANNED_CODE, BANNED_MESSAGE);
                }
            }
            ChatDispatch::List {
                channel,
                include_locations,
            } => {
                let players = self.accounts.values().map(|account| {
                    let sector = &self.sectors[account.sector];
                    OnlinePlayer {
                        display_name: &account.name,
                        sector_id: &sector.sector.id,
                        sector_name: Some(&sector.sector.name),
                        position: sector
                            .running
                            .world
                            .entity(account.ship_id)
                            .map_or(account.position, |entity| entity.model.object().position),
                        socket_open: account
                            .socket
                            .as_ref()
                            .is_some_and(|client| client.socket.is_open()),
                        playing: account.playing,
                    }
                });
                for reply in list_players(players, include_locations) {
                    send_control(&socket, system_chat(channel, &reply), &self.catalog);
                }
            }
            ChatDispatch::Teleport {
                channel,
                destination,
            } => {
                let sector = account.sector;
                let ship_id = account.ship_id;
                let world = &mut self.sectors[sector].running.world;
                let arrival = SectorArrival {
                    position: destination,
                    ..Default::default()
                };
                let eligible = world
                    .entity_mut(ship_id)
                    .and_then(|entity| match &mut entity.model {
                        EntityKind::Ship(ship) => Some(ship),
                        _ => None,
                    })
                    .is_some_and(|ship| {
                        if ship.craft.object.dead || ship.craft.docked_to.is_some() {
                            return false;
                        }
                        ship.fly(0.0, 0.0);
                        ship.firing = false;
                        ship.craft.launching = 0.0;
                        true
                    });
                let can_relocate = eligible && relocate_local_player(world, id, ship_id, arrival);
                if can_relocate {
                    let account = self.accounts.get_mut(&id).expect("teleporting account");
                    reset_location(account, arrival, world.tick);
                    self.inputs.remove(&id);
                    self.sync_regions(sector, None);
                    self.mark_dirty(id, false);
                    self.send_snapshot(id);
                }
                send_control(
                    &socket,
                    system_chat(channel, &teleport_reply(can_relocate, destination)),
                    &self.catalog,
                );
            }
        }
    }
}

impl ProfileRoster for AuthoritativeSession {
    fn profiles(&self) -> impl Iterator<Item = ProfileView<'_>> {
        self.accounts.values().map(Account::as_profile)
    }

    fn profile(&self, id: i64) -> Option<ProfileView<'_>> {
        self.accounts.get(&id).map(Account::as_profile)
    }

    fn profile_mut(&mut self, id: i64) -> Option<ProfileFields<'_>> {
        let account = self.accounts.get_mut(&id)?;
        Some(ProfileFields {
            display_name: &mut account.name,
            role: &mut account.role,
            banned: &mut account.banned,
        })
    }

    fn has_owner(&self) -> bool {
        self.profiles()
            .any(|profile| profile.role == PlayerRole::Owner)
            || self
                .storage
                .as_ref()
                .is_some_and(|storage| storage.reader.has_owner().unwrap_or(true))
    }

    fn name_taken(&self, name: &str) -> io::Result<bool> {
        use super::name_matching::equal_name;

        #[cfg(feature = "benchmark-fixtures")]
        if self.storage.is_none() && self.uses_benchmark_fixtures() {
            return Ok(false);
        }

        if self
            .profiles()
            .any(|profile| equal_name(profile.display_name, name))
        {
            return Ok(true);
        }
        self.storage.as_ref().map_or(Ok(false), |storage| {
            storage.reader.name_taken(name).map_err(io::Error::other)
        })
    }

    fn find_named_profile(&mut self, name: &str) -> ProfileMatch {
        use super::name_matching::equal_name;

        let resident = {
            let mut matches = self
                .profiles()
                .filter(|profile| equal_name(profile.display_name, name));
            let first = matches
                .next()
                .map(|profile| (profile.player_number, profile.role));
            if matches.next().is_some() {
                return ProfileMatch::Ambiguous;
            }
            first
        };
        let saved = self
            .storage
            .as_ref()
            .map(|storage| {
                storage.reader.matching_profile(name, |player_id| {
                    !self.player_numbers_by_id.contains_key(player_id)
                })
            })
            .transpose();
        let saved = match saved {
            Ok(saved) => saved.flatten(),
            Err(error) => {
                eprintln!("find saved player profile: {error}");
                return ProfileMatch::Unavailable;
            }
        };
        match (resident, saved) {
            (None, None) => ProfileMatch::Missing,
            (Some((id, role)), None) => ProfileMatch::Unique(id, role),
            (None, Some((player_id, role))) => {
                match self.load_account(&player_id, Instant::now()) {
                    Ok(Some(id)) => ProfileMatch::Unique(id, role),
                    Ok(None) => ProfileMatch::Missing,
                    Err(error) => {
                        eprintln!("load saved player profile: {error}");
                        ProfileMatch::Unavailable
                    }
                }
            }
            _ => ProfileMatch::Ambiguous,
        }
    }
}

impl Session for AuthoritativeSession {
    fn receive(&mut self, client: &Client, control: Control) {
        if !matches!(control, Control::SnapshotAck { .. })
            && !self.persistence_ready(Instant::now())
        {
            client
                .socket
                .close_with(1013, "Storage temporarily unavailable");
            return;
        }
        match control {
            Control::Hello { player_id } => return self.greet(client, player_id, true),
            Control::Prepare { player_id } => return self.greet(client, player_id, false),
            _ => {}
        }
        let Some(id) = self.sockets.get(&client.id).copied() else {
            return;
        };
        if let Control::SnapshotAck { sequence } = control {
            return self.receive_ack(id, sequence);
        }

        #[cfg(feature = "benchmark-fixtures")]
        if let Control::Chat { text, .. } = &control
            && self.benchmark_chat(id, text)
        {
            return;
        }
        let now = Instant::now();
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        account.last_input_at = now;
        let playing = account.playing;
        match control {
            Control::Profile { display_name } => self.set_name(id, display_name),
            Control::Play => self.play(id),
            Control::Leave => {
                self.leave_world(id, now);
                send_control(&client.socket, ServerControl::Leave, &self.catalog);
            }
            _ if !playing => {}
            Control::Input {
                tick,
                sequence,
                input,
                offset,
            } => self.receive_input(
                id,
                InputPacket {
                    tick,
                    sequence,
                    input,
                    offset,
                },
            ),
            Control::Dock { action, sequence } => self.dock(id, action, sequence),
            Control::Hangar {
                command,
                ship_id,
                value,
            } => self.hangar_action(id, &command, ship_id, &value),
            Control::Respawn => self.respawn(id),
            Control::GateAccess { gate_id } => self.request_gate_access(id, gate_id),
            Control::Chat { channel, text } => self.route_chat(id, channel, text, now),
            Control::SectorMap { position } => self.sector_map(id, position, now),
            _ => {}
        }
    }

    fn disconnect(&mut self, client: &Client) {
        self.disconnect_with_reason(client.id, "closed");
    }

    fn tick(&mut self, ticks: u64) {
        let start = self.load.as_ref().map(|_| Instant::now());
        let ticks = ticks.max(1);
        let tick = self.sectors.tick;
        let step = self.catalog.simulation.simulation_step;
        let now = Instant::now();
        if !self.persistence_ready(now) {
            return;
        }
        #[cfg(feature = "benchmark-fixtures")]
        self.prune_benchmark_sectors();
        let sectors = self.sectors.indices().collect::<SmallVec<[usize; 16]>>();
        for &index in &sectors {
            self.update_gates(index, ticks as f64 * step);
        }
        self.update_stored_ships(tick, ticks as f64 * step);
        self.hide_disconnected(now);
        if tick.is_multiple_of(30) || tick % 30 + ticks > 30 {
            self.disconnect_idle(now);
        }
        for index in sectors {
            self.sectors[index].running.world.tick = tick;
            self.sectors.update_ids(index);
            self.tick_sector(index, tick, ticks, step);
        }
        let end_tick = tick + ticks;
        self.sectors.tick = end_tick;
        for sector in self.sectors.active_mut() {
            sector.running.world.tick = end_tick;
        }
        self.background_save(now);
        self.release_saved_accounts();

        if let Some(load) = &mut self.load {
            if super::stats_due(tick, ticks, step) {
                let open = self.accounts.values().filter_map(|account| {
                    let stats = account.stats.as_ref()?;
                    account.socket.as_ref()?;
                    Some(super::OpenConnection {
                        stats,
                        held_lag: account.delivery.receipt_lag(),
                    })
                });
                eprintln!("{}", self.stats.report(now, open));
                if let Ok(report) = load.capture_interval(self.sockets.len()) {
                    eprintln!("{report}");
                }
            }
            if let Some(start) = start {
                load.record_tick(start.elapsed(), ticks, step);
            }
        }
    }

    fn identity_preview(&mut self, player_id: &str) -> io::Result<Option<serde_json::Value>> {
        use crate::objects::saved_ship::SavedShip;

        let (name, credits, ship) = if let Some(account) = self
            .player_numbers_by_id
            .get(player_id)
            .and_then(|id| self.accounts.get(id))
        {
            let entity = account
                .hidden
                .as_ref()
                .or_else(|| {
                    self.sectors[account.sector]
                        .running
                        .world
                        .entity(account.ship_id)
                })
                .ok_or_else(|| io::Error::other("player ship missing"))?;
            let EntityKind::Ship(ship) = &entity.model else {
                return Err(io::Error::other("invalid player ship"));
            };
            (
                account.name.clone(),
                account.credits,
                SavedShip::capture(ship, &self.catalog),
            )
        } else {
            let Some(storage) = &self.storage else {
                return Ok(None);
            };
            let Some(saved) = storage
                .reader
                .player::<SavedShip>(player_id)
                .map_err(io::Error::other)?
            else {
                return Ok(None);
            };
            (saved.display_name, saved.credits, saved.ship)
        };
        let modules = ship
            .modules
            .iter()
            .map(|module| {
                let definition = self
                    .catalog
                    .module_ids
                    .iter()
                    .position(|id| id == &module.definition)
                    .map_or(-1, |id| id as i64);
                let paint = module.paint.map_or(-1, |paint| paint as i64);
                serde_json::json!([definition, module.mount, paint, module.health])
            })
            .collect::<Vec<_>>();
        let paint = ship.paint.map_or(-1, |paint| paint as i64);
        Ok(Some(serde_json::json!([
            name,
            credits,
            [ship.definition, paint, ship.hull, modules]
        ])))
    }

    fn shutdown(
        &mut self,
        deadline: tokio::time::Instant,
    ) -> impl Future<Output = io::Result<()>> + Send {
        let writer = self.finish_storage(deadline.into_std());
        async move {
            if let Some(writer) = writer? {
                tokio::task::spawn_blocking(move || writer.close(deadline.into_std()))
                    .await
                    .map_err(io::Error::other)?
                    .map_err(io::Error::other)?;
            }
            Ok(())
        }
    }
}

impl AuthoritativeSession {
    fn sector_map(&mut self, id: i64, position: Vector, now: Instant) {
        if position.x.abs() > 1e9 || position.y.abs() > 1e9 {
            return;
        }
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        if account
            .map_at
            .is_some_and(|last| now.saturating_duration_since(last) < Duration::from_millis(60))
        {
            return;
        }
        let Some(socket) = account.socket.as_ref().map(|client| client.socket.clone()) else {
            return;
        };
        account.map_at = Some(now);
        let index = account.sector;
        let sector = &mut self.sectors[index];
        let mut markers = sector.regions.procedural.map_stations().to_vec();
        let world = &sector.running.world;
        markers.extend(world.entities().filter_map(|entity| {
            let EntityKind::Portal(portal) = &entity.model else {
                return None;
            };
            Some(MapMarker {
                kind: portal.object.kind.clone(),
                id: portal.object.id,
                position: portal.object.position,
                name: portal.object.name.clone(),
                ..MapMarker::default()
            })
        }));
        for account in self
            .accounts
            .values()
            .filter(|account| account.sector == index && account.playing)
        {
            let Some(entity) = world.entity(account.ship_id) else {
                continue;
            };
            let EntityKind::Ship(ship) = &entity.model else {
                continue;
            };
            let object = &ship.craft.object;
            if object.dead {
                continue;
            }
            let color = object
                .shades
                .as_ref()
                .and_then(|shades| shades.get(2))
                .cloned()
                .unwrap_or_default();
            let role = match account.role {
                PlayerRole::User => "user",
                PlayerRole::Admin => "admin",
                PlayerRole::Owner => "owner",
            };
            markers.push(MapMarker {
                kind: "ship".into(),
                id: account.ship_id,
                position: object.position,
                color,
                name: account.name.clone(),
                sender_role: role.to_owned(),
                definition_id: ship
                    .craft
                    .docked_to
                    .filter(|&dock| dock != 0)
                    .map_or_else(String::new, |dock| dock.to_string()),
                ..MapMarker::default()
            });
        }
        send_control(
            &socket,
            ServerControl::SectorMap {
                map_markers: &markers,
            },
            &self.catalog,
        );
    }
}

struct SoundLookup<'a> {
    accounts: &'a OrderedMap<i64, Account>,
    sector: usize,
    world: &'a crate::simulation::world::World,
}

impl WorldSoundLookup for SoundLookup<'_> {
    fn player_ship(&self, player_number: i64) -> Option<SoundShip> {
        // A portal transfer can move the player before the source sector sends its sounds.
        let account = self
            .accounts
            .get(&player_number)
            .filter(|account| account.sector == self.sector)?;
        Some(SoundShip {
            id: account.ship_id,
            position: self
                .entity_position(account.ship_id)
                .unwrap_or(account.position),
        })
    }
    fn ship_player(&self, entity_id: i64) -> Option<i64> {
        self.accounts
            .values()
            .find(|account| account.ship_id == entity_id && account.sector == self.sector)
            .map(|account| account.player_number)
    }
    fn entity_player(&self, entity_id: i64) -> Option<i64> {
        self.world.entity(entity_id)?.model.object().player_number
    }
    fn entity_position(&self, entity_id: i64) -> Option<Vector> {
        Some(self.world.entity(entity_id)?.model.object().position)
    }
}

fn round_spawn(position: Vector) -> Vector {
    Vector::new(round_ties_up(position.x), round_ties_up(position.y))
}

fn held_input(ship: &Ship) -> Input {
    let active = |name| ship.craft.module_active(name);
    Input {
        target_id: ship.target_id,
        horn_drill: active("hornDrill"),
        cargo_hatch: active("cargoHatch"),
        search_light: active("searchLight"),
        shield_generator: active("shieldGenerator"),
        plasma_active: active("plasmaAccelerator") || active("plasmaAcceleratorTurret"),
        autogun_active: active("autogun") || active("autogunTurret") || active("cannonSm"),
        laser_active: active("laser") || active("laserTurret"),
        flight_mode: active("flightMode"),
        ..Input::default()
    }
}

fn send(socket: &WebSocket, bytes: &[u8]) {
    if socket.is_open()
        && (socket.buffered_bytes() > MAX_SOCKET_BUFFER || socket.send_binary(bytes).is_err())
    {
        socket.terminate();
    }
}

fn send_control(socket: &WebSocket, message: ServerControl<'_>, catalog: &Catalog) {
    match encode_server_control(&message, &catalog.protocol) {
        Ok(bytes) => send(socket, &bytes),
        Err(error) => {
            eprintln!("control encoding failed: {error}");
            socket.close_with(1011, "Invalid server control");
        }
    }
}

fn reset_disconnected_movement(ship: &mut Ship) {
    ship.craft.object.local_movement = Default::default();
    ship.craft.object.velocity = Vector::ZERO;
    ship.craft.object.spin = 0.0;
    ship.fly(0.0, 0.0);
    ship.cancel_cargo_release();
    ship.craft.object.position = round_spawn(ship.craft.object.position);
}

fn unlock_paint(account: &mut Account, index: usize) -> bool {
    let mask = 1 << index;
    if account.unlocked_paints & mask != 0 {
        return false;
    }
    account.unlocked_paints |= mask;
    account.progress_pending = true;
    true
}

fn resolve_dock_aliases(action: &mut DockAction, aliases: &OrderedMap<i64, (i64, u64)>) {
    let resolve = |mut id: i64| {
        for _ in 0..aliases.len() {
            let Some(&(alias, _)) = aliases.get(&id) else {
                break;
            };
            id = alias;
        }
        id
    };
    match action {
        DockAction::Sell { object_ids } | DockAction::BuyStock { object_ids } => {
            for id in object_ids {
                *id = resolve(*id);
            }
        }
        DockAction::Equip { module_id, .. } => *module_id = resolve(*module_id),
        DockAction::Paint { module_id, .. } | DockAction::Repair { module_id, .. } => {
            if let Some(id) = module_id {
                *id = resolve(*id);
            }
        }
        _ => {}
    }
}

fn apply_dock(
    account: &mut Account,
    sector: &mut SectorRuntime,
    catalog: &Catalog,
    action: &DockAction,
    original_ids: &[i64],
    sequence: u64,
) -> bool {
    if let DockAction::Paint { paint, .. } = action {
        let paint = *paint;
        if paint < 0
            || paint >= catalog.paint_colors.len() as i64
            || 1_u16
                .checked_shl(paint as u32)
                .is_none_or(|mask| account.unlocked_paints & mask == 0)
        {
            return false;
        }
    }

    let world = &mut sector.running.world;
    let Some(mut entity) = world.entities.take_for_update(&account.ship_id) else {
        return false;
    };
    let mut ids = world.ids;
    let mut changed_station = None;
    let accepted = if let EntityKind::Ship(ship) = &mut entity.model
        && let Some(station_id) = ship.craft.docked_to
    {
        account.hangar.response = Some("");
        let station = world
            .entity_mut(station_id)
            .and_then(|entity| match &mut entity.model {
                EntityKind::Station(station) => Some(station.as_mut()),
                _ => None,
            });
        let mut sold_modules = SmallVec::<[(i64, i64); 16]>::new();
        let mut sold_diamond = false;
        if let DockAction::Sell { object_ids } = action {
            for (&original, &id) in original_ids.iter().zip(object_ids) {
                let mounted = ship
                    .craft
                    .mounts
                    .iter()
                    .find_map(|mount| mount.module.as_ref().filter(|module| module.id == id));
                let cargo = ship
                    .craft
                    .cargo_contents
                    .iter()
                    .find(|item| item.id() == id);
                let module = mounted.or(match cargo {
                    Some(CargoObject::Module(module)) => Some(module),
                    _ => None,
                });
                if module.is_some_and(|module| {
                    catalog.station_module_ids.contains(&module.definition_id)
                }) {
                    sold_modules.push((original, id));
                }
                sold_diamond |= matches!(cargo, Some(CargoObject::Item(item)) if item.object.resource == Some(0));
            }
        }
        let first_id = ids.next_entity;
        let accepted =
            ship.apply_dock_action(action, &mut account.credits, station, catalog, || {
                ids.entity()
            });
        if accepted {
            changed_station = Some(station_id);
            for ((original, id), replacement) in
                sold_modules.into_iter().zip(first_id..ids.next_entity)
            {
                account.dock_aliases.set(original, (replacement, sequence));
                account.dock_aliases.set(id, (replacement, sequence));
            }
            if sold_diamond {
                unlock_paint(account, 4);
            }
        }
        accepted
    } else {
        false
    };
    world.ids = ids;
    world.finish_entity_update(account.ship_id, Some(entity));
    if let Some(station_id) = changed_station {
        world.mark_entity_changed(station_id);
    }
    accepted
}
