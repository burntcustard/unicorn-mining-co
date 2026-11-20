use std::io;
use std::ops::{Index, IndexMut};
use std::sync::Arc;
use std::time::Instant;

use crate::game_session::sector_transit::{
    GateNotice, PortalEffects, PortalEndpoint, PortalPlayer, PortalTraffic, SectorArrival,
    TransitAction, advance_gate_access, arrival_text, build_sector_portals, connect_portals,
    eligible_gate_access, gate_chat, portal, request_destination_opening, transfer_player,
};
use crate::game_session::world_checkpoint::WorldCheckpoint;
use crate::npc::world_host::{NpcPlayer, NpcWorld, SectorNpcs};
use crate::protocol::ServerControl;
use crate::random::SeededRandom;
use crate::replication::ReplicationView;
use crate::replication::records::SnapshotBatch;
use crate::simulation::region_manager::ColdRegionBudget;
use crate::simulation::running_world::RunningWorld;
use crate::simulation::sectors::{Sector, SectorMap, generate_sector_map};
use crate::simulation::streaming::StreamingRegions;
use crate::simulation::world::{Entity, EntityKind};
use crate::specs::Catalog;

use super::{
    Account, AuthoritativeSession, Input, ObserverSelection, SnapshotWriter, send_control,
};

pub(super) struct SectorRuntime {
    pub(super) running: RunningWorld,
    pub(super) regions: StreamingRegions<Entity>,
    pub(super) sector: Sector,
    pub(super) view: ReplicationView,
    pub(super) batch: SnapshotBatch,
    replication_ready: bool,
    pub(super) positions: Vec<super::Vector>,
    pub(super) last_sync: Option<u64>,
    pub(super) checkpoint: WorldCheckpoint,
    pub(super) npcs: SectorNpcs,
    traffic: PortalTraffic,
    effects: PortalEffects,
}

impl SectorRuntime {
    fn new(sector: Sector, sectors: &Sectors, now: Instant, tick: u64) -> io::Result<Self> {
        let map = &sectors.map;
        let catalog = &sectors.catalog;
        let portals = build_sector_portals(map, &sector.id, catalog)
            .ok_or_else(|| io::Error::other("invalid sector connections"))?;
        let mut running = RunningWorld::new(f64::from(sector.seed), Arc::clone(catalog));
        running.world.tick = tick;
        running.world.ids.next_entity = sectors.next_entity_id;
        running.world.ids.last_object = -portals.id_offset;
        if sectors.store_changes {
            running.world.save_changes();
        }
        let mut regions = StreamingRegions::new(sectors.seed as u32, catalog, Some(&sector));
        regions
            .procedural
            .share_cold_budget(Arc::clone(&sectors.region_budget));
        regions.id_offset = portals.id_offset;
        regions.gate_sites = portals.gate_sites;
        for portal in portals.portals {
            running
                .world
                .add_entity(EntityKind::Portal(Box::new(portal)), false);
        }
        Ok(Self {
            running,
            regions,
            sector,
            view: ReplicationView::default(),
            batch: SnapshotBatch::default(),
            replication_ready: false,
            positions: Vec::new(),
            last_sync: None,
            checkpoint: WorldCheckpoint::new(now),
            npcs: SectorNpcs::new(tick, catalog),
            traffic: PortalTraffic::default(),
            effects: PortalEffects::default(),
        })
    }

    pub(super) fn begin_replication(&mut self) {
        self.replication_ready = false;
    }

    pub(super) fn prepare_replication(&mut self) {
        if !self.replication_ready {
            self.running.world.replication_view(&mut self.view);
            self.batch.begin();
            self.replication_ready = true;
        }
    }
}

/// The sector map fixes iteration order. A destination is instantiated the
/// first time a gate connects, a ship arrives, or storage restores it.
pub(super) struct Sectors {
    pub(super) start: usize,
    pub(super) tick: u64,
    pub(super) next_entity_id: i64,
    seed: f64,
    store_changes: bool,
    catalog: Arc<Catalog>,
    map: SectorMap,
    runtimes: Vec<Option<SectorRuntime>>,
    region_budget: Arc<ColdRegionBudget>,
}

impl Sectors {
    pub(super) fn new(seed: f64, catalog: Arc<Catalog>) -> io::Result<Self> {
        let map = generate_sector_map(seed as u32, &catalog).map_err(io::Error::other)?;
        let start = map
            .sectors
            .iter()
            .position(|sector| sector.id == catalog.starting_sector_id)
            .ok_or_else(|| io::Error::other("missing starting sector"))?;
        let mut sectors = Self {
            start,
            tick: 0,
            next_entity_id: 1 << 48,
            seed,
            store_changes: false,
            catalog,
            runtimes: std::iter::repeat_with(|| None)
                .take(map.sectors.len())
                .collect(),
            region_budget: Arc::default(),
            map,
        };
        sectors.load(start, Instant::now(), 0)?;
        Ok(sectors)
    }

    pub(super) fn enable_storage(&mut self) {
        self.store_changes = true;
        for sector in self.active_mut() {
            sector.running.world.save_changes();
        }
    }

    pub(super) fn index_of(&self, id: &str) -> Option<usize> {
        self.map.sectors.iter().position(|sector| sector.id == id)
    }

    pub(super) fn load(&mut self, index: usize, now: Instant, tick: u64) -> io::Result<()> {
        let runtime = &self.runtimes[index];
        if runtime.is_none() {
            let sector = self.map.sectors[index].clone();
            self.runtimes[index] = Some(SectorRuntime::new(sector, self, now, tick)?);
        }
        Ok(())
    }

    pub(super) fn indices(&self) -> impl Iterator<Item = usize> {
        self.runtimes
            .iter()
            .enumerate()
            .filter_map(|(index, sector)| sector.is_some().then_some(index))
    }

    pub(super) fn active(&self) -> impl Iterator<Item = &SectorRuntime> {
        self.runtimes.iter().flatten()
    }

    pub(super) fn active_mut(&mut self) -> impl Iterator<Item = &mut SectorRuntime> {
        self.runtimes.iter_mut().flatten()
    }

    pub(super) fn update_ids(&mut self, index: usize) {
        let next = self.next_entity_id;
        let ids = &mut self[index].running.world.ids;
        ids.next_entity = ids.next_entity.max(next);
    }

    pub(super) fn commit_ids(&mut self, index: usize) {
        self.next_entity_id = self
            .next_entity_id
            .max(self[index].running.world.ids.next_entity);
    }

    fn pair(&mut self, from: usize, to: usize) -> Option<(&mut SectorRuntime, &mut SectorRuntime)> {
        let [source, destination] = self.runtimes.get_disjoint_mut([from, to]).ok()?;
        Some((source.as_mut()?, destination.as_mut()?))
    }
}

impl Index<usize> for Sectors {
    type Output = SectorRuntime;

    fn index(&self, index: usize) -> &Self::Output {
        self.runtimes[index].as_ref().expect("loaded sector")
    }
}

impl IndexMut<usize> for Sectors {
    fn index_mut(&mut self, index: usize) -> &mut Self::Output {
        self.runtimes[index].as_mut().expect("loaded sector")
    }
}

enum GatePhase {
    Update(f64),
    Prepare,
    Finish,
}

pub(super) enum NpcPhase {
    Dispatch,
    Update,
    AfterTick,
}

impl AuthoritativeSession {
    pub(super) fn prepare_npc_players(&mut self, sector: usize) {
        let accounts = self.accounts.values();
        let mut count = 0;
        for account in accounts {
            if count == self.npc_players.len() {
                self.npc_players.push(NpcPlayer {
                    account: String::new(),
                    display_name: String::new(),
                    observer_id: 0,
                    ship_id: 0,
                    ship_dead: false,
                    connected: false,
                    encounter_after: 0,
                    in_sector: false,
                });
            }
            let player = &mut self.npc_players[count];
            if player.observer_id != account.id {
                player.account.clone_from(&account.token);
                player.display_name.clone_from(&account.name);
            }
            player.observer_id = account.id;
            player.ship_id = account.ship_id;
            player.ship_dead = account
                .hidden
                .as_ref()
                .is_some_and(|entity| entity.model.object().dead);
            player.connected = account.socket.is_some();
            player.encounter_after = account.encounter_after;
            player.in_sector = account.sector == sector;
            count += 1;
        }
        self.npc_players.truncate(count);
    }

    pub(super) fn run_npcs(&mut self, index: usize, phase: NpcPhase) {
        let sector = &mut self.sectors[index];
        let world = NpcWorld {
            running: &mut sector.running,
            regions: &mut sector.regions,
            players: &mut self.npc_players,
            next_observer_id: &mut self.next_player_id,
            inputs: &mut self.inputs,
        };
        match phase {
            NpcPhase::Dispatch => sector.npcs.dispatch(world),
            NpcPhase::Update => sector.npcs.update(world),
            NpcPhase::AfterTick if !self.events.is_empty() => {
                sector.npcs.after_tick(world, &self.events)
            }
            NpcPhase::AfterTick => {}
        }
        if matches!(phase, NpcPhase::AfterTick) {
            // The account registry stays in the order used to build the NPC roster.
            for (account, player) in self.accounts.values_mut().zip(&self.npc_players) {
                debug_assert_eq!(account.id, player.observer_id);
                account.encounter_after = player.encounter_after;
            }
        }
        for message in sector.npcs.drain_messages() {
            let control = ServerControl::Chat {
                channel: 0,
                sender: &message.sender,
                sender_role: message.role,
                text: &message.text,
                cargo_demand: message.cargo_demand,
            };
            if let Some(recipient) = message.recipient {
                if let Some(client) = self
                    .tokens
                    .get(&recipient)
                    .and_then(|id| self.accounts.get(id))
                    .and_then(|account| account.socket.as_ref())
                {
                    send_control(&client.socket, control, &self.catalog);
                }
            } else {
                for account in self
                    .accounts
                    .values()
                    .filter(|account| account.sector == index)
                {
                    if sector.running.world.player(account.id).is_some()
                        && let Some(client) = &account.socket
                    {
                        send_control(&client.socket, control, &self.catalog);
                    }
                }
            }
        }
    }

    pub(super) fn request_gate_access(&mut self, id: i64, gate_id: u64) {
        if let Ok(gate_id) = i64::try_from(gate_id)
            && let Some(account) = self.accounts.get_mut(&id)
            && eligible_gate_access(
                &self.sectors[account.sector].running.world,
                account.ship_id,
                gate_id,
            )
        {
            account.gate_access.request(gate_id);
        }
    }

    pub(super) fn update_gates(&mut self, sector: usize, dt: f64) {
        self.gate_phase(sector, GatePhase::Update(dt));
    }

    pub(super) fn prepare_portals(&mut self, sector: usize) {
        self.gate_phase(sector, GatePhase::Prepare);
    }

    pub(super) fn finish_portals(&mut self, sector: usize) {
        self.gate_phase(sector, GatePhase::Finish);
    }

    pub(super) fn update_gate_access(&mut self, sector: usize, dt: f64) {
        let random = &mut self.dialog_random;
        let catalog = &self.catalog;
        let world = &mut self.sectors[sector].running.world;
        let mut granted_endpoints = smallvec::SmallVec::<[PortalEndpoint; 4]>::new();
        for account in self
            .accounts
            .values_mut()
            .filter(|account| account.sector == sector)
        {
            let Some(gate_id) = account.gate_access.gate_id() else {
                continue;
            };
            let (reply, endpoint) = advance_gate_access(
                world,
                &mut account.gate_access,
                account.ship_id,
                account.socket.is_some(),
                dt,
            );
            let Some(socket) = account.socket.as_ref().map(|client| &client.socket) else {
                continue;
            };
            let Some(gate) = portal(world, gate_id) else {
                continue;
            };
            for (active, messages) in [
                (reply.pending, &catalog.jump_gate_dialog.access_pending),
                (reply.granted, &catalog.jump_gate_dialog.access_granted),
            ] {
                if active && !messages.is_empty() {
                    let text = &messages[choose_dialog(random, messages.len())];
                    send_control(socket, gate_chat(gate, text), catalog);
                }
            }
            granted_endpoints.extend(endpoint);
        }
        for endpoint in granted_endpoints {
            if let Some(destination) = self.destination_sector(sector, &endpoint)
                && let Some((source, destination)) = self.sectors.pair(sector, destination)
            {
                connect_portals(
                    &mut source.running.world,
                    &endpoint,
                    &mut destination.running.world,
                );
            }
        }
    }

    fn gate_phase(&mut self, sector: usize, phase: GatePhase) {
        let mut effects = {
            let runtime = &mut self.sectors[sector];
            let active = |account: &Account| account.sector == sector && account.playing;
            let players = self
                .accounts
                .values()
                .filter(|account| active(account))
                .map(|account| PortalPlayer {
                    player_id: account.id,
                    ship_id: account.ship_id,
                    travelled_tick: account.travelled_tick,
                    display_name: &account.name,
                    hidden_position: account
                        .hidden
                        .as_ref()
                        .map(|entity| entity.model.object().position),
                });
            let world = &mut runtime.running.world;
            let traffic = &mut runtime.traffic;
            let mut effects = std::mem::take(&mut runtime.effects);
            match phase {
                GatePhase::Update(dt) => traffic.update_gates(world, players, dt, &mut effects),
                GatePhase::Prepare => traffic.prepare(world, players, &mut effects),
                GatePhase::Finish => traffic.finish(
                    world,
                    |id| {
                        self.accounts
                            .get(&id)
                            .filter(|account| active(account))
                            .map_or("", |account| &account.name)
                    },
                    &mut effects,
                ),
            }
            effects
        };
        for notice in effects.notices.drain(..) {
            self.broadcast_gate_notice(sector, &notice);
        }
        for action in effects.travel.drain(..) {
            match action {
                TransitAction::OpenDestination(entrance) => {
                    if let Some(destination) = self.destination_sector(sector, &entrance)
                        && let Some((source, destination)) = self.sectors.pair(sector, destination)
                    {
                        request_destination_opening(
                            &mut source.running.world,
                            &entrance,
                            &mut destination.running.world,
                        );
                    }
                }
                TransitAction::Arrive {
                    player_id,
                    ship_id,
                    player_name,
                    departure,
                } => self.arrive(sector, player_id, ship_id, &player_name, &departure),
            }
        }
        self.sectors[sector].effects = effects;
    }

    fn destination_sector(&mut self, source: usize, endpoint: &PortalEndpoint) -> Option<usize> {
        let index = self.sectors.index_of(&endpoint.destination_sector)?;
        let tick = self.sectors[source].running.world.tick;
        self.sectors.load(index, Instant::now(), tick).ok()?;
        self.sectors.update_ids(index);
        Some(index)
    }

    fn broadcast_gate_notice(&mut self, sector: usize, notice: &GateNotice) {
        let world = &self.sectors[sector].running.world;
        let Some(gate) = portal(world, notice.gate_id) else {
            return;
        };
        let text = notice.text(&self.catalog, |count| {
            choose_dialog(&mut self.dialog_random, count)
        });
        let message = notice.control(gate, &text);
        for account in self
            .accounts
            .values()
            .filter(|account| account.sector == sector)
        {
            if world.player(account.id).is_some()
                && let Some(client) = &account.socket
            {
                send_control(&client.socket, message, &self.catalog);
            }
        }
    }

    fn arrive(
        &mut self,
        source_index: usize,
        player_id: i64,
        ship_id: i64,
        player_name: &str,
        departure: &PortalEndpoint,
    ) {
        let Some(destination_index) = self.destination_sector(source_index, departure) else {
            return;
        };
        let Some((source, destination)) = self.sectors.pair(source_index, destination_index) else {
            return;
        };
        let Some(exit_id) = connect_portals(
            &mut source.running.world,
            departure,
            &mut destination.running.world,
        ) else {
            return;
        };
        let exit = portal(&destination.running.world, exit_id).expect("connected exit");
        let arrival = SectorArrival::from_portal(exit);
        let arrival_message = exit.gate.as_ref().map(|_| {
            let text = arrival_text(
                &self.catalog,
                departure,
                if player_name.is_empty() {
                    "pilot"
                } else {
                    player_name
                },
                |count| choose_dialog(&mut self.dialog_random, count),
            );
            (exit.object.name.clone(), text)
        });
        let travelled_tick = source.running.world.tick;
        if !transfer_player(
            &mut source.running.world,
            &mut destination.running.world,
            player_id,
            ship_id,
            arrival,
        ) {
            return;
        }
        let account = self
            .accounts
            .get_mut(&player_id)
            .expect("travelling account");
        account.sector = destination_index;
        account.arrival_message = arrival_message;
        reset_location(account, arrival, travelled_tick);
        self.inputs.remove(&player_id);
        self.sync_regions(destination_index, None);
        self.mark_dirty(player_id, false);
        self.send_snapshot(player_id);
    }
}

pub(super) fn reset_location(account: &mut Account, arrival: SectorArrival, tick: u64) {
    account.position = arrival.position;
    account.travelled_tick = Some(tick);
    account.gate_access.cancel();
    account.selection = ObserverSelection::new(true);
    account.writer = SnapshotWriter::default();
    account.delivery.clear_pending();
    account.delivery.require_load();
    account.welcome_pending = true;
    account.inputs.discard_pending(Input::default());
}

fn choose_dialog(random: &mut SeededRandom, count: usize) -> usize {
    (random.next_float() * count as f64) as usize
}

#[cfg(test)]
mod tests {
    use crate::game_server::Session;
    use crate::vector::Vector;

    use super::*;

    #[tokio::test]
    async fn gate_travel_keeps_the_pilot_and_ship_together_after_restart() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let path = std::env::temp_dir().join(format!("unicorn-transit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        let db = path.join("world.sqlite");
        let backups = path.join("backups");
        let mut session = AuthoritativeSession::new(25.0, Arc::clone(&catalog)).unwrap();
        session.open_player_accounts(&db, backups.clone()).unwrap();
        let start = session.sectors.start;
        let id = session.create_account(Instant::now()).unwrap();
        session.play(id);
        let spectator = session.create_account(Instant::now()).unwrap();
        session.play(spectator);
        let ship_id = session.accounts.get(&id).unwrap().ship_id;
        let token = session.accounts.get(&id).unwrap().token.clone();
        session.accounts.get_mut(&id).unwrap().name = "Arriving pilot".into();

        let world = &mut session.sectors[start].running.world;
        let (destination, position) = world
            .entities()
            .find_map(|entity| {
                if let EntityKind::Portal(portal) = &entity.model
                    && portal.gate.is_some()
                {
                    Some((portal.destination_sector.clone(), portal.object.position))
                } else {
                    None
                }
            })
            .expect("starting sector has a jump gate");
        let EntityKind::Ship(ship) = &mut world.entity_mut(ship_id).unwrap().model else {
            panic!("player ship missing");
        };
        ship.craft.object.position = position;
        ship.craft.object.velocity = Vector::ZERO;
        ship.craft.object.rotation = 0.75;
        ship.fuel = 7.5;
        let destination_index = session.sectors.index_of(&destination).unwrap();
        assert!(session.sectors.runtimes[destination_index].is_none());

        for _ in 0..240 {
            session.tick(1);
            if session.accounts.get(&id).unwrap().sector == destination_index {
                break;
            }
            tokio::task::yield_now().await;
        }
        let account = session.accounts.get(&id).unwrap();
        assert_eq!(account.sector, destination_index);
        assert_eq!(account.ship_id, ship_id);
        assert!(account.delivery.needs_load() && account.welcome_pending);
        assert!(
            account
                .arrival_message
                .as_ref()
                .is_some_and(|(_, text)| text.contains("Arriving pilot"))
        );
        assert_eq!(session.accounts.get(&spectator).unwrap().sector, start);
        let source = &session.sectors[start].running.world;
        let destination_world = &session.sectors[destination_index].running.world;
        assert!(source.entity(ship_id).is_none() && source.player(id).is_none());
        assert!(source.player(spectator).is_some() && destination_world.player(id).is_some());
        let EntityKind::Ship(arrived) = &destination_world.entity(ship_id).unwrap().model else {
            panic!("arrival ship missing");
        };
        assert_eq!(arrived.craft.object.rotation, 0.75);
        assert_eq!(arrived.fuel, 7.5);
        assert!(arrived.craft.transit_time > 0.0);
        session
            .shutdown(tokio::time::Instant::now() + std::time::Duration::from_secs(5))
            .await
            .unwrap();
        drop(session);

        let mut reloaded = AuthoritativeSession::new(25.0, catalog).unwrap();
        reloaded.open_player_accounts(&db, backups).unwrap();
        let id = reloaded.tokens[&token];
        let account = reloaded.accounts.get(&id).unwrap();
        assert_eq!(account.sector, destination_index);
        assert_eq!(account.ship_id, ship_id);
        let Some(EntityKind::Ship(arrived)) = account.hidden.as_ref().map(|entity| &entity.model)
        else {
            panic!("saved passenger ship missing");
        };
        assert_eq!(arrived.fuel, 7.5);
        assert!(arrived.craft.transit_time > 0.0);
        reloaded
            .shutdown(tokio::time::Instant::now() + std::time::Duration::from_secs(5))
            .await
            .unwrap();
        drop(reloaded);
        std::fs::remove_dir_all(path).unwrap();
    }
}
