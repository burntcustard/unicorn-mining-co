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
use crate::random::SeededRandom;
use crate::replication::records::{SnapshotMetadata, SnapshotWriter};
use crate::replication::{ObserverSelection, SelectOptions};
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::streaming::StreamingWorld;
use crate::simulation::world::{Entity, EntityKind, Player};
use crate::simulation::world_step::WorldStepOptions;
use crate::specs::Catalog;
use crate::utilities::{OrderedMap, round_ties_up};
use crate::vector::Vector;
use crate::websocket::{MAX_SOCKET_BUFFER, WebSocket};

mod accounts;
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
    GateAccess, InputPacket, InputQueue, OnlinePlayer, ProfileChange, ProfileFields, ProfileRoster,
    ProfileView, ServerLoadStats, SessionTotals, SnapshotDelivery, SnapshotRequest, SnapshotSample,
    SnapshotStall, SoundRecipient, SoundShip, WorldSoundLookup, build_world_sounds, list_players,
    nearby_world_sounds, player_chat, set_profile_name, system_chat, teleport_reply,
};

const REPLACED_CODE: u16 = 4001;
const IDLE_TIMEOUT: Duration = Duration::from_secs(300);
const REGION_INTERVAL: u64 = 8;

struct Account {
    id: i64,
    sector: usize,
    travelled_tick: Option<u64>,
    encounter_after: u64,
    arrival_message: Option<(String, String)>,
    token: String,
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
        id: i64,
        sector: usize,
        token: String,
        entity: Entity,
        now: Instant,
        catalog: &Catalog,
    ) -> Self {
        let ship = entity.model.object();
        let timestamp = unix_seconds();
        Self {
            id,
            sector,
            travelled_tick: None,
            encounter_after: 0,
            arrival_message: None,
            token,
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
            player_id: self.id,
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
    catalog: Arc<Catalog>,
    world_seed: f64,
    sectors: Sectors,
    dialog_random: SeededRandom,
    npc_players: Vec<NpcPlayer>,
    accounts: OrderedMap<i64, Account>,
    tokens: HashMap<String, i64>,
    sockets: HashMap<ClientId, i64>,
    pending_ship_hiding: bool,
    next_player_id: i64,
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
            catalog,
            world_seed,
            sectors,
            dialog_random: SeededRandom::new(unix_seconds() as f64),
            npc_players: Vec::new(),
            accounts: OrderedMap::default(),
            tokens: HashMap::new(),
            sockets: HashMap::new(),
            pending_ship_hiding: false,
            next_player_id: 1,
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

    fn create_account(&mut self, now: Instant) -> Option<i64> {
        let id = self.next_player_id;
        let sector = self.sectors.start;
        let nearest = self.sectors[sector].regions.nearest_station(Vector::ZERO);
        let (position, radius) = nearest.map_or((Vector::ZERO, 0.0), |station| {
            (station.position, station.radius)
        });
        let (sin, cos) = (id as f64 * 2.4).sin_cos();
        let position = round_spawn(position.add_scaled(Vector::new(cos, sin), radius + 250.0));
        let definition = "mustang".to_owned();
        let ship_id = self.spawn_ship(sector, id, &definition, position, 0.0, None)?;
        let hidden = self.sectors[sector].running.world.remove_entity(ship_id)?;
        let token = uuid::Uuid::new_v4().to_string();
        self.next_player_id += 1;
        self.tokens.insert(token.clone(), id);
        self.accounts.set(
            id,
            Account::new(id, sector, token, hidden, now, &self.catalog),
        );
        self.mark_dirty(id, true);
        Some(id)
    }

    fn spawn_ship(
        &mut self,
        sector: usize,
        player_id: i64,
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
            player_id: Some(player_id),
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

    fn greet(&mut self, client: &Client, player_token: Option<String>, play: bool) {
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

    fn play(&mut self, id: i64) {
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
            id,
            ship_id: account.ship_id,
            observer_range: 0.0,
        });
        self.sync_regions(sector, None);
        self.send_snapshot(id);
    }

    fn sync_regions(&mut self, index: usize, include: Option<Vector>) {
        self.refresh_sector_positions(index);
        let sector = &mut self.sectors[index];
        sector.positions.extend(include);
        sector
            .regions
            .sync(&mut sector.running.world, &sector.positions);
    }

    fn refresh_sector_positions(&mut self, index: usize) {
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

    fn set_name(&mut self, id: i64, name: String) {
        let change = set_profile_name(self, id, name);
        if change == ProfileChange::Ignored {
            return;
        }
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
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

    fn disconnect_with_reason(&mut self, client: ClientId, reason: &'static str) {
        let Some(id) = self.sockets.get(&client).copied() else {
            return;
        };
        let now = Instant::now();
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
        account.update_session_time(now);
        account.played_at = None;
        account.socket = None;
        account.inputs = InputQueue::new(self.catalog.simulation.max_prediction_ticks as u32);
        account.selection = ObserverSelection::new(true);
        account.writer = SnapshotWriter::default();
        account.delivery = SnapshotDelivery::default();
        account.dock_aliases = OrderedMap::default();
        account.gate_access.cancel();
        account.disconnected_at = Some(now);
        self.pending_ship_hiding = true;
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
        self.mark_dirty(id, false);
    }

    fn receive_input(&mut self, id: i64, packet: InputPacket) {
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

    fn receive_ack(&mut self, id: i64, sequence: u64) {
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

    fn respawn(&mut self, id: i64) {
        let Some(account) = self.accounts.get(&id) else {
            return;
        };
        if account.hangar.no_ship {
            return;
        }
        let ship_id = account.ship_id;
        let index = account.sector;
        let sector = &mut self.sectors[index];
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
        let nearest = sector
            .regions
            .nearest_station(position)
            .or_else(|| sector.regions.nearest_station(Vector::ZERO));
        let Some(nearest) = nearest else {
            return;
        };
        let station_id = sector.regions.id_offset + i64::from(nearest.id);
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
        self.sectors[index].running.world.remove_entity(ship_id);
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
        account.position = position;
        account.inputs.discard_pending(Input::default());
        account.inputs.clear_input_lead();
        account.delivery.require_load();
        self.sectors[index].running.world.set_player(Player {
            id,
            ship_id: replacement,
            observer_range: 0.0,
        });
        account.respawn_pending = true;
        account.hangar.response = Some("");
        self.mark_dirty(id, false);
        self.send_snapshot(id);
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
            Control::Hello { player_token } => return self.greet(client, player_token, true),
            Control::Prepare { player_token } => return self.greet(client, player_token, false),
            _ => {}
        }
        let Some(id) = self.sockets.get(&client.id).copied() else {
            return;
        };
        if let Control::SnapshotAck { sequence } = control {
            return self.receive_ack(id, sequence);
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
        self.hide_disconnected(now);
        if tick.is_multiple_of(30) || tick % 30 + ticks > 30 {
            self.disconnect_idle(now);
        }

        let sectors = self.sectors.indices().collect::<SmallVec<[usize; 16]>>();
        for &index in &sectors {
            self.update_gates(index, ticks as f64 * step);
        }
        self.update_stored_ships(tick, ticks as f64 * step);
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

    fn identity_preview(&mut self, private_id: &str) -> Option<serde_json::Value> {
        let account = self.accounts.get(self.tokens.get(private_id)?)?;
        let entity = account.hidden.as_ref().or_else(|| {
            self.sectors[account.sector]
                .running
                .world
                .entity(account.ship_id)
        })?;
        let EntityKind::Ship(ship) = &entity.model else {
            return None;
        };
        let ship = crate::objects::saved_ship::SavedShip::capture(ship, &self.catalog);
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
        Some(serde_json::json!([
            account.name,
            account.credits,
            [ship.definition, paint, ship.hull, modules]
        ]))
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
    fn tick_sector(&mut self, index: usize, tick: u64, ticks: u64, step: f64) {
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
            let frame = self.inputs.entry(account.id).or_default();
            frame.input = prepared.frame.input;
            frame.changes.clone_from(&prepared.frame.changes);
        }

        let duration = ticks as f64 * step;
        self.prepare_portals(index);
        self.run_npcs(index, NpcPhase::Update);
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

    fn keep_destroyed_ships(&mut self, index: usize) {
        let destroyed = self.sectors[index].running.world.take_destroyed_ships();
        for entity in destroyed {
            self.sectors[index].npcs.remember_destroyed_ship(&entity);
            let object = entity.model.object();
            let Some(id) = object.player_id else {
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

    fn hide_disconnected(&mut self, now: Instant) {
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
            hidden.push(account.id);
        }
        for id in hidden {
            self.mark_dirty(id, false);
        }
    }

    fn disconnect_idle(&mut self, now: Instant) {
        let mut idle = SmallVec::<[Client; 16]>::new();
        for account in self.accounts.values_mut().filter(|account| account.playing) {
            if account.inputs.held_input().thrust != 0.0 || account.inputs.held_input().turn != 0.0
            {
                account.last_input_at = now;
            }
            if now.saturating_duration_since(account.last_input_at) >= IDLE_TIMEOUT
                && let Some(client) = &account.socket
            {
                idle.push(client.clone());
            }
        }
        for client in idle {
            self.disconnect_with_reason(client.id, "idle");
            client.socket.close_with(4002, "Idle timeout");
        }
    }

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

    fn apply_progress(&mut self, index: usize) {
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
                    player_id,
                    docked_to,
                } => {
                    if let Some(account) = self.accounts.get_mut(player_id) {
                        changed.push(*player_id);
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
                changed.push(account.id);
            }
        }
        for id in changed {
            self.mark_dirty(id, false);
        }
    }

    fn send_world_sounds(&mut self, index: usize) {
        let world = &self.sectors[index].running.world;
        let lookup = SoundLookup {
            session: &self.accounts,
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
                    player_id: account.id,
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

struct SoundLookup<'a> {
    session: &'a OrderedMap<i64, Account>,
    world: &'a crate::simulation::world::World,
}

impl WorldSoundLookup for SoundLookup<'_> {
    fn player_ship(&self, player_id: i64) -> Option<SoundShip> {
        let account = self.session.get(&player_id)?;
        Some(SoundShip {
            id: account.ship_id,
            position: self
                .entity_position(account.ship_id)
                .unwrap_or(account.position),
        })
    }
    fn ship_player(&self, entity_id: i64) -> Option<i64> {
        self.session
            .values()
            .find(|account| account.ship_id == entity_id)
            .map(|account| account.id)
    }
    fn entity_player(&self, entity_id: i64) -> Option<i64> {
        self.world.entity(entity_id)?.model.object().player_id
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

fn send_snapshot(
    account: &mut Account,
    sector: &mut SectorRuntime,
    catalog: &Catalog,
    world_seed: f64,
    committed: u64,
    regular: bool,
) {
    let Some(client) = account.socket.as_ref() else {
        return;
    };
    let socket = &client.socket;
    if !socket.is_open() || account.save_sequence > committed {
        return;
    }
    if std::mem::take(&mut account.welcome_pending) {
        send_control(
            socket,
            ServerControl::Welcome {
                player_id: account.id as u64,
                ship_id: account.ship_id as u64,
                server_tick: sector.running.world.tick,
                player_token: &account.token,
                world_seed,
                spawn: account.position,
                unlocked_paints: Some(account.unlocked_paints),
                credits: Some(account.credits),
                display_name: Some(&account.name),
                sector_name: Some(&sector.sector.name),
            },
            catalog,
        );
    }
    if let Some((sender, text)) = account.arrival_message.take() {
        send_control(
            socket,
            ServerControl::Chat {
                sender: &sender,
                sender_role: "friendly",
                channel: 0,
                text: &text,
                cargo_demand: None,
            },
            catalog,
        );
    }
    if std::mem::take(&mut account.profile_pending) {
        send_control(
            socket,
            ServerControl::Profile {
                display_name: &account.name,
            },
            catalog,
        );
    }
    if !account.playing {
        return;
    }
    if std::mem::take(&mut account.respawn_pending) {
        send_control(
            socket,
            ServerControl::Respawn {
                ship_id: account.ship_id as u64,
            },
            catalog,
        );
    }
    if std::mem::take(&mut account.progress_pending) {
        send_control(
            socket,
            ServerControl::Progress {
                unlocked_paints: account.unlocked_paints,
                credits: Some(account.credits),
            },
            catalog,
        );
    }
    if let Some(error) = account.hangar.response.take()
        && let Err(error) = hangar::send(account, &sector.running.world, socket, error)
    {
        eprintln!("hangar snapshot encoding failed: {error}");
        socket.close_with(1011, "Invalid server snapshot");
        return;
    }

    let tick = sector.running.world.tick;
    let prepared = match account.delivery.prepare(SnapshotRequest {
        tick,
        step: catalog.simulation.simulation_step,
        regular,
        buffered_bytes: socket.buffered_bytes(),
        dock_sequence: account.dock_sequence,
    }) {
        Ok(prepared) => prepared,
        Err(stall) => {
            if stall == SnapshotStall::SocketLimit {
                socket.terminate();
            }
            if let Some(stats) = &mut account.stats {
                stats.record_stall(stall);
            }
            return;
        }
    };
    let plan = prepared.plan();
    sector.prepare_replication();
    let world = &mut sector.running.world;
    let mut forced = SmallVec::<[i64; 2]>::new();
    if plan.force_ship_update {
        forced.push(account.ship_id);
        if let Some(docked) = world
            .entity(account.ship_id)
            .and_then(|entity| entity.model.craft())
            .and_then(|craft| craft.docked_to)
        {
            forced.push(docked);
        }
    }
    account
        .selection
        .set_snapshot_deltas(socket.snapshot_deltas());
    let selection = account.selection.select(
        &mut sector.view,
        &catalog.simulation,
        SelectOptions {
            tick,
            load: plan.load,
            players: world.players.len(),
            position: account.position,
            owned: account.ship_id,
            force_update: &forced,
        },
    );
    let aliases = account
        .dock_aliases
        .iter()
        .map(|(&from, &(to, _))| [from, to])
        .collect::<SmallVec<[[i64; 2]; 16]>>();
    let packet = account.writer.encode(
        selection,
        SnapshotMetadata {
            load: plan.load,
            tick,
            next_entity_id: world.ids.next_entity as u64,
            ack: Some(account.inputs.acknowledged_sequence()),
            sequence: plan.receipt_sequence,
            dock_sequence: Some(account.dock_sequence),
            credits: Some(account.credits),
            dock_ids: &aliases,
            input_lead: account.inputs.input_lead(),
        },
        &mut sector.batch,
        &catalog.protocol,
        world,
    );
    let packet = match packet {
        Ok(packet) => packet,
        Err(error) => {
            eprintln!("snapshot encoding failed: {error}");
            socket.close_with(1011, "Invalid server snapshot");
            return;
        }
    };
    prepared.commit();
    account.inputs.clear_input_lead();
    if let Some(stats) = &mut account.stats {
        stats.record_snapshot(
            &account.delivery,
            SnapshotSample {
                tick,
                regular,
                requested: plan.receipt_sequence.is_some(),
                bytes: packet.len(),
            },
        );
    }
    send(socket, packet);
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
