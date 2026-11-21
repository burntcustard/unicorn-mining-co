use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

use serde_json::{Value, json};

use crate::npc::collector::eligible;
use crate::objects::craft::Craft;
use crate::simulation::world::EntityKind;

use super::super::SimulationEvent;
use super::{AuthoritativeSession, npc::now_ms};

pub(super) struct Fixture {
    file: File,
    sectors: HashMap<usize, Sample>,
}

#[derive(Default)]
struct Sample {
    previous: Option<(u64, usize)>,
    events: Vec<Value>,
    known_collectors: HashSet<i64>,
}

impl Fixture {
    pub(super) fn open(path: PathBuf) -> std::io::Result<Self> {
        let file = File::options()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(path)?;
        Ok(Self {
            file,
            sectors: HashMap::new(),
        })
    }
}

fn cargo(craft: &Craft) -> Vec<i64> {
    let mut items: Vec<_> = craft.cargo_contents.iter().map(|item| item.id()).collect();
    items.sort_unstable();
    items
}

impl AuthoritativeSession {
    pub(super) fn record_collector_cleanup(&mut self, index: usize, after_tick: bool) {
        let Some(fixture) = self.fixtures.collector_cleanup.as_mut() else {
            return;
        };
        let state = fixture.sectors.entry(index).or_default();
        if !after_tick && state.previous.is_some() {
            return;
        }
        let sector = &self.sectors[index];
        let world = &sector.running.world;
        let (stations, collectors, pirate_ids) = sector.npcs.benchmark_roster();
        let pirates: HashSet<_> = pirate_ids.collect();
        let at = now_ms();
        let tick = world.tick;
        for controller in collectors {
            if state.known_collectors.insert(controller.ship_id) {
                state.events.push(json!({
                    "kind": "collector-observed", "shipID": controller.ship_id,
                    "tick": tick, "at": at, "initial": state.previous.is_none(),
                }));
            }
        }
        if after_tick {
            for event in &self.events {
                if let SimulationEvent::ItemCollected { by, item_id, .. } = *event {
                    let ship = world.player(by).map(|player| player.ship_id);
                    let actor = match ship {
                        Some(id) if state.known_collectors.contains(&id) => "collector",
                        Some(id) if pirates.contains(&id) => "pirate",
                        Some(_) => "player",
                        None => "unknown",
                    };
                    state.events.push(json!({
                        "kind": "pickup", "itemID": item_id, "shipID": ship,
                        "actor": actor, "tick": tick, "at": at,
                    }));
                }
            }
        }
        let accounts = || {
            self.accounts
                .values()
                .filter(|account| account.sector == index)
        };
        let connected = accounts()
            .filter(|account| account.socket.is_some())
            .count();
        let step = world.catalog.simulation.simulation_step;
        let interval = ((5.0 / step) as u64).max(1);
        if state
            .previous
            .is_some_and(|(previous, count)| tick - previous < interval && count == connected)
        {
            return;
        }
        let mut items = Vec::new();
        let mut station_cargo = Vec::new();
        for (sleeping, entity) in world
            .entities()
            .map(|e| (false, e))
            .chain(sector.regions.sleeping_entities().map(|e| (true, e)))
        {
            let object = entity.model.object();
            if eligible(object) {
                let nearest = stations
                    .iter()
                    .map(|station| {
                        (
                            station.home_id,
                            station.home.position.distance(object.position),
                        )
                    })
                    .min_by(|a, b| a.1.total_cmp(&b.1));
                items.push(json!({
                    "id": object.id, "position": object.position, "velocity": object.velocity,
                    "name": object.name, "definitionID": object.definition_id, "sleeping": sleeping,
                    "nearestStationID": nearest.map(|(id, _)| id),
                    "stationDistance": nearest.map(|(_, distance)| distance),
                    "inOperatingRange": nearest.is_some_and(|(_, distance)| distance <= world.catalog.collector_spec.operating_radius),
                }));
            }
            if let EntityKind::Station(station) = &entity.model
                && !station.craft.cargo_contents.is_empty()
            {
                station_cargo.push(
                    json!({"id": object.id, "kind": "station", "items": cargo(&station.craft)}),
                );
            }
        }
        let collectors: Vec<_> = collectors
            .iter()
            .filter_map(|controller| {
                let EntityKind::Ship(ship) = &world.entity(controller.ship_id)?.model else {
                    return None;
                };
                let object = &ship.craft.object;
                let saved = &controller.state;
                Some(json!({
                    "id": object.id, "position": object.position, "velocity": object.velocity,
                    "rotation": object.rotation, "fuel": ship.fuel, "state": saved.activity,
                    "targetID": saved.target_id, "items": saved.items, "cargo": cargo(&ship.craft),
                    "inspect": saved.inspect, "attemptStartedAt": saved.attempt_started_at,
                    "homeID": saved.home_id, "dead": object.dead, "dockedTo": ship.craft.docked_to,
                }))
            })
            .collect();
        let mut pirates: Vec<_> = pirates.into_iter().collect();
        pirates.sort_unstable();
        let pirates: Vec<_> = pirates.into_iter().filter_map(|id| {
            let EntityKind::Ship(ship) = &world.entity(id)?.model else { return None };
            Some(json!({"id": id, "state": ship.npc_state, "position": ship.craft.object.position, "cargo": cargo(&ship.craft)}))
        }).collect();
        let players: Vec<_> = accounts().map(|account| {
            let items = account.hidden.as_ref().or_else(|| world.entity(account.ship_id))
                .and_then(|entity| entity.model.craft()).map(cargo).unwrap_or_default();
            json!({"id": account.ship_id, "connected": account.socket.is_some(), "hidden": account.hidden.is_some(), "cargo": items})
        }).collect();
        let stations: Vec<_> = stations.iter().map(|station| {
            let mut seen: Vec<_> = station.seen.iter().copied().collect();
            seen.sort_unstable();
            json!({"id": station.home_id, "position": station.home.position, "checkAt": station.check_at,
                "launchAt": station.launch_at, "seen": seen, "queue": station.queue})
        }).collect();
        let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
        // SAFETY: getrusage initializes the writable result on success.
        if unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } != 0 {
            eprintln!(
                "Collector cleanup telemetry: {}",
                std::io::Error::last_os_error()
            );
            return;
        }
        let usage = unsafe { usage.assume_init() };
        let micros = |time: libc::timeval| time.tv_sec * 1_000_000 + time.tv_usec;
        let sample = json!({
            "at": at, "pid": std::process::id(), "sectorID": sector.sector.id, "tick": tick,
            "simulationStep": step, "connected": connected, "items": items,
            "collectors": collectors, "pirates": pirates, "players": players,
            "stations": stations, "cargo": station_cargo, "events": state.events,
            "cpu": {"userMicros": micros(usage.ru_utime), "systemMicros": micros(usage.ru_stime)},
        });
        if let Err(error) = writeln!(fixture.file, "{sample}") {
            eprintln!("Collector cleanup telemetry: {error}");
        }
        state.events.clear();
        state.previous = Some((tick, connected));
    }
}
