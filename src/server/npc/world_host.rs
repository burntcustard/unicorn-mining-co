//! Connect sector NPCs to live entities, regional streaming, and held controls.

use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD_NO_PAD;
use serde::Serialize;
use smallvec::SmallVec;

use crate::objects::craft::{CargoObject, InstalledModule};
use crate::objects::item::Item;
use crate::objects::ship::Ship;
use crate::objects::station::Station;
use crate::persistence::{SavedNpc, SectorState};
use crate::protocol::{
    DockAction, Input, InputFrame, SimulationEvent, StationDescription, WorldRanges,
};
use crate::simulation::game_object::{GameObject, ObjectProperties};
use crate::simulation::running_world::RunningWorld;
use crate::simulation::saved_entity::SavedModel;
use crate::simulation::streaming::StreamingRegions;
use crate::simulation::world::{Entity, EntityKind, Player, World};
use crate::specs::Catalog;
use crate::utilities::seeded_random::SeededRandom;
use crate::utilities::vector::Vector;
use crate::utilities::vector_math::RotValue;

use super::collection::{COLLECTION_APPROACH_TIME, collection_hatch};
use super::collector::{
    CollectorDispatch, CollectorDispatchEnvironment, PickupItem, StationDispatch,
};
use super::collector_control::{self, CollectorEnvironment, CollectorShip, Controller};
use super::contact_forecast::{ContactForecast, ForecastKind, ForecastOptions, ForecastSource};
use super::flight::{AttackOptions, FlightContext, FlightTarget, Movement, Pilot};
use super::marauder::{self, MarauderEnvironment, MarauderSpawn};
use super::navigation::{DockingGuide, DockingStation, Search};
use super::perception::{CaptureOptions, ObstacleSnapshot, SIGHT_RANGE, can_see, physical_bounds};
use super::pirate::{self, LootView, PirateEnvironment, ShipView, SpawnRequest, SpawnedPirate};
use super::prediction::ShipMotion;

pub struct NpcPlayer {
    pub account: String,
    pub display_name: String,
    pub observer_id: i64,
    pub ship_id: i64,
    pub ship_dead: bool,
    pub connected: bool,
    pub encounter_after: u64,
    pub in_sector: bool,
}

pub struct NpcMessage {
    pub recipient: Option<String>,
    pub sender: String,
    pub role: &'static str,
    pub text: String,
    pub cargo_demand: Option<i64>,
}

pub struct NpcWorld<'a> {
    pub running: &'a mut RunningWorld,
    pub regions: &'a mut StreamingRegions<Entity>,
    pub players: &'a mut [NpcPlayer],
    pub next_observer_id: &'a mut i64,
    pub inputs: &'a mut HashMap<i64, InputFrame>,
}

pub struct SectorNpcs {
    pirates: pirate::Manager,
    collector_dispatch: CollectorDispatch,
    collectors: Vec<Controller>,
    marauders: marauder::Manager,
    host: HostState,
}

struct HostState {
    obstacles: HashMap<i64, ObstacleSnapshot>,
    destroyed_pirates: HashMap<i64, ShipView>,
    other_npcs: Vec<i64>,
    positions: Vec<Vector>,
    messages: Vec<NpcMessage>,
    dialog_random: SeededRandom,
}

impl SectorNpcs {
    pub fn references_player(&self, account: &str, observer: i64) -> bool {
        self.pirates.references_player(account, observer)
    }

    pub fn new(tick: u64, catalog: &Catalog) -> Self {
        Self {
            pirates: pirate::Manager::default(),
            collector_dispatch: CollectorDispatch::default(),
            collectors: Vec::new(),
            marauders: marauder::Manager::new(tick, catalog),
            host: HostState {
                obstacles: HashMap::new(),
                destroyed_pirates: HashMap::new(),
                other_npcs: Vec::new(),
                positions: Vec::new(),
                messages: Vec::new(),
                dialog_random: SeededRandom::new(f64::from(uuid::Uuid::new_v4().as_u128() as u32)),
            },
        }
    }

    #[cfg(feature = "benchmark-fixtures")]
    pub(crate) fn benchmark_roster(
        &self,
    ) -> (
        &[StationDispatch],
        &[Controller],
        impl Iterator<Item = i64> + '_,
    ) {
        (
            self.collector_dispatch.stations(),
            &self.collectors,
            self.pirates.ship_ids(),
        )
    }

    #[cfg(feature = "benchmark-fixtures")]
    pub(crate) fn prepare_benchmark_dispatch(&mut self, station: StationDispatch) {
        self.collector_dispatch.restore(vec![station]);
    }

    #[cfg(feature = "benchmark-fixtures")]
    pub(crate) fn benchmark_collectors(&self, home: i64) -> impl Iterator<Item = i64> + '_ {
        self.collectors
            .iter()
            .filter(move |controller| controller.state.home_id == home)
            .map(|controller| controller.ship_id)
    }

    #[cfg(feature = "benchmark-fixtures")]
    pub(crate) fn launch_benchmark_collector(
        &mut self,
        world: NpcWorld<'_>,
        definition: &str,
        station: &StationDispatch,
        items: Vec<PickupItem>,
    ) {
        let mut host = Host::new(world, &mut self.host);
        host.collectors = Some(&mut self.collectors);
        let catalog = Arc::clone(&host.live().catalog);
        host.launch_collector(
            &catalog,
            definition,
            Some(format!("Collection {definition}")),
            &station.home,
            station.home_id,
            items,
        );
    }

    pub fn dispatch(&mut self, world: NpcWorld<'_>) {
        let catalog = Arc::clone(&world.running.world.catalog);
        let mut host = Host::new(world, &mut self.host);
        self.pirates.dispatch(&catalog, &mut host);
        host.collectors = Some(&mut self.collectors);
        self.collector_dispatch
            .update(host.tick(), &catalog, &mut host);
        host.collectors = None;
        self.marauders.dispatch(&mut host, &catalog);
    }

    pub fn update(&mut self, world: NpcWorld<'_>) {
        let catalog = Arc::clone(&world.running.world.catalog);
        let now = world.running.world.tick as f64 * catalog.simulation.simulation_step;
        let mut host = Host::new(world, &mut self.host);
        self.pirates.update(&catalog, &mut host);
        self.collectors
            .retain_mut(|controller| controller.update(now, &catalog, &mut host));
        host.state.other_npcs.clear();
        host.state.other_npcs.extend(self.pirates.ship_ids());
        host.state
            .other_npcs
            .extend(self.collectors.iter().map(|collector| collector.ship_id));
        self.marauders.update(&mut host, &catalog);
    }

    pub fn after_tick(&mut self, world: NpcWorld<'_>, events: &[SimulationEvent]) {
        let catalog = Arc::clone(&world.running.world.catalog);
        let mut host = Host::new(world, &mut self.host);
        self.pirates.items_collected(events, &catalog, &mut host);
        for controller in &mut self.collectors {
            controller.items_collected(events);
        }
        self.collector_dispatch.items_collected(events);
        self.pirates.hits(events, &catalog, &mut host);
    }

    pub fn drain_messages(&mut self) -> impl Iterator<Item = NpcMessage> + '_ {
        self.host.messages.drain(..)
    }

    /// The world removes destroyed entities before the next controller step.
    pub fn remember_destroyed_ship(&mut self, entity: &Entity) {
        let object = entity.model.object();
        if self.pirates.ship_ids().any(|id| id == object.id) {
            self.host.destroyed_pirates.insert(
                object.id,
                ShipView {
                    id: object.id,
                    name: object.name.clone(),
                    observer_id: object.player_number.unwrap_or_default(),
                    dead: true,
                    ..ShipView::default()
                },
            );
        }
    }

    pub fn capture(&mut self, world: NpcWorld<'_>, saved: &mut SectorState) -> Result<(), String> {
        let host = Host::new(world, &mut self.host);
        let world = host.live();
        let mut npcs = Vec::new();
        for pirate in self.pirates.capture(&host) {
            capture_npc(world, "pirate", pirate.ship_id, &pirate, &mut npcs)?;
        }
        for collector in &self.collectors {
            capture_npc(
                world,
                "collector",
                collector.ship_id,
                &collector.state,
                &mut npcs,
            )?;
        }
        for (id, marauder) in self.marauders.states(&host) {
            capture_npc(world, "marauder", id, marauder, &mut npcs)?;
        }
        saved.pirate_dispatch_at = self.pirates.dispatch_at;
        saved.npc_dispatch = serde_json::to_value(self.collector_dispatch.stations())
            .map_err(|error| error.to_string())?;
        saved.marauder_dispatch =
            serde_json::to_value(&self.marauders.dispatch).map_err(|error| error.to_string())?;
        saved.npcs = npcs;
        Ok(())
    }

    pub fn restore(&mut self, world: NpcWorld<'_>, saved: &SectorState) -> Result<(), String> {
        let mut host = Host::new(world, &mut self.host);
        self.pirates.dispatch_at = saved.pirate_dispatch_at;
        if !saved.npc_dispatch.is_null() {
            let stations: Vec<StationDispatch> = serde_json::from_value(saved.npc_dispatch.clone())
                .map_err(|error| format!("collector dispatch: {error}"))?;
            self.collector_dispatch.restore(stations);
        }
        self.marauders = marauder::Manager::new(host.tick(), &host.live().catalog);
        if !saved.marauder_dispatch.is_null() {
            self.marauders.dispatch = serde_json::from_value(saved.marauder_dispatch.clone())
                .map_err(|error| format!("marauder dispatch: {error}"))?;
        }
        let world = &mut host.world.running.world;
        let mut controllers = Vec::with_capacity(saved.npcs.len());
        for entry in &saved.npcs {
            let controller = SavedController::decode(entry)?;
            let bytes = STANDARD_NO_PAD
                .decode(&entry.model)
                .map_err(|error| error.to_string())?;
            let snapshot: SavedModel =
                ciborium::from_reader(bytes.as_slice()).map_err(|error| error.to_string())?;
            let mut model = snapshot.restore(&world.catalog, &mut world.outlines)?;
            let EntityKind::Ship(ship) = &mut model else {
                return Err(format!("NPC {} must restore to a ship", entry.id));
            };
            if ship.craft.object.id != entry.id || world.entity(entry.id).is_some() {
                return Err(format!("invalid NPC ship ID {}", entry.id));
            }
            let observer = *host.world.next_observer_id;
            *host.world.next_observer_id = observer.wrapping_add(1);
            ship.craft.object.player_number = Some(observer);
            ship.craft.object.hostile = !matches!(controller, SavedController::Collector(_));
            ship.craft.suppress_drops = matches!(controller, SavedController::Marauder(_));
            world.ids.record_entity(entry.id);
            world.add_entity(model, false);
            world.set_player(Player {
                player_number: observer,
                ship_id: entry.id,
                observer_range: SIGHT_RANGE,
            });
            controllers.push((entry.id, observer, controller));
        }

        // All restored observers are present before restoring cross-NPC aggressors.
        for (id, observer, controller) in controllers {
            match controller {
                SavedController::Pirate(state) => {
                    if !self.pirates.restore(observer, state, &mut host) {
                        host.remove(id, observer);
                    }
                }
                SavedController::Collector(state) => {
                    CollectorEnvironment::set_state(&mut host, id, state.activity);
                    self.collectors
                        .push(Controller::restore(id, observer, state));
                }
                SavedController::Marauder(state) => {
                    self.marauders.restore(&mut host, id, observer, state)
                }
            }
        }
        Ok(())
    }
}

fn capture_npc(
    world: &World,
    kind: &str,
    id: i64,
    state: &impl Serialize,
    result: &mut Vec<SavedNpc>,
) -> Result<(), String> {
    let Some(entity) = world
        .entity(id)
        .filter(|entity| !entity.model.object().dead)
    else {
        return Ok(());
    };
    let mut bytes = Vec::new();
    let model = SavedModel::capture(&entity.model, &world.catalog);
    ciborium::into_writer(&model, &mut bytes).map_err(|error| error.to_string())?;
    result.push(SavedNpc {
        kind: kind.to_owned(),
        id,
        state: serde_json::to_value(state).map_err(|error| error.to_string())?,
        model: STANDARD_NO_PAD.encode(bytes),
    });
    Ok(())
}

enum SavedController {
    Pirate(pirate::SavedPirate),
    Collector(collector_control::State),
    Marauder(marauder::State),
}

impl SavedController {
    fn decode(entry: &SavedNpc) -> Result<Self, String> {
        let state = entry.state.clone();
        let controller = match entry.kind.as_str() {
            "pirate" => serde_json::from_value(state).map(Self::Pirate),
            "collector" => serde_json::from_value(state).map(Self::Collector),
            "marauder" => serde_json::from_value(state).map(Self::Marauder),
            kind => return Err(format!("unknown NPC role {kind:?}")),
        }
        .map_err(|error| format!("NPC {}: {error}", entry.id))?;
        if let Self::Pirate(pirate) = &controller
            && pirate.ship_id != entry.id
        {
            return Err(format!(
                "NPC controller ID does not match ship {}",
                entry.id
            ));
        }
        Ok(controller)
    }
}

struct Host<'a, 'world> {
    world: NpcWorld<'world>,
    collectors: Option<&'a mut Vec<Controller>>,
    state: &'a mut HostState,
}

impl<'a, 'world> Host<'a, 'world> {
    fn new(world: NpcWorld<'world>, state: &'a mut HostState) -> Self {
        Self {
            world,
            state,
            collectors: None,
        }
    }

    fn tick(&self) -> u64 {
        self.world.running.world.tick
    }

    fn live(&self) -> &World {
        &self.world.running.world
    }

    fn entity(&self, id: i64) -> Option<&Entity> {
        self.live()
            .entity(id)
            .or_else(|| self.world.regions.sleeping(id))
    }

    fn live_ship(&self, id: i64) -> Option<&Ship> {
        as_ship(self.live().entity(id)?)
    }

    fn ship_name(&self, id: i64) -> Option<&str> {
        self.live_ship(id)
            .map(|ship| ship.craft.object.name.as_str())
            .or_else(|| {
                self.state
                    .destroyed_pirates
                    .get(&id)
                    .map(|ship| ship.name.as_str())
            })
    }

    fn live_ship_mut(&mut self, id: i64) -> Option<&mut Ship> {
        if let EntityKind::Ship(ship) = &mut self.world.running.world.entity_mut(id)?.model {
            Some(ship)
        } else {
            None
        }
    }

    fn station_id(&self, home: &StationDescription) -> i64 {
        self.world.regions.id_offset + i64::from(home.id)
    }

    fn spawn_ship(
        &mut self,
        definition: &str,
        mut properties: ObjectProperties,
        docked_to: Option<i64>,
        configure: impl FnOnce(&mut Ship, &mut World),
    ) -> Option<(i64, i64)> {
        let world = &mut self.world.running.world;
        let id = world.ids.entity();
        let observer_id = *self.world.next_observer_id;
        *self.world.next_observer_id = observer_id.wrapping_add(1);
        properties.player_number = Some(observer_id);
        let mut ship = Ship::new_player(id, definition, properties, &world.catalog, || {
            world.ids.object()
        })?;
        ship.craft.docked_to = docked_to;
        configure(&mut ship, world);
        world.add_entity(EntityKind::Ship(Box::new(ship)), false);
        world.set_player(Player {
            player_number: observer_id,
            ship_id: id,
            observer_range: SIGHT_RANGE,
        });
        self.state.positions.clear();
        self.state
            .positions
            .extend(self.world.players.iter().filter_map(|player| {
                if !player.in_sector {
                    return None;
                }
                world
                    .entity(player.ship_id)
                    .map(|entity| entity.model.object().position)
            }));
        self.world.regions.sync(world, &self.state.positions);
        if let Some(home) = docked_to {
            let mut random = world.random;
            let bearing = world
                .entity(home)
                .and_then(as_station)
                .and_then(|station| station.launch_bearing(|| random.next_float()));
            world.random = random;
            if let Some(ship) = self.live_ship_mut(id) {
                ship.launch(bearing);
            }
        }
        Some((id, observer_id))
    }

    fn remove(&mut self, ship: i64, observer: i64) {
        let world = &mut self.world.running.world;
        world.remove_player(observer);
        world.remove_entity(ship);
        self.world.inputs.remove(&observer);
        self.state.obstacles.remove(&ship);
        self.state.destroyed_pirates.remove(&ship);
    }

    fn set_input(&mut self, observer: i64, input: Input) {
        let frame = self.world.inputs.entry(observer).or_default();
        frame.input = input;
        frame.changes.clear();
    }

    fn set_state(&mut self, id: i64, state: &'static str) {
        if let Some(ship) = self.live_ship_mut(id) {
            ship.npc_state = state;
        }
    }

    fn can_see(&self, id: i64, target: i64) -> bool {
        self.live_ship(id)
            .zip(self.live_ship(target))
            .is_some_and(|(ship, target)| can_see(ship, target, true, self.live().entities()))
    }

    fn select_dialog(&mut self, lines: &[String]) -> String {
        if lines.is_empty() {
            return String::new();
        }
        lines[(self.state.dialog_random.next_float() * lines.len() as f64) as usize].clone()
    }

    fn say(
        &mut self,
        id: i64,
        role: &'static str,
        lines: &[String],
        substitutions: &[(&str, &str)],
    ) {
        let Some(sender) = self.ship_name(id).map(str::to_owned) else {
            return;
        };
        let mut message = self.select_dialog(lines);
        for (source, replacement) in substitutions {
            message = message.replace(source, replacement);
        }
        self.state.messages.push(NpcMessage {
            recipient: None,
            sender,
            role,
            text: message,
            cargo_demand: None,
        });
    }

    fn sell_cargo(&mut self, ship: i64, credits: &mut f64, exclude: Option<i64>) {
        let world = &mut self.world.running.world;
        let Some(mut entity) = world.entities.take_for_update(&ship) else {
            return;
        };
        if let EntityKind::Ship(pilot) = &mut entity.model {
            let cargo = pilot
                .craft
                .cargo_contents
                .iter()
                .map(CargoObject::id)
                .filter(|&id| Some(id) != exclude)
                .collect::<Vec<_>>();
            let dock = pilot.craft.docked_to;
            if !cargo.is_empty() {
                let mut ids = world.ids;
                let catalog = Arc::clone(&world.catalog);
                let station = dock.and_then(|id| {
                    if let EntityKind::Station(station) = &mut world.entity_mut(id)?.model {
                        Some(station.as_mut())
                    } else {
                        None
                    }
                });
                if pilot.apply_dock_action(
                    &DockAction::Sell { object_ids: cargo },
                    credits,
                    station,
                    &catalog,
                    || ids.entity(),
                ) {
                    world.ids = ids;
                    if let Some(dock) = dock {
                        world.mark_entity_changed(dock);
                    }
                }
            }
        }
        world.finish_entity_update(ship, Some(entity));
    }

    fn advance(
        &mut self,
        id: i64,
        pilot: &mut Pilot,
        movement: &Movement,
        area: Option<(Vector, f64)>,
    ) -> (FlightContext<'_>, (f64, f64)) {
        let running = &*self.world.running;
        let context = flight_context(
            running,
            self.state.obstacles.entry(id).or_default(),
            id,
            movement,
        );
        let collect_nearby = movement.collect
            && context.ship.position.distance(movement.position)
                <= (context.ship.radius * 4.0)
                    .max(context.ship.maximum_speed * COLLECTION_APPROACH_TIME);
        let centers = if collect_nearby {
            collection_centers(running, id)
        } else {
            SmallVec::new()
        };
        let forecast = if collect_nearby {
            contact_forecast(
                running,
                context.ship,
                id,
                movement.ignore_id,
                false,
                &centers,
            )
        } else {
            None
        };
        let controls = if let Some((origin, radius)) = area {
            pilot.steer_within_with_pickup(context, movement, origin, radius, forecast.as_ref())
        } else {
            pilot.steer_with_pickup(context, movement, forecast.as_ref())
        };
        (context, controls)
    }

    fn return_movement(
        &mut self,
        id: i64,
        home: &StationDescription,
        station_id: i64,
        guide: &mut DockingGuide,
    ) -> Movement {
        let running = &*self.world.running;
        let world = &running.world;
        let fallback = Movement {
            position: home.position,
            target_id: station_id,
            ..Movement::default()
        };
        let Some(station) = world.entity(station_id).and_then(as_station) else {
            return fallback;
        };
        let Some(ship) = world.entity(id).and_then(as_ship) else {
            return fallback;
        };
        let local = &ship.craft.object.local_movement;
        let context = flight_context(
            running,
            self.state.obstacles.entry(id).or_default(),
            id,
            &Movement {
                ignore_id: station_id,
                ..Movement::default()
            },
        );
        let Some(mut forecast) = contact_forecast(running, context.ship, id, station_id, true, &[])
        else {
            return fallback;
        };
        guide.movement(
            context,
            docking_station(station),
            (local.parent == Some(station_id)).then_some(local.rate),
            &mut forecast,
        )
    }
}

impl PirateEnvironment for Host<'_, '_> {
    fn tick(&self) -> u64 {
        self.tick()
    }

    fn players(&self) -> impl Iterator<Item = pirate::Player> {
        self.world
            .players
            .iter()
            .filter(|player| player.in_sector)
            .map(|player| pirate_player(self.live(), player))
    }

    fn player(&self, account: &str) -> Option<pirate::Player> {
        self.world
            .players
            .iter()
            .find(|player| player.account == account)
            .map(|player| pirate_player(self.live(), player))
    }

    fn all_player_identities(&self) -> impl Iterator<Item = (String, i64)> {
        self.world
            .players
            .iter()
            .map(|player| (player.account.clone(), player.observer_id))
    }

    fn observer_ship(&self, observer: i64) -> Option<ShipView> {
        PirateEnvironment::ship(self, self.live().player(observer)?.ship_id)
    }

    fn ship(&self, id: i64) -> Option<ShipView> {
        self.live_ship(id)
            .map(|ship| pirate_ship(ship, &self.live().catalog, true))
            .or_else(|| self.state.destroyed_pirates.get(&id).cloned())
    }

    fn loot(&self, id: i64) -> Option<LootView> {
        let object = self.entity(id)?.model.object();
        Some(LootView {
            position: object.position,
            velocity: object.velocity,
            dead: object.dead,
        })
    }

    fn can_see(&self, id: i64, target: i64) -> bool {
        self.can_see(id, target)
    }

    fn nearest_station(&mut self, position: Vector) -> Option<StationDescription> {
        self.world.regions.nearest_station(position)
    }

    fn set_cooldown(&mut self, account: &str, tick: u64) {
        if let Some(player) = self
            .world
            .players
            .iter_mut()
            .find(|player| player.account == account)
        {
            player.encounter_after = tick;
        }
    }

    fn spawn(&mut self, request: SpawnRequest<'_>) -> Option<SpawnedPirate> {
        let name = self.select_dialog(request.names);
        let home_id = self.station_id(request.home);
        let mut ammunition_id = 0;
        let (ship_id, observer_id) = self.spawn_ship(
            request.ship,
            ObjectProperties {
                position: request.home.position,
                name: Some(name),
                ..ObjectProperties::default()
            },
            Some(home_id),
            |ship, world| {
                ship.craft.object.hostile = true;
                ship.npc_state = "Pursuing";
                ammunition_id = add_ammunition(ship, world, request.ammunition);
            },
        )?;
        Some(SpawnedPirate {
            ship_id,
            observer_id,
            home_id,
            ammunition_id,
        })
    }

    fn remove(&mut self, ship: i64, observer: i64) {
        self.remove(ship, observer);
    }
    fn set_input(&mut self, observer: i64, input: Input) {
        self.set_input(observer, input);
    }

    fn set_state(&mut self, id: i64, activity: pirate::Activity) {
        let label = match activity {
            pirate::Activity::Pursuing => "Pursuing",
            pirate::Activity::Waiting => "Waiting",
            pirate::Activity::Fighting => "Fighting",
            pirate::Activity::Search => "Search",
            pirate::Activity::Collecting => "Collecting",
            pirate::Activity::Returning => "Returning",
            pirate::Activity::Docked => "Docked",
            pirate::Activity::Stranded => "Stranded",
        };
        self.set_state(id, label);
    }

    fn cargo_demand(&mut self, id: i64, victim: &str, active: bool) {
        if let Some(sender) = self.ship_name(id).map(str::to_owned)
            && self
                .world
                .players
                .iter()
                .any(|player| player.account == victim && player.connected)
        {
            self.state.messages.push(NpcMessage {
                recipient: Some(victim.to_owned()),
                sender,
                role: "hostile",
                text: String::new(),
                cargo_demand: Some(if active { id } else { 0 }),
            });
        }
    }

    fn release_cargo(&mut self, id: i64) -> bool {
        let catalog = Arc::clone(&self.live().catalog);
        let Some(ship) = self.live_ship_mut(id) else {
            return false;
        };
        ship.cargo_release(&catalog);
        ship.releasing_cargo()
    }

    fn sell_cargo(&mut self, id: i64, credits: &mut f64, exclude: Option<i64>) {
        self.sell_cargo(id, credits, exclude);
    }
    fn say(&mut self, id: i64, lines: &[String], replacements: &[(&str, &str)]) {
        self.say(id, "hostile", lines, replacements);
    }

    fn steer(&mut self, id: i64, pilot: &mut Pilot, movement: &Movement) -> (f64, f64) {
        self.advance(id, pilot, movement, None).1
    }

    fn search(&mut self, id: i64, pilot: &mut Pilot, search: &mut Search) -> (f64, f64) {
        let context = flight_context(
            self.world.running,
            self.state.obstacles.entry(id).or_default(),
            id,
            &Movement::default(),
        );
        pilot.steer(context, &search.movement(context))
    }

    fn attack(
        &mut self,
        id: i64,
        pilot: &mut Pilot,
        target: FlightTarget,
        options: AttackOptions,
    ) -> (f64, f64, bool) {
        let context = flight_context(
            self.world.running,
            self.state.obstacles.entry(id).or_default(),
            id,
            &Movement {
                target_id: target.entity_id,
                pass_distance: options.pass_distance,
                ..Movement::default()
            },
        );
        pilot.attack(context, target, options)
    }

    fn return_movement(
        &mut self,
        id: i64,
        home: &StationDescription,
        home_id: i64,
        guide: &mut DockingGuide,
    ) -> Movement {
        self.return_movement(id, home, home_id, guide)
    }
}

impl CollectorDispatchEnvironment for Host<'_, '_> {
    fn items(&self) -> impl Iterator<Item = &GameObject> {
        self.live_items().chain(
            self.world
                .regions
                .sleeping_entities()
                .map(|entity| entity.model.object())
                .filter(|object| object.item),
        )
    }

    fn stations(&mut self, origin: Vector, marker_radius: f64) -> Vec<(i64, StationDescription)> {
        let ranges = WorldRanges {
            station_marker: marker_radius,
            ..WorldRanges::default()
        };
        self.world
            .regions
            .procedural
            .query(origin, Some(ranges))
            .station_markers
            .into_iter()
            .map(|station| (self.station_id(&station), (*station).clone()))
            .collect()
    }

    fn assigned(&self, home_id: i64) -> impl Iterator<Item = &PickupItem> {
        self.collectors
            .as_deref()
            .into_iter()
            .flatten()
            .filter(move |collector| {
                collector.state.home_id == home_id
                    && matches!(
                        collector.state.activity,
                        collector_control::Activity::Collecting
                            | collector_control::Activity::Inspecting
                    )
            })
            .flat_map(|collector| collector.state.items.iter())
    }

    fn sample(&mut self) -> f64 {
        self.world.running.world.random.next_float()
    }

    fn launch(&mut self, home: &StationDescription, home_id: i64, items: Vec<PickupItem>) {
        let catalog = Arc::clone(&self.live().catalog);
        self.launch_collector(
            &catalog,
            &catalog.collector_spec.ship,
            None,
            home,
            home_id,
            items,
        );
    }
}

impl Host<'_, '_> {
    fn launch_collector(
        &mut self,
        catalog: &Catalog,
        definition: &str,
        name: Option<String>,
        home: &StationDescription,
        home_id: i64,
        items: Vec<PickupItem>,
    ) {
        let rules = &catalog.collector_spec;
        let name = name.unwrap_or_else(|| self.select_dialog(&rules.names));
        let Some((ship_id, observer_id)) = self.spawn_ship(
            definition,
            ObjectProperties {
                position: home.position,
                name: Some(name),
                ..ObjectProperties::default()
            },
            Some(home_id),
            |ship, _| {
                ship.npc_state = "Collecting";
            },
        ) else {
            return;
        };
        let (hull_segments, modules) = self.live_ship(ship_id).map(equipment).unwrap_or_default();
        if let Some(collectors) = &mut self.collectors {
            collectors.push(Controller::restore(
                ship_id,
                observer_id,
                collector_control::State {
                    home: home.clone(),
                    home_id,
                    items,
                    hull_segments,
                    modules,
                    ..collector_control::State::default()
                },
            ));
        }
        self.say(
            ship_id,
            "friendly",
            &catalog.collector_dialog.departure,
            &[],
        );
    }
}

impl CollectorEnvironment for Host<'_, '_> {
    fn ship(&self, id: i64) -> Option<CollectorShip> {
        let entity = self.live().entity(id)?;
        let ship = as_ship(entity)?;
        let catalog = &self.live().catalog;
        let (hull_segments, modules) = equipment(ship);
        Some(CollectorShip {
            motion: ShipMotion::from_ship(ship, catalog, ship.craft.object.radius),
            dead: ship.craft.object.dead,
            docked: ship.craft.docked_to.is_some(),
            stranded: ship.stranded(),
            launching: ship.craft.launching > 0.0,
            cargo_contents: ship
                .craft
                .cargo_contents
                .iter()
                .map(CargoObject::id)
                .collect(),
            cargo_space: ship.cargo_space,
            hull_segments,
            modules,
        })
    }

    fn item(&self, id: i64) -> Option<&GameObject> {
        let object = self.entity(id)?.model.object();
        object.item.then_some(object)
    }

    fn live_items(&self) -> impl Iterator<Item = &GameObject> {
        self.live()
            .entities()
            .map(|entity| entity.model.object())
            .filter(|object| object.item)
    }

    fn return_station(&self, home: Vector) -> Option<DockingStation<'_>> {
        self.live()
            .entities()
            .filter_map(as_station)
            .find(|station| {
                !station.craft.object.dead
                    && !station.docking_bays.is_empty()
                    && station.craft.object.position.distance_squared(home) < 1.0
            })
            .map(docking_station)
    }

    fn return_movement(
        &mut self,
        id: i64,
        home: &StationDescription,
        home_id: i64,
        docking: &mut DockingGuide,
    ) -> Movement {
        self.return_movement(id, home, home_id, docking)
    }

    fn steer(
        &mut self,
        id: i64,
        pilot: &mut Pilot,
        movement: Movement,
        operating_area: Option<(Vector, f64)>,
    ) -> Input {
        let (context, (thrust, turn)) = self.advance(id, pilot, &movement, operating_area);
        Input {
            thrust,
            turn,
            cargo_hatch: movement.collect
                && collection_hatch(context.ship, context.ship.model_radius, movement.position),
            ..Input::default()
        }
    }

    fn set_input(&mut self, observer: i64, input: Input) {
        self.set_input(observer, input);
    }

    fn set_state(&mut self, id: i64, activity: collector_control::Activity) {
        let label = match activity {
            collector_control::Activity::Collecting => "Collecting",
            collector_control::Activity::Inspecting => "Inspecting",
            collector_control::Activity::Returning => "Returning",
            collector_control::Activity::Stranded => "Stranded",
        };
        self.set_state(id, label);
    }

    fn sell_cargo(&mut self, id: i64, credits: &mut f64) {
        self.sell_cargo(id, credits, None);
    }
    fn remove(&mut self, id: i64, observer: i64) {
        self.remove(id, observer);
    }

    fn say(&mut self, id: i64, lines: &[String], item_name: Option<&str>) {
        if let Some(item_name) = item_name {
            self.say(id, "friendly", lines, &[("{item_name}", item_name)]);
        } else {
            self.say(id, "friendly", lines, &[]);
        }
    }
}

impl MarauderEnvironment for Host<'_, '_> {
    fn tick(&self) -> u64 {
        self.tick()
    }

    fn players(&self) -> impl Iterator<Item = marauder::PlayerView<'_>> {
        self.world
            .players
            .iter()
            .filter(|player| player.in_sector)
            .map(|player| marauder::PlayerView {
                account: &player.account,
                observer_id: player.observer_id,
                ship_id: player.ship_id,
                connected: player.connected,
            })
    }

    fn observer_exists(&self, id: i64) -> bool {
        self.live().player(id).is_some()
    }

    fn ship(&self, id: i64) -> Option<&Ship> {
        self.live_ship(id)
    }

    fn other_npc_ships(&self) -> impl Iterator<Item = i64> {
        self.state.other_npcs.iter().copied()
    }

    fn can_see(&self, id: i64, target: i64) -> bool {
        self.can_see(id, target)
    }

    fn flight_context(&mut self, id: i64, target: Option<i64>) -> FlightContext<'_> {
        flight_context(
            self.world.running,
            self.state.obstacles.entry(id).or_default(),
            id,
            &Movement {
                target_id: target.unwrap_or_default(),
                pass_distance: self.world.running.world.catalog.marauder_spec.pass_distance,
                ..Movement::default()
            },
        )
    }

    fn spawn(&mut self, request: MarauderSpawn<'_>) -> Option<(i64, i64)> {
        self.spawn_ship(
            request.ship_spec,
            ObjectProperties {
                position: request.position,
                rotation: request.rotation,
                name: Some(request.name.into()),
                ..ObjectProperties::default()
            },
            None,
            |ship, world| {
                ship.craft.object.hostile = true;
                for _ in 0..request.weapons {
                    if let Some(spec) = world.catalog.module_specs.get(request.weapon) {
                        let module = InstalledModule::new(
                            world.ids.object(),
                            request.weapon.into(),
                            Arc::clone(spec),
                        );
                        if let Some(mount) = ship.craft.mounts.iter().position(|mount| {
                            mount.module.is_none() && mount.accepts(request.weapon)
                        }) {
                            ship.fit(mount, Some(module));
                        }
                    }
                    add_ammunition(ship, world, request.ammunition);
                }
                ship.craft.suppress_drops = true;
                ship.npc_state = "Pursuing";
                ship.craft.set_module_active("flightMode", true);
            },
        )
    }

    fn remove(&mut self, id: i64, observer: i64) {
        self.remove(id, observer);
    }
    fn set_state(&mut self, id: i64, activity: marauder::Activity) {
        self.set_state(id, activity.label());
    }
    fn set_input(&mut self, observer: i64, input: Input) {
        self.set_input(observer, input);
    }
}

fn as_ship(entity: &Entity) -> Option<&Ship> {
    if let EntityKind::Ship(ship) = &entity.model {
        Some(ship)
    } else {
        None
    }
}

fn as_station(entity: &Entity) -> Option<&Station> {
    if let EntityKind::Station(station) = &entity.model {
        Some(station)
    } else {
        None
    }
}

fn docking_station(station: &Station) -> DockingStation<'_> {
    let object = &station.craft.object;
    DockingStation {
        id: object.id,
        position: object.position,
        velocity: object.velocity,
        rotation: object.rotation,
        spin: object.spin,
        radius: object.radius,
        bays: &station.docking_bays,
    }
}

fn equipment(ship: &Ship) -> (usize, usize) {
    let hulls = ship
        .craft
        .hulls
        .iter()
        .filter(|hull| hull.present && hull.health >= 1.0)
        .count();
    let modules = ship
        .craft
        .mounts
        .iter()
        .filter(|mount| mount.module.is_some() && mount.health >= 1.0)
        .count();
    (hulls, modules)
}

fn add_ammunition(ship: &mut Ship, world: &mut World, definition: &str) -> i64 {
    let id = world.ids.entity();
    if let Some(item) = Item::new(id, definition, ObjectProperties::default(), &world.catalog) {
        ship.craft
            .cargo_contents
            .push(CargoObject::Item(Box::new(item)));
    }
    id
}

fn pirate_player(world: &World, player: &NpcPlayer) -> pirate::Player {
    let ship = world
        .entity(player.ship_id)
        .and_then(as_ship)
        .filter(|_| player.in_sector)
        .map_or_else(
            || ShipView {
                id: player.ship_id,
                observer_id: player.observer_id,
                dead: player.ship_dead,
                ..ShipView::default()
            },
            |ship| {
                pirate_ship(
                    ship,
                    &world.catalog,
                    world.player(player.observer_id).is_some(),
                )
            },
        );
    pirate::Player {
        account: player.account.clone(),
        display_name: player.display_name.clone(),
        observer_id: player.observer_id,
        connected: player.connected,
        encounter_after: player.encounter_after,
        ship,
    }
}

fn pirate_ship(ship: &Ship, catalog: &Catalog, resident: bool) -> ShipView {
    let object = &ship.craft.object;
    let mut has_hatch = false;
    let mut has_cannon = false;
    for mount in &ship.craft.mounts {
        if let Some(module) = &mount.module
            && mount.health >= 1.0
            && ship.craft.hulls[mount.hull].health >= 1.0
            && !module.parts.is_empty()
        {
            has_hatch |= module.spec.behavior == "cargoHatch";
            has_cannon |= module.definition_id == "cannonSm";
        }
    }
    let radius = physical_bounds(ship, false, catalog.simulation.linear_slop).0;
    let motion = ShipMotion::from_ship(ship, catalog, radius);
    ShipView {
        id: object.id,
        name: object.name.clone(),
        observer_id: object.player_number.unwrap_or_default(),
        motion,
        dead: object.dead,
        resident,
        docked: ship.craft.docked_to.is_some(),
        launching: ship.craft.launching > 0.0,
        in_transit: ship.craft.transit_time != 0.0,
        stranded: ship.stranded(),
        has_hatch,
        has_cannon,
        releasing_cargo: ship.releasing_cargo(),
        mined_cargo_value: ship.mined_cargo_value(),
        cargo_space: ship.cargo_space,
        cargo: ship
            .craft
            .cargo_contents
            .iter()
            .map(|entry| match entry {
                CargoObject::Item(item) => pirate::Cargo {
                    id: item.object.id,
                    item: true,
                    rounds: item.rounds.is_some(),
                    price: item.object.price,
                },
                CargoObject::Module(module) => pirate::Cargo {
                    id: module.id,
                    item: false,
                    rounds: false,
                    price: module.spec.price,
                },
            })
            .collect(),
    }
}

pub(crate) fn flight_context<'a>(
    running: &RunningWorld,
    snapshot: &'a mut ObstacleSnapshot,
    id: i64,
    movement: &Movement,
) -> FlightContext<'a> {
    let world = &running.world;
    let catalog = &world.catalog;
    let rules = &catalog.simulation;
    let mut context = FlightContext {
        ship: ShipMotion::default(),
        rules: catalog.npc_movement,
        tick: world.tick,
        simulation_step: rules.simulation_step,
        launching: false,
        obstacles: &[],
        target: None,
    };
    let Some(ship) = world.entity(id).and_then(as_ship) else {
        return context;
    };
    let slop = rules.linear_slop;
    let radius = physical_bounds(ship, false, slop).0;
    context.ship = ShipMotion::from_ship(ship, catalog, radius);
    context.launching = ship.craft.launching > 0.0;
    if movement.controls.is_some() || context.launching && !movement.waiting {
        return context;
    }
    context.target = world.entity(movement.target_id).map(|target| {
        let object = target.model.object();
        let is_ship = as_ship(target).is_some();
        FlightTarget {
            entity_id: object.id,
            position: object.position,
            velocity: object.velocity,
            radius: if is_ship {
                physical_bounds(target, false, slop).0.max(1.0)
            } else {
                object.radius
            },
            is_ship,
        }
    });
    let ignore_id = if !movement.waiting
        && context.target.is_some_and(|target| target.is_ship)
        && (movement.pass_distance > 0.0 || movement.follow_distance > 0.0)
    {
        movement.target_id
    } else {
        movement.ignore_id
    };
    context.obstacles = snapshot.capture(
        CaptureOptions {
            ship_id: id,
            ignore_id,
            target_id: movement.target_id,
            can_collect: ship.craft.cargo_contents.len() < ship.cargo_space,
            collecting: movement.collect,
            following: movement.follow_distance > 0.0,
            tick: world.tick,
            entity_count: world.entities.len(),
            simulation_step: rules.simulation_step,
            decision_interval: catalog.npc_movement.decision_interval,
            minimum_speed_squared: rules.motion.minimum_speed_squared,
            linear_slop: slop,
        },
        world.entities(),
        |entity| {
            if let EntityKind::Asteroid(asteroid) = &entity.model {
                Some((&asteroid.outline().points, asteroid.geometry_revision()))
            } else {
                None
            }
        },
    );
    context
}

fn collection_centers(running: &RunningWorld, id: i64) -> SmallVec<[Vector; 4]> {
    let Some(ship) = running.world.entity(id).and_then(as_ship) else {
        return SmallVec::new();
    };
    let object = &ship.craft.object;
    let (sin, cos) = (-object.rotation).sin_cos();
    let rotation = RotValue { sin, cos };
    let mut centers = SmallVec::new();
    ship.craft.with_hitboxes(|colliders| {
        for collider in colliders.iter().filter(|collider| collider.catches) {
            centers.push(rotation.rotate(collider.pose.position - object.position));
        }
    });
    centers
}

fn contact_forecast<'a>(
    running: &'a RunningWorld,
    motion: ShipMotion,
    ship: i64,
    target: i64,
    docking: bool,
    centers: &'a [Vector],
) -> Option<ContactForecast<'a>> {
    let world = &running.world;
    let ship_entity = world.entity(ship)?;
    let ship_model = as_ship(ship_entity)?;
    let target_entity = world.entity(target)?;
    let object = target_entity.model.object();
    let source = |entity: &'a Entity| {
        let object = entity.model.object();
        let kind = match &entity.model {
            EntityKind::Ship(_) => ForecastKind::Ship,
            EntityKind::Station(station) => ForecastKind::Station {
                local_movement_radius: station.local_movement_radius,
            },
            EntityKind::Asteroid(_) => ForecastKind::Asteroid,
            _ => ForecastKind::GameObject,
        };
        ForecastSource {
            object,
            kind,
            prepared: running.prepared_collision_body(object.id),
        }
    };
    Some(ContactForecast::new(
        ForecastOptions {
            catalog: &world.catalog,
            ship_motion: motion,
            tick: world.tick,
            docking,
            can_dock: ship_model.craft.cockpit.is_some() && ship_model.craft.launching == 0.0,
            can_collect: object.item
                && ship_model.craft.object.player_number.is_some()
                && ship_model.craft.module_active("cargoHatch")
                && (object.message.is_some()
                    || ship_model.craft.cargo_contents.len() < ship_model.cargo_space),
            centers,
        },
        source(ship_entity),
        source(target_entity),
        world
            .entities()
            .filter(|entity| {
                matches!(
                    entity.model,
                    EntityKind::Station(_) | EntityKind::Asteroid(_)
                )
            })
            .map(source),
    ))
}

#[cfg(test)]
#[path = "world_host_tests.rs"]
mod tests;
