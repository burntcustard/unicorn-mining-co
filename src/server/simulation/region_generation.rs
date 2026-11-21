use std::collections::{HashMap, VecDeque};
use std::f64::consts::PI;
use std::sync::Arc;

use crate::protocol::{
    AsteroidDescription, FieldDescription, RegionDescription, StationDescription, WreckDescription,
};
use crate::specs::{Catalog, RegionGeneration, SectorGeneration};
use crate::utilities::seeded_random::SeededRandom;
use crate::utilities::vector::Vector;
use crate::utilities::{round, round_ties_up};

use super::mix;
use super::sector_generation::{Sector, SectorConnectionSite, named_seed, sector_density};

const MAX_FEATURES: usize = 8192;
const MAX_CANDIDATE_REGIONS: usize = 1024;
const MAX_BEACON_CELLS: usize = 8192;

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
enum FeatureKind {
    Field,
    Station,
    Wreck,
}

enum FeatureData {
    Field {
        resource: i32,
    },
    Station {
        definition_id: &'static str,
        spin: f64,
    },
    Wreck {
        cargo_contents: Vec<i32>,
        paint: i32,
        spin: f64,
    },
}

struct Feature {
    id: u32,
    position: Vector,
    radius: f64,
    data: FeatureData,
}

type Cell = (i64, i64);
type FeatureKey = (u32, Cell, FeatureKind);
type CandidateKey = (u32, u64, u64);

/// Owns the bounded caches for one sector, or the unbounded development world.
pub struct RegionGenerator {
    sector: Option<Sector>,
    sector_spec: SectorGeneration,
    spec: RegionGeneration,
    region_size: f64,
    candidate_regions: HashMap<CandidateKey, Arc<RegionDescription>>,
    candidate_order: VecDeque<CandidateKey>,
    features: HashMap<FeatureKey, Option<Feature>>,
    beacon_gates: Vec<SectorConnectionSite>,
    gate_beacons: Vec<NavBeaconDescription>,
    scattered_beacons: hashbrown::HashMap<Cell, Option<NavBeaconDescription>>,
}

fn key_coordinate(value: f64) -> u64 {
    if value == 0.0 { 0 } else { value.to_bits() }
}

pub fn region_seed(world_seed: u32, region: Vector) -> u32 {
    mix(world_seed
        ^ mix(region.x as i64 as u32)
        ^ mix((region.y + f64::from(0x9e3779b9_u32)) as i64 as u32))
}

fn description_id(seed: u32, kind: u32, index: u32) -> u32 {
    let id = mix(seed ^ kind.wrapping_mul(0x9e3779b9) ^ index);
    if id == 0 { 1 } else { id }
}

fn random_position(random: &mut SeededRandom, cell: Vector, size: f64) -> Vector {
    Vector::new(
        round_ties_up((cell.x + random.next_float()) * size),
        round_ties_up((cell.y + random.next_float()) * size),
    )
}

fn random_spin(random: &mut SeededRandom) -> f64 {
    let direction = if random.next_float() < 0.5 { -1.0 } else { 1.0 };
    round(direction * (1.0 + random.next_float()) / 40.0)
}

fn cell_at(position: Vector, size: f64) -> Cell {
    (
        (position.x / size).floor() as i64,
        (position.y / size).floor() as i64,
    )
}

fn within(position: Vector, from: Vector, to: Vector) -> bool {
    position.x >= from.x && position.x < to.x && position.y >= from.y && position.y < to.y
}

impl RegionGenerator {
    pub fn new(catalog: &Catalog, sector: Option<&Sector>) -> Self {
        Self {
            sector: sector.cloned(),
            sector_spec: catalog.sector_generation.clone(),
            spec: catalog.region_generation.clone(),
            region_size: catalog.simulation.region_size,
            candidate_regions: HashMap::new(),
            candidate_order: VecDeque::new(),
            features: HashMap::new(),
            beacon_gates: Vec::new(),
            gate_beacons: Vec::new(),
            scattered_beacons: hashbrown::HashMap::new(),
        }
    }

    fn seed(&self, world_seed: u32) -> u32 {
        self.sector
            .as_ref()
            .map_or(world_seed, |sector| sector.seed)
    }

    fn feature_candidate(&self, world_seed: u32, cell: Cell, kind: FeatureKind) -> Option<Feature> {
        let settings = self.spec.features[kind as usize];
        if kind == FeatureKind::Station
            && self
                .sector
                .as_ref()
                .is_some_and(|sector| sector.gate_sites.is_empty())
        {
            return None;
        }
        let cell = Vector::new(cell.0 as f64, cell.1 as f64);
        let seed = region_seed(self.seed(world_seed), cell);
        let stream = if kind == FeatureKind::Station {
            self.spec.station_stream
        } else {
            0
        };
        let mut random = SeededRandom::new(f64::from(description_id(seed, settings.kind, stream)));
        let chance = random.next_float();
        let peak = self
            .sector
            .as_ref()
            .map_or(1.0, |_| self.sector_spec.density[kind as usize].peak);
        if chance >= settings.chance * peak {
            return None;
        }
        let position = random_position(&mut random, cell, settings.size);
        if let Some(sector) = &self.sector {
            if chance
                >= settings.chance
                    * sector_density(sector, position, kind as usize, &self.sector_spec)
            {
                return None;
            }
            let radius = match kind {
                FeatureKind::Station => self.spec.station_radius,
                FeatureKind::Wreck => self.spec.wreck_radius,
                FeatureKind::Field => 0.0,
            };
            if kind != FeatureKind::Field && self.near_connection(position, radius) {
                return None;
            }
        }
        let id = description_id(seed, settings.kind, 1);
        let (radius, data) = match kind {
            FeatureKind::Field => {
                let roll = random.next_float();
                let resource = if roll < self.spec.rich_field_amethyst_chance {
                    1
                } else if roll < self.spec.rich_field_gold_chance {
                    2
                } else {
                    4
                };
                let mut radius =
                    self.spec.field_radius + random.next_float() * self.spec.field_radius_range;
                if resource == 1 {
                    radius /= 2.0;
                }
                (radius, FeatureData::Field { resource })
            }
            FeatureKind::Station => {
                let spin = random_spin(&mut random);
                let definition_id = if random.next_float() < 0.5 {
                    "corral-5"
                } else {
                    "corral-6"
                };
                (
                    self.spec.station_radius,
                    FeatureData::Station {
                        definition_id,
                        spin,
                    },
                )
            }
            FeatureKind::Wreck => {
                let count = 2 + (random.next_float() * 3.0).floor() as usize;
                let cargo_contents = (0..count)
                    .map(|_| (random.next_float() * 4.0).floor() as i32)
                    .collect();
                let paint = if random.next_float() < 2.0 / 3.0 {
                    1
                } else {
                    [0, 2, 3, 4][(random.next_float() * 4.0).floor() as usize]
                };
                let spin = random_spin(&mut random);
                (
                    self.spec.wreck_radius,
                    FeatureData::Wreck {
                        cargo_contents,
                        paint,
                        spin,
                    },
                )
            }
        };
        Some(Feature {
            id,
            position,
            radius,
            data,
        })
    }

    fn connection_obstacles(&self) -> impl Iterator<Item = &SectorConnectionSite> {
        self.sector
            .as_ref()
            .into_iter()
            .flat_map(|sector| sector.gate_sites.iter().chain(&sector.wormhole_sites))
    }

    fn connection_clearance(&self) -> f64 {
        self.sector_spec.gate_arrival_distance + self.sector_spec.gate_clearance
    }

    fn near_connection(&self, position: Vector, radius: f64) -> bool {
        let clearance = self.connection_clearance() + radius;
        self.connection_obstacles()
            .any(|site| position.distance(site.position) < clearance)
    }

    fn accept_feature(&self, world_seed: u32, cell: Cell, kind: FeatureKind) -> Option<Feature> {
        let candidate = self.feature_candidate(world_seed, cell, kind)?;
        let clearance = self.spec.features[kind as usize].clearance;
        let spacing_radius = |feature: &Feature| {
            if kind == FeatureKind::Field {
                feature.radius * 0.7
            } else {
                feature.radius
            }
        };
        for y in -1..=1 {
            for x in -1..=1 {
                if x == 0 && y == 0 {
                    continue;
                }
                let neighbor = self.feature_candidate(world_seed, (cell.0 + x, cell.1 + y), kind);
                if let Some(other) = neighbor
                    && other.id < candidate.id
                    && other.position.distance(candidate.position)
                        < spacing_radius(&other) + spacing_radius(&candidate) + clearance
                {
                    return None;
                }
            }
        }
        Some(candidate)
    }

    fn for_each_feature(
        &mut self,
        world_seed: u32,
        from: Vector,
        to: Vector,
        kind: FeatureKind,
        mut visit: impl FnMut(&Feature),
    ) {
        let size = self.spec.features[kind as usize].size;
        let start = cell_at(from, size);
        let end = cell_at(to, size);
        for x in start.0..=end.0 {
            for y in start.1..=end.1 {
                let key = (world_seed, (x, y), kind);
                let feature = if let Some(feature) = self.features.get(&key) {
                    feature.as_ref()
                } else {
                    if self.features.len() >= MAX_FEATURES {
                        self.features.clear();
                    }
                    let feature = self.accept_feature(world_seed, (x, y), kind);
                    self.features.entry(key).or_insert(feature).as_ref()
                };
                if let Some(feature) = feature
                    && within(feature.position, from, to)
                {
                    visit(feature);
                }
            }
        }
    }

    pub fn generate_stations(
        &mut self,
        world_seed: u32,
        from: Vector,
        to: Vector,
    ) -> Vec<StationDescription> {
        let mut stations = Vec::new();
        self.for_each_feature(world_seed, from, to, FeatureKind::Station, |feature| {
            if let FeatureData::Station {
                definition_id,
                spin,
            } = feature.data
            {
                stations.push(StationDescription {
                    definition_id: definition_id.to_owned(),
                    id: feature.id,
                    position: feature.position,
                    radius: feature.radius,
                    spin,
                    r#type: "station".to_owned(),
                });
            }
        });
        stations
    }

    pub fn generate_fields(
        &mut self,
        world_seed: u32,
        from: Vector,
        to: Vector,
    ) -> Vec<FieldDescription> {
        let mut fields = Vec::new();
        self.for_each_feature(world_seed, from, to, FeatureKind::Field, |feature| {
            if let FeatureData::Field { resource } = feature.data {
                fields.push(FieldDescription {
                    id: feature.id,
                    position: feature.position,
                    radius: feature.radius,
                    resource,
                });
            }
        });
        fields
    }

    fn nearest_rich_field(
        &mut self,
        world_seed: u32,
        position: Vector,
    ) -> Option<FieldDescription> {
        let mut distance = self.spec.nearest_field_initial_range;
        loop {
            let radius = Vector::new(distance, distance);
            let mut nearest = None;
            let mut nearest_distance = f64::INFINITY;
            self.for_each_feature(
                world_seed,
                position - radius,
                position + radius,
                FeatureKind::Field,
                |feature| {
                    if let FeatureData::Field { resource } = feature.data
                        && resource < 3
                    {
                        let distance = feature.position.distance(position);
                        if distance < nearest_distance {
                            nearest = Some(FieldDescription {
                                id: feature.id,
                                position: feature.position,
                                radius: feature.radius,
                                resource,
                            });
                            nearest_distance = distance;
                        }
                    }
                },
            );
            if nearest_distance <= distance || distance >= self.sector_spec.rich_field_search_range
            {
                return nearest;
            }
            distance = (distance * 2.0).min(self.sector_spec.rich_field_search_range);
        }
    }

    fn make_asteroid(
        &self,
        seed: u32,
        index: usize,
        random: &mut SeededRandom,
        region: Vector,
        resource: i32,
    ) -> AsteroidDescription {
        let (base, range) = match resource {
            1 => (
                self.spec.asteroid_amethyst_radius,
                self.spec.asteroid_amethyst_range,
            ),
            2 => (
                self.spec.asteroid_gold_radius,
                self.spec.asteroid_gold_range,
            ),
            _ => (
                self.spec.asteroid_mixed_radius,
                self.spec.asteroid_mixed_range,
            ),
        };
        let radius = round(self.spec.asteroid_base_radius + (base + random.next_float() * range));
        let capacity = round_ties_up((radius / 50.0).powi(2));
        let chance = if resource > 3 {
            self.spec.mixed_item_chance
        } else {
            capacity / (capacity + 1.0)
        };
        let mut count = 0;
        if random.next_float() < chance {
            count = if resource == 1 {
                1
            } else {
                1 + (random.next_float() * capacity).floor() as usize
            };
        }
        let mut contents = Vec::with_capacity(count);
        for _ in 0..count {
            contents.push(if resource > 3 {
                3 - (random.next_float().powi(3) * 4.0).floor() as i32
            } else {
                resource
            });
        }
        if resource > 3 {
            contents.truncate(self.spec.mixed_item_limit);
        }
        AsteroidDescription {
            contents,
            id: description_id(seed, 1, index as u32),
            point_count: if resource == 1 { 6 } else { 0 },
            position: random_position(random, region, self.region_size),
            radius,
            radius_even: if resource == 1 {
                round(radius / 4.0)
            } else {
                0.0
            },
            resource,
            rotation: round(random.next_float() * PI * 2.0),
            spin: random_spin(random),
            r#type: String::new(),
        }
    }

    fn generate_candidates(&mut self, world_seed: u32, region: Vector) -> Arc<RegionDescription> {
        let key = (
            world_seed,
            key_coordinate(region.x),
            key_coordinate(region.y),
        );
        if let Some(cached) = self.candidate_regions.get(&key) {
            return Arc::clone(cached);
        }
        let from = region * self.region_size;
        let to = from + Vector::new(self.region_size, self.region_size);
        let stations = self.generate_stations(world_seed, from, to);
        let mut wrecks = Vec::new();
        self.for_each_feature(world_seed, from, to, FeatureKind::Wreck, |feature| {
            if let FeatureData::Wreck {
                ref cargo_contents,
                paint,
                spin,
            } = feature.data
            {
                wrecks.push(WreckDescription {
                    id: feature.id,
                    position: feature.position,
                    radius: feature.radius,
                    spin,
                    paint,
                    cargo_contents: cargo_contents.clone(),
                    clue_field: None,
                    r#type: "wreck".to_owned(),
                });
            }
        });
        let margin = Vector::new(self.spec.field_search_margin, self.spec.field_search_margin);
        let fields = self.generate_fields(world_seed, from - margin, to + margin);
        let mut asteroids = Vec::new();
        for field in fields {
            let seed = mix(region_seed(self.seed(world_seed), region) ^ field.id);
            let mut random = SeededRandom::new(f64::from(seed));
            let kind = match field.resource {
                1 => "amethyst",
                2 => "gold",
                _ => "mixed",
            };
            let count = self.spec.asteroid_counts.get(kind).copied().unwrap_or(0);
            for index in 0..count {
                let mut asteroid =
                    self.make_asteroid(seed, index, &mut random, region, field.resource);
                if asteroid.position.distance(field.position) < field.radius - asteroid.radius {
                    asteroid.r#type = "asteroid".to_owned();
                    asteroids.push(asteroid);
                }
            }
        }
        let candidates = Arc::new(RegionDescription {
            asteroids,
            region,
            stations,
            wrecks,
        });
        self.candidate_regions.insert(key, Arc::clone(&candidates));
        self.candidate_order.push_back(key);
        if self.candidate_regions.len() > MAX_CANDIDATE_REGIONS
            && let Some(oldest) = self.candidate_order.pop_front()
        {
            self.candidate_regions.remove(&oldest);
        }
        candidates
    }

    pub fn generate_region(&mut self, world_seed: u32, region: Vector) -> RegionDescription {
        let current = self.generate_candidates(world_seed, region);
        let mut nearby = Vec::with_capacity(9);
        for y in -1..=1 {
            for x in -1..=1 {
                nearby.push(if x == 0 && y == 0 {
                    Arc::clone(&current)
                } else {
                    self.generate_candidates(
                        world_seed,
                        region + Vector::new(f64::from(x), f64::from(y)),
                    )
                });
            }
        }
        let mut obstacles: Vec<_> = self
            .connection_obstacles()
            .map(|site| (site.position, self.connection_clearance()))
            .collect();
        for region in &nearby {
            obstacles.extend(
                region
                    .stations
                    .iter()
                    .map(|station| (station.position, station.radius)),
            );
            obstacles.extend(
                region
                    .wrecks
                    .iter()
                    .map(|wreck| (wreck.position, wreck.radius)),
            );
        }
        let spacing = self.spec.asteroid_spacing;
        let overlaps = |asteroid: &AsteroidDescription, position, radius| {
            asteroid.position.distance(position) < asteroid.radius + radius + spacing
        };
        let mut candidates = Vec::new();
        let mut local_candidates = Vec::new();
        let mut max_radius: f64 = 0.0;
        for (index, region) in nearby.iter().enumerate() {
            for asteroid in &region.asteroids {
                if obstacles
                    .iter()
                    .any(|&(position, radius)| overlaps(asteroid, position, radius))
                {
                    continue;
                }
                candidates.push(asteroid);
                if index == 4 {
                    local_candidates.push(asteroid);
                }
                max_radius = max_radius.max(asteroid.radius);
            }
        }
        let cell_size = 2.0 * max_radius + spacing;
        let mut buckets: HashMap<Cell, Vec<&AsteroidDescription>> = HashMap::new();
        for asteroid in candidates {
            buckets
                .entry(cell_at(asteroid.position, cell_size))
                .or_default()
                .push(asteroid);
        }
        let asteroids = local_candidates
            .into_iter()
            .filter(|asteroid| {
                let (x, y) = cell_at(asteroid.position, cell_size);
                !(-1..=1).any(|dy| {
                    (-1..=1).any(|dx| {
                        buckets.get(&(x + dx, y + dy)).is_some_and(|neighbors| {
                            neighbors.iter().any(|other| {
                                other.id < asteroid.id
                                    && overlaps(asteroid, other.position, other.radius)
                            })
                        })
                    })
                })
            })
            .cloned()
            .collect();
        let mut wrecks = current.wrecks.clone();
        for wreck in &mut wrecks {
            wreck.clue_field = self.nearest_rich_field(world_seed, wreck.position);
            if let Some(field) = &wreck.clue_field {
                wreck.cargo_contents.fill(field.resource);
            }
        }
        RegionDescription {
            region: current.region,
            stations: current.stations.clone(),
            asteroids,
            wrecks,
        }
    }

    /// Gate beacons and scattered beacons use separate random streams.
    pub fn generate_nav_beacons(
        &mut self,
        world_seed: u32,
        from: Vector,
        to: Vector,
        gates: &[SectorConnectionSite],
    ) -> Vec<NavBeaconDescription> {
        let Some(sector_seed) = self.sector.as_ref().map(|sector| sector.seed) else {
            return Vec::new();
        };
        if self.beacon_gates != gates {
            self.beacon_gates.clear();
            self.beacon_gates.extend_from_slice(gates);
            self.gate_beacons.clear();
            self.gate_beacons.extend(
                gates
                    .iter()
                    .map(|gate| NavBeaconDescription::for_gate(sector_seed, gate)),
            );
        }
        let mut beacons = self
            .gate_beacons
            .iter()
            .copied()
            .filter(|beacon| within(beacon.position, from, to))
            .collect::<Vec<_>>();
        let size = self.spec.features[FeatureKind::Station as usize].size;
        let start = cell_at(from, size);
        let end = cell_at(to, size);
        for x in start.0..=end.0 {
            for y in start.1..=end.1 {
                let cell = (x, y);
                let candidate = if let Some(&candidate) = self.scattered_beacons.get(&cell) {
                    candidate
                } else {
                    if self.scattered_beacons.len() >= MAX_BEACON_CELLS {
                        self.scattered_beacons.clear();
                    }
                    let candidate = self.scattered_beacon(world_seed, sector_seed, cell);
                    self.scattered_beacons.insert(cell, candidate);
                    candidate
                };
                if let Some(beacon) = candidate
                    && within(beacon.position, from, to)
                {
                    beacons.push(beacon);
                }
            }
        }
        beacons
    }

    fn scattered_beacon(
        &mut self,
        world_seed: u32,
        sector_seed: u32,
        cell: Cell,
    ) -> Option<NavBeaconDescription> {
        let cell = Vector::new(cell.0 as f64, cell.1 as f64);
        let kind = FeatureKind::Station;
        let settings = self.spec.features[kind as usize];
        let seed = description_id(region_seed(sector_seed, cell), 17, 2);
        let mut random = SeededRandom::new(f64::from(seed));
        let chance = random.next_float();
        let position = random_position(&mut random, cell, settings.size);
        let density = self.sector.as_ref().map_or(0.0, |sector| {
            sector_density(sector, position, kind as usize, &self.sector_spec)
        });
        if chance >= settings.chance * 0.5 * density || self.near_connection(position, 48.0) {
            return None;
        }
        let range = Vector::new(500.0, 500.0);
        let mut blocked = false;
        self.for_each_feature(
            world_seed,
            position - range,
            position + range,
            kind,
            |station| {
                blocked |= position.distance(station.position) < station.radius + 100.0;
            },
        );
        (!blocked).then(|| NavBeaconDescription::new(description_id(seed, 17, 3), position))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NavBeaconDescription {
    pub id: u32,
    pub position: Vector,
    pub rotation: f64,
    pub spin: f64,
}

impl NavBeaconDescription {
    fn new(id: u32, position: Vector) -> Self {
        let mut random = SeededRandom::new(f64::from(mix(id ^ 0x6e617662)));
        let rotation = random.next_float() * 2.0 * PI;
        let mut spin = 0.0025 + random.next_float() * 0.005;
        if random.next_float() < 0.5 {
            spin = -spin;
        }
        Self {
            id,
            position,
            rotation,
            spin,
        }
    }

    fn for_gate(sector_seed: u32, gate: &SectorConnectionSite) -> Self {
        let seed = named_seed(sector_seed, &format!("nav-beacon:{}", gate.id));
        let mut random = SeededRandom::new(f64::from(seed));
        let angle = random.next_float() * 2.0 * PI;
        let distance = 880.0 + random.next_float() * 120.0;
        let displacement = Vector::new(angle.cos() * distance, angle.sin() * distance);
        let mut position = gate.position + displacement;
        if position.distance(gate.arrival) < 250.0 {
            position = gate.position - displacement;
        }
        Self::new(description_id(seed, 17, 1), position)
    }
}

pub fn field_message(position: Vector, resource: i32, sector: Option<&str>) -> String {
    let label = if resource == 1 {
        "AMETHYST CLUSTER"
    } else {
        "GOLD ORE"
    };
    let prefix = sector
        .filter(|name| !name.is_empty())
        .map_or_else(String::new, |name| format!("{name} / "));
    format!(
        "{prefix}{label} {}/{}",
        position_number(position.x),
        position_number(position.y)
    )
}

fn position_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    if value.abs() < 1e21 {
        return value.to_string();
    }
    format!("{value:e}").replace('e', "e+")
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::super::sector_generation::{generate_sector, generate_sector_map};
    use super::*;

    #[derive(Deserialize)]
    struct Fixtures {
        regions: Vec<UnboundedRegionSample>,
        stations: Vec<StationSample>,
        messages: Vec<MessageSample>,
        sectors: Vec<SectorSample>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct UnboundedRegionSample {
        world_seed: u32,
        region: Vector,
        description: RegionDescription,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StationSample {
        world_seed: u32,
        from: Vector,
        to: Vector,
        stations: Vec<StationDescription>,
    }

    #[derive(Deserialize)]
    struct MessageSample {
        position: Vector,
        resource: i32,
        message: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SectorSample {
        world_seed: u32,
        samples: Vec<RegionSample>,
        field_samples: Vec<FieldSample>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RegionSample {
        sector_id: String,
        region: Vector,
        description: RegionDescription,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FieldSample {
        sector_id: String,
        from: Vector,
        to: Vector,
        fields: Vec<FieldDescription>,
    }

    #[test]
    fn regions_stations_fields_and_messages_match_typescript() {
        let fixtures: Fixtures = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/regions.json"
        )))
        .unwrap();
        let catalog = Catalog::load().unwrap();
        let mut generator = RegionGenerator::new(&catalog, None);
        for sample in fixtures.regions {
            let actual = generator.generate_region(sample.world_seed, sample.region);
            assert_eq!(
                actual, sample.description,
                "seed {} region {:?}",
                sample.world_seed, sample.region
            );
        }
        for sample in fixtures.stations {
            assert_eq!(
                generator.generate_stations(sample.world_seed, sample.from, sample.to),
                sample.stations
            );
        }
        for sample in fixtures.messages {
            assert_eq!(
                field_message(sample.position, sample.resource, None),
                sample.message
            );
        }
        for fixture in fixtures.sectors {
            let map = generate_sector_map(fixture.world_seed, &catalog).unwrap();
            let mut generators: HashMap<_, _> = map
                .sectors
                .iter()
                .map(|sector| {
                    (
                        sector.id.as_str(),
                        RegionGenerator::new(&catalog, Some(sector)),
                    )
                })
                .collect();
            for sample in fixture.samples.iter().chain(fixture.samples.iter().rev()) {
                let generator = generators.get_mut(sample.sector_id.as_str()).unwrap();
                let actual = generator.generate_region(fixture.world_seed, sample.region);
                assert_eq!(
                    actual, sample.description,
                    "seed {} sector {} region {:?}",
                    fixture.world_seed, sample.sector_id, sample.region
                );
            }
            for sample in fixture.field_samples {
                let generator = generators.get_mut(sample.sector_id.as_str()).unwrap();
                let actual = generator.generate_fields(fixture.world_seed, sample.from, sample.to);
                assert_eq!(
                    actual, sample.fields,
                    "seed {} sector {} fields",
                    fixture.world_seed, sample.sector_id
                );
            }
        }
    }

    #[test]
    fn navigation_beacons_are_deterministic_and_clear_arrivals() {
        let catalog = Catalog::load().unwrap();
        let sector = generate_sector(123, "Patroclus", &catalog.sector_generation);
        let mut generator = RegionGenerator::new(&catalog, Some(&sector));
        let from = Vector::new(-200_000.0, -200_000.0);
        let to = Vector::new(200_000.0, 200_000.0);
        let gates = [
            SectorConnectionSite {
                id: "gate-a".to_owned(),
                position: Vector::new(1000.0, 2000.0),
                arrival: Vector::new(-100.0, 2000.0),
                radius: 0.0,
            },
            SectorConnectionSite {
                id: "gate-b".to_owned(),
                position: Vector::new(-3000.0, 4000.0),
                arrival: Vector::new(-4100.0, 4000.0),
                radius: 0.0,
            },
        ];
        let beacons = generator.generate_nav_beacons(123, from, to, &gates);
        assert_eq!(
            beacons,
            generator.generate_nav_beacons(123, from, to, &gates)
        );
        let scattered = generator.generate_nav_beacons(123, from, to, &[]);
        assert!(!scattered.is_empty());
        assert_eq!(&beacons[gates.len()..], scattered);
        for (gate, beacon) in gates.iter().zip(&beacons) {
            assert!((880.0..=1000.0).contains(&gate.position.distance(beacon.position)));
            assert!(gate.arrival.distance(beacon.position) >= 250.0);
            let radius = Vector::new(1.0, 1.0);
            assert!(
                generator
                    .generate_nav_beacons(
                        123,
                        beacon.position - radius,
                        beacon.position + radius,
                        &gates
                    )
                    .contains(beacon)
            );
        }
        let position = Vector::new(5000.0, 5000.0);
        let seed = named_seed(sector.seed, "nav-beacon:arrival-test");
        let angle = SeededRandom::new(f64::from(seed)).next_float() * 2.0 * PI;
        let arrival = position + Vector::new(angle.cos() * 1100.0, angle.sin() * 1100.0);
        let gate = SectorConnectionSite {
            id: "arrival-test".to_owned(),
            position,
            arrival,
            radius: 0.0,
        };
        let clear = generator.generate_nav_beacons(
            123,
            Vector::new(3900.0, 3900.0),
            Vector::new(6100.0, 6100.0),
            &[gate],
        );
        assert!(clear[0].position.distance(arrival) >= 250.0);
    }
}
