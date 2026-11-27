use std::cmp::{Ordering, Reverse};
use std::collections::HashSet;
use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

use crate::specs::{Catalog, SectorGeneration};
use crate::utilities::round_ties_up;
use crate::utilities::seeded_random::SeededRandom;
use crate::utilities::sin_cos::sin_cos;
use crate::utilities::vector::Vector;

use super::mix;

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectorConnectionSite {
    pub id: String,
    pub position: Vector,
    pub arrival: Vector,
    pub radius: f64,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sector {
    pub id: String,
    pub name: String,
    pub seed: u32,
    pub map_position: Vector,
    pub radius_x: f64,
    pub radius_y: f64,
    pub rotation: f64,
    pub gate_sites: Vec<SectorConnectionSite>,
    pub wormhole_sites: Vec<SectorConnectionSite>,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectorLink {
    pub id: String,
    pub sectors: [String; 2],
    pub sites: [usize; 2],
    pub rotation: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectorMap {
    pub sectors: Vec<Sector>,
    pub links: Vec<SectorLink>,
    pub wormhole_links: Vec<SectorLink>,
    pub enabled: Vec<String>,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum LinkKind {
    Gate,
    Wormhole,
}

impl LinkKind {
    const ALL: [Self; 2] = [Self::Gate, Self::Wormhole];

    fn name(self) -> &'static str {
        match self {
            Self::Gate => "gate",
            Self::Wormhole => "wormhole",
        }
    }

    fn sites(self, sector: &Sector) -> &[SectorConnectionSite] {
        match self {
            Self::Gate => &sector.gate_sites,
            Self::Wormhole => &sector.wormhole_sites,
        }
    }

    fn sites_mut(self, sector: &mut Sector) -> &mut Vec<SectorConnectionSite> {
        match self {
            Self::Gate => &mut sector.gate_sites,
            Self::Wormhole => &mut sector.wormhole_sites,
        }
    }
}

pub(super) fn named_seed(seed: u32, name: &str) -> u32 {
    let mut hash = 0x811c9dc5_u32;
    for character in name.chars() {
        hash = (hash ^ u32::from(character)).wrapping_mul(0x01000193);
    }
    mix(seed ^ hash)
}

fn connection_site(
    sector: &Sector,
    index: usize,
    kind: LinkKind,
    spec: &SectorGeneration,
) -> SectorConnectionSite {
    let (offset, radius, minimum, spread) = match kind {
        LinkKind::Gate => (
            0,
            spec.gate_radius,
            spec.gate_distance,
            spec.gate_distance_range,
        ),
        LinkKind::Wormhole => (
            1,
            spec.wormhole_radius,
            spec.wormhole_distance,
            spec.wormhole_distance_range,
        ),
    };
    let name = kind.name();
    let mut random = SeededRandom::new(f64::from(named_seed(
        sector.seed,
        &format!("{name}:{index}"),
    )));
    let rotation = SeededRandom::new(f64::from(named_seed(sector.seed, "connections")))
        .next_float()
        * PI
        * 2.0;
    let (sin, cos) = sin_cos(sector.rotation);
    let (axis_sin, axis_cos) =
        sin_cos(rotation + ([0, 2, 1, 3][index] * 2 + offset) as f64 * PI / 4.0);
    let x = axis_cos * sector.radius_x;
    let y = axis_sin * sector.radius_y;
    let axis_length = (x * x + y * y).sqrt();
    let maximum = (minimum + spread).min(spec.max_connection_distance / axis_length);
    let inner = minimum.min(maximum);
    let sample = random.next_float();
    let distance = match kind {
        LinkKind::Gate => inner + sample * (maximum - inner),
        LinkKind::Wormhole => (inner * inner + sample * (maximum * maximum - inner * inner)).sqrt(),
    };
    let position = Vector::new(
        round_ties_up((x * cos - y * sin) * distance),
        round_ties_up((x * sin + y * cos) * distance),
    );
    let arrival_scale = 1.0 - spec.gate_arrival_distance / position.length();
    let arrival = Vector::new(
        round_ties_up(position.x * arrival_scale),
        round_ties_up(position.y * arrival_scale),
    );
    SectorConnectionSite {
        id: format!("{}:{name}:{index}", sector.id),
        position,
        arrival,
        radius,
    }
}

pub fn generate_sector(world_seed: u32, name: &str, spec: &SectorGeneration) -> Sector {
    let id = name.to_lowercase();
    let seed = named_seed(world_seed, &id);
    let mut random = SeededRandom::new(f64::from(seed));
    let size = random.next_float();
    let radius_x = round_ties_up(
        spec.cruise_speed * 60.0 * (spec.crossing_minutes + size * spec.crossing_minutes_range)
            / 2.0,
    );
    let radius_y = round_ties_up(
        radius_x * (spec.aspect_ratio + random.next_float() * spec.aspect_ratio_range),
    );
    let rotation = round_ties_up(random.next_float() * 360.0) * PI / 180.0;
    let mut map_random = SeededRandom::new(f64::from(named_seed(seed, "map")));
    let (map_sin, map_cos) = sin_cos(map_random.next_float() * PI * 2.0);
    let map_radius = map_random.next_float().sqrt();
    let map_position = Vector::new(
        round_ties_up(map_radius * map_cos * spec.map_radius_x),
        round_ties_up(map_radius * map_sin * spec.map_radius_y),
    );
    let mut counts_random = SeededRandom::new(f64::from(named_seed(seed, "connection-counts")));
    let count_range = 2.0 + size * (spec.max_connections as f64 - 1.0);
    let mut counts = [0; 2];
    for count in &mut counts {
        *count = (counts_random.next_float() * count_range).floor() as usize;
    }
    if counts == [0, 0] {
        counts[usize::from(counts_random.next_float() >= 0.5)] = 1;
    }
    let mut sector = Sector {
        id,
        name: name.to_owned(),
        seed,
        map_position,
        radius_x,
        radius_y,
        rotation,
        gate_sites: Vec::new(),
        wormhole_sites: Vec::new(),
    };
    for (kind, count) in LinkKind::ALL.into_iter().zip(counts) {
        *kind.sites_mut(&mut sector) = (0..count)
            .map(|index| connection_site(&sector, index, kind, spec))
            .collect();
    }
    sector
}

#[derive(Debug)]
pub enum SectorMapError {
    DuplicateSector(String),
    MissingGraphAnchor,
    InsufficientConnectionCapacity,
}

impl std::fmt::Display for SectorMapError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DuplicateSector(id) => write!(formatter, "duplicate sector ID {id}"),
            Self::MissingGraphAnchor => formatter.write_str("missing graph anchor"),
            Self::InsufficientConnectionCapacity => {
                formatter.write_str("the sector catalog needs more connection capacity")
            }
        }
    }
}

impl std::error::Error for SectorMapError {}

struct MapBuilder<'a> {
    seed: u32,
    spec: &'a SectorGeneration,
    map: SectorMap,
    connected: Vec<usize>,
    degrees: Vec<[usize; 2]>,
    pairs: [HashSet<(usize, usize)>; 2],
}

impl MapBuilder<'_> {
    fn sector(&self, index: usize) -> &Sector {
        &self.map.sectors[index]
    }

    fn remaining(&self, index: usize, kind: LinkKind) -> usize {
        kind.sites(self.sector(index)).len() - self.degrees[index][kind as usize]
    }

    fn free_sites(&self) -> usize {
        self.connected
            .iter()
            .map(|&index| {
                self.remaining(index, LinkKind::Gate) + self.remaining(index, LinkKind::Wormhole)
            })
            .sum()
    }

    fn link_id(&self, a: usize, b: usize) -> String {
        let [a, b] = [self.sector(a).id.as_str(), self.sector(b).id.as_str()];
        format!("{}/{}", a.min(b), a.max(b))
    }

    fn connect(&mut self, a: usize, b: usize, kind: LinkKind) {
        let id = self.link_id(a, b);
        let rotation =
            SeededRandom::new(f64::from(named_seed(self.seed, &id))).next_float() * PI * 2.0;
        let degrees = kind as usize;
        let link = SectorLink {
            id,
            sectors: [self.sector(a).id.clone(), self.sector(b).id.clone()],
            sites: [self.degrees[a][degrees], self.degrees[b][degrees]],
            rotation,
        };
        match kind {
            LinkKind::Gate => self.map.links.push(link),
            LinkKind::Wormhole => self.map.wormhole_links.push(link),
        }
        self.degrees[a][degrees] += 1;
        self.degrees[b][degrees] += 1;
        self.pairs[degrees].insert((a.min(b), a.max(b)));
    }

    fn distance_order(&self, origin: usize, a: usize, b: usize) -> Ordering {
        let position = self.sector(origin).map_position;
        let distance_a = position.distance_squared(self.sector(a).map_position);
        let distance_b = position.distance_squared(self.sector(b).map_position);
        distance_a
            .partial_cmp(&distance_b)
            .unwrap_or(Ordering::Equal)
    }

    fn find_connection(&self, entry: usize) -> Option<(usize, LinkKind)> {
        LinkKind::ALL.into_iter().find_map(|kind| {
            if kind.sites(self.sector(entry)).is_empty() {
                return None;
            }
            self.connected
                .iter()
                .copied()
                .filter(|&candidate| self.remaining(candidate, kind) > 0)
                .min_by(|&a, &b| {
                    self.distance_order(entry, a, b)
                        .then_with(|| self.sector(a).id.cmp(&self.sector(b).id))
                })
                .map(|other| (other, kind))
        })
    }

    fn fill_sites(&mut self, kind: LinkKind, reserve: usize) {
        let mut free: usize = self
            .connected
            .iter()
            .map(|&entry| self.remaining(entry, kind))
            .sum();
        let mut available = Vec::with_capacity(self.connected.len());
        while free >= reserve + 2 {
            let priority = |index| {
                let capacity = kind.sites(self.sector(index)).len();
                let needed = capacity
                    .min(3)
                    .saturating_sub(self.degrees[index][kind as usize]);
                Reverse((needed, self.remaining(index, kind)))
            };
            available.clear();
            available.extend(
                self.connected
                    .iter()
                    .copied()
                    .filter(|&index| self.remaining(index, kind) > 0),
            );
            available
                .sort_unstable_by_key(|&index| (priority(index), self.sector(index).id.as_str()));
            let partner = |a: usize, b: usize| {
                a != b && !self.pairs[kind as usize].contains(&(a.min(b), a.max(b)))
            };
            let choice = available.iter().copied().find_map(|a| {
                available
                    .iter()
                    .copied()
                    .filter(|&b| partner(a, b))
                    .min_by(|&b, &c| {
                        priority(b)
                            .cmp(&priority(c))
                            .then_with(|| self.distance_order(a, b, c))
                            .then_with(|| self.sector(b).id.cmp(&self.sector(c).id))
                    })
                    .map(|b| (a, b))
            });
            let Some((a, b)) = choice else { break };
            self.connect(a, b, kind);
            free -= 2;
        }
    }

    fn bridge(&self, pending: &[usize], expandable: &[usize]) -> Option<Bridge> {
        let capacity = |index| {
            let spec = self.spec;
            let size = (self.sector(index).radius_x * 2.0 / spec.cruise_speed / 60.0
                - spec.crossing_minutes)
                / spec.crossing_minutes_range;
            spec.max_connections
                .min((2.0 + size * (spec.max_connections as f64 - 1.0)).floor() as usize)
        };
        let mut best: Option<Bridge> = None;
        for kind in LinkKind::ALL {
            for &a in &self.connected {
                let count_a = kind.sites(self.sector(a)).len();
                let add_a = usize::from(self.remaining(a, kind) == 0);
                if (add_a == 1 && !expandable.contains(&a)) || count_a + add_a > capacity(a) {
                    continue;
                }
                for &b in pending {
                    let count_b = kind.sites(self.sector(b)).len();
                    let add_b = usize::from(count_b == 0);
                    if count_b + add_b > capacity(b) {
                        continue;
                    }
                    let radius = self.sector(a).radius_x + self.sector(b).radius_x;
                    let id = format!("{}/{}Sites", self.link_id(a, b), kind.name());
                    let candidate = Bridge {
                        a,
                        b,
                        kind,
                        add_a,
                        add_b,
                        radius,
                        id,
                    };
                    if best
                        .as_ref()
                        .is_none_or(|best| candidate.order(best).is_lt())
                    {
                        best = Some(candidate);
                    }
                }
            }
        }
        best
    }

    fn add_site(&mut self, index: usize, kind: LinkKind) {
        let sector = &mut self.map.sectors[index];
        let site = connection_site(sector, kind.sites(sector).len(), kind, self.spec);
        kind.sites_mut(sector).push(site);
    }
}

struct Bridge {
    a: usize,
    b: usize,
    kind: LinkKind,
    add_a: usize,
    add_b: usize,
    radius: f64,
    id: String,
}

impl Bridge {
    fn order(&self, other: &Self) -> Ordering {
        (self.add_a + self.add_b)
            .cmp(&(other.add_a + other.add_b))
            .then_with(|| {
                other
                    .radius
                    .partial_cmp(&self.radius)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| self.id.cmp(&other.id))
    }
}

pub fn generate_sector_map(
    world_seed: u32,
    catalog: &Catalog,
) -> Result<SectorMap, SectorMapError> {
    let spec = &catalog.sector_generation;
    let sectors: Vec<_> = catalog
        .sector_names
        .iter()
        .map(|name| generate_sector(world_seed, name, spec))
        .collect();
    let mut ids = HashSet::with_capacity(sectors.len());
    for sector in &sectors {
        if !ids.insert(sector.id.as_str()) {
            return Err(SectorMapError::DuplicateSector(sector.id.clone()));
        }
    }
    let anchor = sectors
        .iter()
        .position(|sector| sector.id == spec.graph_anchor)
        .ok_or(SectorMapError::MissingGraphAnchor)?;
    let ordered: Vec<_> = std::iter::once(anchor)
        .chain((0..sectors.len()).filter(|&index| index != anchor))
        .collect();
    let mut builder = MapBuilder {
        seed: world_seed,
        spec,
        degrees: vec![[0; 2]; sectors.len()],
        pairs: Default::default(),
        connected: vec![anchor],
        map: SectorMap {
            sectors,
            ..SectorMap::default()
        },
    };
    let mut start = 1;
    while start < ordered.len() {
        let end = spec
            .graph_stages
            .iter()
            .copied()
            .find(|&limit| limit > start)
            .map_or(start + 1, |limit| ordered.len().min(limit));
        let mut pending = ordered[start..end].to_vec();
        let expandable = &ordered[if start == 1 { 0 } else { start }..end];
        while !pending.is_empty() {
            let free = builder.free_sites();
            let connection = pending
                .iter()
                .copied()
                .enumerate()
                .find_map(|(index, entry)| {
                    let sector = builder.sector(entry);
                    if free > 1
                        || sector.gate_sites.len() + sector.wormhole_sites.len() > 1
                        || pending.len() == 1
                    {
                        builder
                            .find_connection(entry)
                            .map(|(other, kind)| (index, other, kind))
                    } else {
                        None
                    }
                });
            if let Some((index, other, kind)) = connection {
                let entry = pending.remove(index);
                builder.connect(other, entry, kind);
                builder.connected.push(entry);
            } else {
                let bridge = builder
                    .bridge(&pending, expandable)
                    .ok_or(SectorMapError::InsufficientConnectionCapacity)?;
                if bridge.add_a > 0 {
                    builder.add_site(bridge.a, bridge.kind);
                }
                if bridge.add_b > 0 {
                    builder.add_site(bridge.b, bridge.kind);
                }
                builder.connect(bridge.a, bridge.b, bridge.kind);
                builder.connected.push(bridge.b);
                pending.retain(|&index| index != bridge.b);
            }
        }
        builder.fill_sites(LinkKind::Gate, spec.spare_gate_sites);
        builder.fill_sites(LinkKind::Wormhole, spec.spare_wormhole_sites);
        start = end;
    }
    builder.map.enabled = builder
        .connected
        .iter()
        .take(spec.enabled_count.max(1))
        .map(|&index| builder.sector(index).id.clone())
        .collect();
    Ok(builder.map)
}

pub fn sector_density(
    sector: &Sector,
    position: Vector,
    kind: usize,
    spec: &SectorGeneration,
) -> f64 {
    let falloff = spec.density[kind];
    let (sin, cos) = sin_cos(sector.rotation);
    let x = (position.x * cos + position.y * sin) / (sector.radius_x * falloff.scale);
    let y = (-position.x * sin + position.y * cos) / (sector.radius_y * falloff.scale);
    let distance = x * x + y * y;
    let edge = if falloff.cutoff == 0.0 {
        0.0
    } else {
        (-(falloff.cutoff * falloff.cutoff)).exp2()
    };
    let density = ((-distance).exp2() - edge) / (1.0 - edge);
    round_ties_up((falloff.floor + (falloff.peak - falloff.floor) * density.max(0.0)) * 1e9) / 1e9
}
