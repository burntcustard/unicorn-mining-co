use hashbrown::{HashMap, HashSet};

use crate::protocol::{AsteroidDescription, StationDescription, WorldRanges, WreckDescription};
use crate::specs::Catalog;
use crate::utilities::OrderedMap;
use crate::utilities::vector::Vector;

use super::game_object::GameObject;
use super::region_generation::NavBeaconDescription;
use super::region_manager::{RegionManager, RegionView};
use super::sector_generation::{Sector, SectorConnectionSite};

const MIN_SPATIAL_SLEEPERS: usize = 64;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct SleepingCell {
    station: bool,
    x: i64,
    y: i64,
}

impl SleepingCell {
    fn at(position: Vector, size: f64, station: bool) -> Option<Self> {
        if !size.is_finite() {
            return None;
        }
        let x = position.x / size;
        let y = position.y / size;
        let precise_limit = (1_u64 << 52) as f64;
        (x.abs() < precise_limit && y.abs() < precise_limit).then_some(Self {
            station,
            x: x.floor() as i64,
            y: y.floor() as i64,
        })
    }
}

struct SleepingEntity<Entity> {
    entity: Entity,
    cell: Option<SleepingCell>,
}

pub enum GeneratedEntity<'a> {
    Asteroid(&'a AsteroidDescription),
    Station(&'a StationDescription),
    Wreck(&'a WreckDescription),
    Beacon(NavBeaconDescription),
}

/// Stream existing objects without recreating their mutable gameplay state.
pub trait StreamingWorld {
    type Entity;

    fn entities(&self) -> impl Iterator<Item = &Self::Entity>;
    fn base(entity: &Self::Entity) -> &GameObject;
    fn bounded_observers(&self) -> impl Iterator<Item = (Vector, f64)>;
    fn contains(&self, id: i64) -> bool;
    fn wake(&mut self, entity: Self::Entity);
    fn sleep(&mut self, id: i64) -> Option<Self::Entity>;
    fn spawn_generated(&mut self, id: i64, description: GeneratedEntity<'_>) -> bool;
}

pub struct StreamingRegions<Entity> {
    pub procedural: RegionManager,
    pub gate_sites: Vec<SectorConnectionSite>,
    pub id_offset: i64,
    managed: OrderedMap<i64, ()>,
    sleeping: OrderedMap<i64, SleepingEntity<Entity>>,
    sleeping_cells: HashMap<Option<SleepingCell>, HashSet<i64>>,
    queried_cells: HashSet<SleepingCell>,
    wake_order: Vec<(usize, i64)>,
    wanted: HashSet<i64>,
    ids: Vec<i64>,
    views: Vec<RegionView>,
    positions: Vec<Vector>,
    limits: Vec<f64>,
    ranges: WorldRanges,
    world_ranges: WorldRanges,
}

impl<Entity> StreamingRegions<Entity> {
    pub fn new(seed: u32, catalog: &Catalog, sector: Option<&Sector>) -> Self {
        let mut procedural = RegionManager::new(seed, catalog, sector);
        if sector.is_none() {
            procedural.pre_generate(catalog.simulation.pre_generated_radius);
        }
        Self {
            procedural,
            gate_sites: Vec::new(),
            id_offset: 0,
            managed: OrderedMap::default(),
            sleeping: OrderedMap::default(),
            sleeping_cells: HashMap::new(),
            queried_cells: HashSet::new(),
            wake_order: Vec::new(),
            wanted: HashSet::new(),
            ids: Vec::new(),
            views: Vec::new(),
            positions: Vec::new(),
            limits: Vec::new(),
            ranges: WorldRanges::from_values(&catalog.simulation.server_region_ranges),
            world_ranges: WorldRanges::from_values(&catalog.simulation.world_ranges),
        }
    }

    pub fn removed(&mut self, id: i64) {
        if self.managed.remove(&id).is_some() {
            self.procedural.remove((id - self.id_offset) as u32);
        }
    }

    pub fn restore_removal(&mut self, id: i64) {
        self.procedural.remove((id - self.id_offset) as u32);
    }

    pub(crate) fn restore_sleeping<W: StreamingWorld<Entity = Entity>>(
        &mut self,
        id: i64,
        entity: Entity,
        generated: bool,
    ) {
        if generated {
            self.managed.set(id, ());
        }
        self.store_sleeping::<W>(id, entity);
    }

    pub(crate) fn sleeping(&self, id: i64) -> Option<&Entity> {
        self.sleeping.get(&id).map(|stored| &stored.entity)
    }

    pub(crate) fn sleeping_entities(&self) -> impl Iterator<Item = &Entity> {
        self.sleeping.values().map(|stored| &stored.entity)
    }

    fn reach(&self, station: bool) -> f64 {
        if station {
            self.ranges.station_physics
        } else {
            self.ranges.asteroid
        }
    }

    fn nearby(&self, object: &GameObject) -> bool {
        let reach = self.reach(object.kind == "station");
        self.positions.iter().enumerate().any(|(index, &position)| {
            let range = self.limited_reach(reach, index);
            object.position.distance_squared(position) <= range * range
        })
    }

    fn limited_reach(&self, reach: f64, index: usize) -> f64 {
        self.limits
            .get(index)
            .copied()
            .filter(|&limit| limit > 0.0)
            .map_or(reach, |limit| reach.min(limit))
    }

    fn store_sleeping<W: StreamingWorld<Entity = Entity>>(&mut self, id: i64, entity: Entity) {
        let object = W::base(&entity);
        let station = object.kind == "station";
        let cell = SleepingCell::at(object.position, self.reach(station).max(1.0), station);
        if let Some(previous) = self.sleeping.get(&id)
            && previous.cell != cell
        {
            self.remove_sleeping_cell(id, previous.cell);
        }
        self.sleeping.set(id, SleepingEntity { entity, cell });
        self.sleeping_cells.entry(cell).or_default().insert(id);
    }

    fn take_sleeping(&mut self, id: i64) -> Option<Entity> {
        let stored = self.sleeping.remove(&id)?;
        self.remove_sleeping_cell(id, stored.cell);
        Some(stored.entity)
    }

    fn remove_sleeping_cell(&mut self, id: i64, cell: Option<SleepingCell>) {
        let bucket = self.sleeping_cells.get_mut(&cell).expect("indexed sleeper");
        bucket.remove(&id);
        if bucket.is_empty() {
            self.sleeping_cells.remove(&cell);
        }
    }

    fn collect_sleeping_cells(&mut self) -> bool {
        self.queried_cells.clear();
        for (index, &position) in self.positions.iter().enumerate() {
            for station in [false, true] {
                let reach = self.reach(station);
                let range = self.limited_reach(reach, index);
                let squared = range * range;
                if !squared.is_finite() || range < 0.0 {
                    return false;
                }
                // Round out across the squared distance, subtraction, and
                // endpoint arithmetic before narrowing to candidate cells.
                let extent = squared.next_up().sqrt().next_up().next_up();
                let size = reach.max(1.0);
                let from = Vector::new(
                    (position.x - extent).next_down(),
                    (position.y - extent).next_down(),
                );
                let to = Vector::new(
                    (position.x + extent).next_up(),
                    (position.y + extent).next_up(),
                );
                let (Some(from), Some(to)) = (
                    SleepingCell::at(from, size, station),
                    SleepingCell::at(to, size, station),
                ) else {
                    return false;
                };
                if to.x - from.x > 4 || to.y - from.y > 4 {
                    return false;
                }
                for x in from.x..=to.x {
                    for y in from.y..=to.y {
                        self.queried_cells.insert(SleepingCell { station, x, y });
                    }
                }
            }
        }
        true
    }

    fn collect_wake_ids<W: StreamingWorld<Entity = Entity>>(&mut self, ids: &mut Vec<i64>) {
        if self.positions.is_empty() {
            return;
        }
        if self.sleeping.len() < MIN_SPATIAL_SLEEPERS || !self.collect_sleeping_cells() {
            ids.extend(
                self.sleeping
                    .iter()
                    .filter(|(_, stored)| self.nearby(W::base(&stored.entity)))
                    .map(|(&id, _)| id),
            );
            return;
        }
        let mut wake_order = std::mem::take(&mut self.wake_order);
        let candidates = self
            .queried_cells
            .iter()
            .filter_map(|&cell| self.sleeping_cells.get(&Some(cell)))
            .chain(self.sleeping_cells.get(&None))
            .flatten();
        wake_order.extend(candidates.filter_map(|&id| {
            let (slot, stored) = self.sleeping.get_indexed(&id)?;
            self.nearby(W::base(&stored.entity)).then_some((slot, id))
        }));
        wake_order.sort_unstable();
        ids.extend(wake_order.drain(..).map(|(_, id)| id));
        self.wake_order = wake_order;
    }

    pub fn sync<W: StreamingWorld<Entity = Entity>>(
        &mut self,
        world: &mut W,
        positions: &[Vector],
    ) {
        self.positions.clear();
        self.positions.extend_from_slice(positions);
        self.limits.clear();
        self.limits.resize(positions.len(), 0.0);
        for (position, range) in world.bounded_observers() {
            self.positions.push(position);
            self.limits.push(range);
        }

        let mut ids = std::mem::take(&mut self.ids);
        self.collect_wake_ids::<W>(&mut ids);
        for id in ids.drain(..) {
            if let Some(entity) = self.take_sleeping(id) {
                world.wake(entity);
            }
        }
        ids.extend(world.entities().filter_map(|entity| {
            let object = W::base(entity);
            (!self.managed.contains_key(&object.id)
                && object.player_number.is_none()
                && !matches!(object.kind.as_str(), "jumpGate" | "wormhole")
                && !self.nearby(object))
            .then_some(object.id)
        }));
        for id in ids.drain(..) {
            if let Some(entity) = world.sleep(id) {
                self.store_sleeping::<W>(id, entity);
            }
        }

        self.procedural.query_many_into(
            &mut self.views,
            &self.positions,
            Some(self.ranges),
            &self.limits,
        );
        self.wanted.clear();
        let views = std::mem::take(&mut self.views);
        for view in &views {
            for asteroid in &view.asteroids {
                self.want(world, asteroid.id, GeneratedEntity::Asteroid(asteroid));
            }
            for station in &view.stations {
                self.want(world, station.id, GeneratedEntity::Station(station));
            }
            for wreck in &view.wrecks {
                self.want(world, wreck.id, GeneratedEntity::Wreck(wreck));
            }
        }
        self.views = views;

        for index in 0..self.positions.len() {
            let position = self.positions[index];
            let reach = self.limited_reach(self.ranges.asteroid, index);
            let extent = Vector::new(reach, reach);
            for beacon in
                self.procedural
                    .nav_beacons(position - extent, position + extent, &self.gate_sites)
            {
                if position.distance_squared(beacon.position) <= reach * reach {
                    self.want(world, beacon.id, GeneratedEntity::Beacon(beacon));
                }
            }
        }

        ids.extend(
            self.managed
                .iter()
                .filter(|(id, _)| !self.wanted.contains(*id))
                .map(|(&id, _)| id),
        );
        for id in ids.drain(..) {
            if let Some(entity) = world.sleep(id) {
                self.store_sleeping::<W>(id, entity);
            }
        }
        self.ids = ids;
    }

    fn want(
        &mut self,
        world: &mut impl StreamingWorld<Entity = Entity>,
        id: u32,
        generated: GeneratedEntity<'_>,
    ) {
        let entity_id = self.id_offset + i64::from(id);
        if !self.wanted.insert(entity_id)
            || world.contains(entity_id)
            || self.sleeping.contains_key(&entity_id)
        {
            return;
        }
        if self.managed.remove(&entity_id).is_some() {
            self.procedural.remove(id);
            return;
        }
        if world.spawn_generated(entity_id, generated) {
            self.managed.set(entity_id, ());
        }
    }

    pub fn nearest_station(&mut self, position: Vector) -> Option<StationDescription> {
        let mut reach = self.world_ranges.station_marker;
        let mut markers = self.procedural.station_markers(position, reach);
        while markers.is_empty() && reach > 0.0 && reach < 200_000.0 {
            reach *= 2.0;
            markers = self.procedural.station_markers(position, reach);
        }
        let mut closest = None;
        let mut best = f64::INFINITY;
        for marker in &markers {
            let distance = position.distance_squared(marker.position);
            if distance < best {
                best = distance;
                closest = Some((**marker).clone());
            }
        }
        closest
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::simulation::game_object::ObjectProperties;
    use crate::simulation::world::{EntityKind, World};

    use super::*;

    #[test]
    fn removed_generated_wreck_does_not_respawn() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let mut world = World::new(25.0, Arc::clone(&catalog));
        let mut regions = StreamingRegions::new(25, &catalog, None);
        let wreck = WreckDescription {
            id: 42,
            cargo_contents: vec![0],
            ..WreckDescription::default()
        };

        regions.want(&mut world, wreck.id, GeneratedEntity::Wreck(&wreck));
        let id = i64::from(wreck.id);
        assert!(world.remove_entity(id).is_some());
        regions.wanted.clear();
        regions.want(&mut world, wreck.id, GeneratedEntity::Wreck(&wreck));

        assert!(world.entity(id).is_none());
        assert!(!regions.managed.contains_key(&id));
    }

    #[test]
    fn spatial_wake_preserves_insertion_order_and_exact_range_boundaries() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let mut world = World::new(25.0, Arc::clone(&catalog));
        let mut regions = StreamingRegions::new(25, &catalog, None);
        regions.ranges.asteroid = 4.0;
        regions.ranges.station_physics = 10.0;
        regions.positions = vec![Vector::new(-4.0, 0.0), Vector::new(100.0, 0.0)];
        regions.limits = vec![0.0, 2.0];

        let mut restore = |id, x, station| {
            let mut object = GameObject::new(
                id,
                ObjectProperties {
                    position: Vector::new(x, 0.0),
                    ..ObjectProperties::default()
                },
                &catalog.simulation,
            );
            if station {
                object.kind = "station".to_owned();
            }
            let entity = world.make_entity(EntityKind::Object(Box::new(object)), false);
            regions.restore_sleeping::<World>(id, entity, false);
        };
        restore(40, 0.0, false);
        restore(5, 6.0, true);
        restore(30, (-8.0_f64).next_down(), false);
        restore(2, -8.0, false);
        restore(11, 98.0, false);
        restore(19, 103.0, true);
        for id in 100..500 {
            restore(id, 1000.0 + id as f64, false);
        }
        for id in 100..430 {
            assert!(regions.take_sleeping(id).is_some());
        }

        assert!(regions.sleeping.len() >= MIN_SPATIAL_SLEEPERS);
        assert!(regions.collect_sleeping_cells());
        let mut found = Vec::new();
        regions.collect_wake_ids::<World>(&mut found);
        assert_eq!(found, [40, 5, 2, 11]);

        let entity = regions.take_sleeping(40).expect("boundary sleeper");
        regions.store_sleeping::<World>(40, entity);
        found.clear();
        regions.collect_wake_ids::<World>(&mut found);
        assert_eq!(found, [5, 2, 11, 40]);

        regions.positions.push(Vector::new(f64::NAN, 0.0));
        assert!(!regions.collect_sleeping_cells());
        found.clear();
        regions.collect_wake_ids::<World>(&mut found);
        assert_eq!(found, [5, 2, 11, 40]);
    }
}
