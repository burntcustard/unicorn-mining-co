use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::npc::collector::{PickupItem, StationDispatch};
use crate::npc::world_host::NpcWorld;
use crate::objects::item::Item;
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::world::{EntityKind, World};
use crate::utilities::vector::Vector;

use super::super::{ServerControl, SimulationEvent, send_control};
use super::AuthoritativeSession;

#[derive(Deserialize)]
pub(super) struct Fixture {
    directory: PathBuf,
    items: usize,
    #[serde(skip)]
    seeds: HashMap<i64, u32>,
    #[serde(skip)]
    encounters: HashMap<usize, Encounter>,
}

impl Fixture {
    pub(super) fn load(path: PathBuf) -> std::io::Result<Self> {
        let fixture: Self = serde_json::from_reader(fs::File::open(path)?)?;
        if !(3..=48).contains(&fixture.items) {
            return Err(std::io::Error::other("NPC fixture needs 3 to 48 items"));
        }
        Ok(fixture)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct Event {
    at: u64,
    kind: &'static str,
    #[serde(rename = "ShipID")]
    ship_id: i64,
    #[serde(rename = "ItemID")]
    item_id: i64,
}

struct Encounter {
    player: i64,
    anchor: i64,
    scenario: &'static str,
    seed: Option<u32>,
    layout: Vec<Vector>,
    item_types: Vec<String>,
    item_ids: HashSet<i64>,
    home: StationDispatch,
    trip: Option<Vec<PickupItem>>,
    started_at: u64,
    maximum_active: usize,
    docked_tick: Option<u64>,
    ships: HashSet<i64>,
    events: Vec<Event>,
}

pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn scenario(name: &str) -> Option<&'static str> {
    Some(match name {
        "Collect active" => "collector",
        "Collect empty" => "collector-empty",
        "Collect idle" => "collector-idle",
        "Collect crowded" => "collector-crowded",
        "Crowd idle" => "collector-crowded-idle",
        "Gather Courser" => "collection-courser",
        "Gather Finch" => "collection-finch",
        _ => return None,
    })
}

fn clear(world: &World, position: Vector, margin: f64) -> bool {
    world.entities().all(|entity| {
        let object = entity.model.object();
        !matches!(object.kind.as_str(), "asteroid" | "station" | "ship")
            || position.distance_squared(object.position) >= (object.radius + margin).powi(2)
    })
}

// Match the benchmark's established independent layout and mineral streams.
struct CollectionRandom(u128);

impl CollectionRandom {
    fn new(seed: u32, stream: u64) -> Self {
        Self((u128::from(seed) << 64) | u128::from(stream))
    }

    fn next(&mut self) -> u64 {
        const MULTIPLIER: u128 = (2549297995355413924 << 64) | 4865540595714422341;
        const INCREMENT: u128 = (6364136223846793005 << 64) | 1442695040888963407;
        self.0 = self.0.wrapping_mul(MULTIPLIER).wrapping_add(INCREMENT);
        let mut high = (self.0 >> 64) as u64;
        high = (high ^ (high >> 32)).wrapping_mul(0xda942042e4dd58b5);
        (high ^ (high >> 48)).wrapping_mul(self.0 as u64 | 1)
    }

    fn offset(&mut self) -> f64 {
        ((self.next() & ((1 << 53) - 1)) as f64 / ((1_u64 << 53) as f64)) * 2000.0 - 1000.0
    }

    fn index(&mut self, length: usize) -> usize {
        if length.is_power_of_two() {
            return self.next() as usize & (length - 1);
        }
        let range = length as u64;
        loop {
            let product = u128::from(self.next()) * u128::from(range);
            if product as u64 >= range.wrapping_neg() % range {
                return (product >> 64) as usize;
            }
        }
    }
}

impl AuthoritativeSession {
    pub(in crate::game_session::authoritative) fn benchmark_chat(
        &mut self,
        player: i64,
        text: &str,
    ) -> bool {
        let Some(fixture) = self.fixtures.npc.as_mut() else {
            return false;
        };
        if let Some(seed) = text.strip_prefix("/npc-benchmark-seed ") {
            if let Ok(seed) = seed.parse() {
                fixture.seeds.insert(player, seed);
            }
            return true;
        }
        if text != "/npc-benchmark-start" {
            return false;
        }
        let index = self.accounts.get(&player).unwrap().sector;
        if let Some(encounter) = fixture.encounters.get_mut(&index)
            && let Some(trip) = encounter.trip.take()
        {
            let sector = &mut self.sectors[index];
            let world = NpcWorld {
                running: &mut sector.running,
                regions: &mut sector.regions,
                players: &mut [],
                next_observer_id: &mut self.next_player_number,
                inputs: &mut self.inputs,
            };
            sector.npcs.launch_benchmark_collector(
                world,
                encounter.scenario.strip_prefix("collection-").unwrap(),
                &encounter.home,
                trip,
            );
            self.sectors.commit_ids(index);
        }
        true
    }

    pub(in crate::game_session::authoritative) fn prepare_npc_benchmark(&mut self, player: i64) {
        let Some(account) = self.accounts.get(&player) else {
            return;
        };
        let Some(scenario) = scenario(&account.name) else {
            return;
        };
        if account.playing
            || self
                .fixtures
                .npc
                .as_ref()
                .unwrap()
                .encounters
                .contains_key(&account.sector)
        {
            return;
        }
        let anchor = account.ship_id;
        let index = self.sectors.benchmark_sector(anchor);
        self.sectors.update_ids(index);
        let fixture = self.fixtures.npc.as_mut().unwrap();
        let collection = scenario.strip_prefix("collection-");
        let seed = collection.map(|_| fixture.seeds.remove(&player).unwrap_or(1));
        let sector = &mut self.sectors[index];
        let world = &mut sector.running.world;
        let home = sector
            .regions
            .nearest_station(Vector::ZERO)
            .expect("NPC fixture station");
        let home_id = sector.regions.id_offset + i64::from(home.id);
        sector.regions.sync(world, &[home.position]);

        let account = self.accounts.get_mut(&player).unwrap();
        let mut entity = account.hidden.take().expect("NPC fixture observer");
        let EntityKind::Ship(ship) = &mut entity.model else {
            unreachable!()
        };
        ship.craft.object.position = home.position;
        ship.craft.object.radius = 0.0;
        ship.craft.object.name = format!("Fixture {scenario}");
        ship.craft.object.player_number = None;
        // Docked ships have no colliders. Keep the hull intact so normal
        // damage resolution does not destroy this observer on its first tick.
        ship.craft.docked_to = Some(home_id);
        for mount in 0..ship.craft.mounts.len() {
            ship.craft.fit(mount, None);
        }
        ship.update_mass();
        ship.stored_power = 0.0;
        account.hidden = Some(entity);
        account.sector = index;
        account.position = home.position;
        account.encounter_after = u64::MAX;

        let count = match scenario {
            "collector-empty" => 0,
            "collector-crowded" | "collector-crowded-idle" => 48,
            _ => collection.map_or(fixture.items, |ship| {
                world.catalog.ship_specs[ship].cargo_space
            }),
        };
        let mut layout = Vec::new();
        if let Some(seed) = seed {
            let mut random = CollectionRandom::new(seed, 0);
            for _ in 0..10_000 {
                let offset = Vector::new(random.offset(), random.offset());
                if clear(world, home.position + offset, 100.0)
                    && layout
                        .iter()
                        .all(|prior: &Vector| prior.distance_squared(offset) >= 120.0_f64.powi(2))
                {
                    layout.push(offset);
                    if layout.len() == 8 {
                        break;
                    }
                }
            }
        } else {
            for distance in (650..=1050).step_by(80) {
                for bearing in -5..=5 {
                    let (sin, cos) = (f64::from(bearing) * 0.13).sin_cos();
                    let offset = Vector::new(cos, sin) * f64::from(distance);
                    if clear(world, home.position + offset, 45.0) {
                        layout.push(offset);
                    }
                }
            }
        }
        assert!(
            layout.len() >= count,
            "NPC fixture needs {count} clear item positions"
        );
        let minerals: Vec<_> = world
            .catalog
            .item_ids
            .iter()
            .filter(|id| (0..4).contains(&world.catalog.item_specs[*id].resource))
            .cloned()
            .collect();
        let mut mineral_random = CollectionRandom::new(seed.unwrap_or_default(), 1);
        let mut item_types = Vec::with_capacity(count);
        let mut items = Vec::with_capacity(count);
        for &offset in layout.iter().take(count) {
            let id = world.ids.entity();
            let definition =
                seed.map_or("gold", |_| &minerals[mineral_random.index(minerals.len())]);
            let item = Item::new(
                id,
                definition,
                ObjectProperties {
                    position: home.position + offset,
                    ..Default::default()
                },
                &world.catalog,
            )
            .expect("fixture item");
            items.push(PickupItem::from(&item.object));
            item_types.push(definition.to_owned());
            world.add_entity(EntityKind::Item(Box::new(item)), false);
        }
        let item_ids: HashSet<_> = items.iter().map(|item| item.id).collect();
        let active = matches!(scenario, "collector" | "collector-crowded");
        let check_at = if seed.is_some() {
            u64::MAX
        } else if active {
            world.tick
        } else {
            world.tick + (180.0 / world.catalog.simulation.simulation_step) as u64
        };
        let home = StationDispatch {
            home,
            home_id,
            check_at,
            seen: if active {
                item_ids.clone()
            } else {
                HashSet::new()
            },
            queue: Default::default(),
            launch_at: world.tick,
        };
        sector.npcs.prepare_benchmark_dispatch(home.clone());
        fixture.encounters.insert(
            index,
            Encounter {
                player,
                anchor,
                scenario,
                seed,
                layout,
                item_types,
                item_ids,
                home,
                trip: seed.map(|_| items),
                started_at: now_ms(),
                maximum_active: 0,
                docked_tick: None,
                ships: HashSet::new(),
                events: Vec::new(),
            },
        );
        self.sectors.commit_ids(index);
    }

    pub(super) fn record_npc_benchmark(&mut self, index: usize) {
        let Some(encounter) = self
            .fixtures
            .npc
            .as_mut()
            .and_then(|fixture| fixture.encounters.get_mut(&index))
        else {
            return;
        };
        let sector = &self.sectors[index];
        let world = &sector.running.world;
        let mut active = 0;
        let at = now_ms();
        for id in sector.npcs.benchmark_collectors(encounter.home.home_id) {
            active += 1;
            if encounter.ships.insert(id) {
                encounter.events.push(Event {
                    at,
                    kind: "launch",
                    ship_id: id,
                    item_id: 0,
                });
            }
        }
        encounter.maximum_active = encounter.maximum_active.max(active);
        for event in &self.events {
            match *event {
                SimulationEvent::ItemCollected { by, item_id, .. }
                    if encounter.item_ids.contains(&item_id) =>
                {
                    let ship_id = world.player(by).map_or(0, |player| player.ship_id);
                    let kind = if encounter.ships.contains(&ship_id) {
                        "pickup"
                    } else {
                        "external-pickup"
                    };
                    encounter.events.push(Event {
                        at,
                        kind,
                        ship_id,
                        item_id,
                    });
                }
                SimulationEvent::Docked {
                    player_number,
                    docked_to,
                } if encounter.seed.is_some()
                    && encounter.docked_tick.is_none()
                    && docked_to == encounter.home.home_id =>
                {
                    let Some(ship_id) = world.player(player_number).map(|player| player.ship_id)
                    else {
                        continue;
                    };
                    if !encounter.ships.contains(&ship_id) {
                        continue;
                    }
                    encounter.docked_tick = Some(world.tick);
                    encounter.events.push(Event {
                        at,
                        kind: "dock",
                        ship_id,
                        item_id: 0,
                    });
                    if let Some(client) = &self.accounts.get(&encounter.player).unwrap().socket {
                        let text = format!("/npc-benchmark-docked {ship_id} {}", world.tick);
                        send_control(
                            &client.socket,
                            ServerControl::Chat {
                                channel: 0,
                                sender: "NPC benchmark",
                                sender_role: "friendly",
                                text: &text,
                                cargo_demand: None,
                            },
                            &self.catalog,
                        );
                    }
                }
                _ => {}
            }
        }
    }

    pub(super) fn finish_npc_benchmark(&mut self, player: i64) {
        let Some(fixture) = self.fixtures.npc.as_mut() else {
            return;
        };
        fixture.seeds.remove(&player);
        let Some(account) = self.accounts.get(&player) else {
            return;
        };
        let index = account.sector;
        let Some(encounter) = fixture.encounters.remove(&index) else {
            return;
        };
        let mut retained = Vec::new();
        let mut deposited = 0;
        let sector = &self.sectors[index];
        for entity in sector
            .running
            .world
            .entities()
            .chain(sector.regions.sleeping_entities())
        {
            if let Some(craft) = entity.model.craft() {
                for item in &craft.cargo_contents {
                    if encounter.item_ids.contains(&item.id()) {
                        retained.push(item.id());
                        deposited += usize::from(matches!(entity.model, EntityKind::Station(_)));
                    }
                }
            }
        }
        retained.sort_unstable();
        let report = serde_json::json!({
            "startedAt": encounter.started_at, "endedAt": now_ms(), "scenario": encounter.scenario,
            "seed": encounter.seed, "layout": encounter.layout, "itemTypes": encounter.item_types,
            "dockedTick": encounter.docked_tick, "items": encounter.item_ids.len(),
            "maximumActive": encounter.maximum_active, "deposited": deposited,
            "cleanupCargoItems": retained, "events": encounter.events,
            "agePreparation": if encounter.seed.is_some() { "Explicit launch after warmup." }
                else { "Initial station observation is primed once; idle defers the next check by 180 seconds." },
        });
        let path = fixture
            .directory
            .join(format!("npc-{}.json", encounter.anchor));
        if let Err(error) = fs::write(path, report.to_string()) {
            eprintln!("NPC benchmark report: {error}");
        }
        self.player_numbers_by_id.remove(&account.player_id);
        self.accounts.delete(&player);
        self.fixtures.retired_sectors.push(index);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Instant;

    use crate::game_server::Session;
    use crate::specs::Catalog;

    use super::*;

    #[test]
    fn docked_observer_survives_simulation_ticks() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let mut session = AuthoritativeSession::new(25.0, catalog).unwrap();
        session.fixtures.npc = Some(Fixture {
            directory: PathBuf::new(),
            items: 6,
            seeds: HashMap::new(),
            encounters: HashMap::new(),
        });
        let player = session.create_account(Instant::now()).unwrap();
        session.accounts.get_mut(&player).unwrap().name = "Collect empty".into();
        session.play(player);

        for _ in 0..4 {
            session.tick(1);
        }

        let account = session.accounts.get(&player).unwrap();
        let world = &session.sectors[account.sector].running.world;
        let Some(EntityKind::Ship(anchor)) =
            world.entity(account.ship_id).map(|entity| &entity.model)
        else {
            panic!("NPC observer must survive its first simulation ticks");
        };
        assert_eq!(anchor.craft.object.name, "Fixture collector-empty");
        assert!(anchor.craft.docked());
        assert!(
            anchor
                .craft
                .mounts
                .iter()
                .all(|mount| mount.module.is_none())
        );
        anchor
            .craft
            .with_hitboxes(|colliders| assert!(colliders.is_empty()));
    }
}
