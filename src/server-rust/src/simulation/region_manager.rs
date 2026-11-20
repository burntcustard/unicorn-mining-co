use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use hashbrown::{HashMap, HashSet, hash_map::Entry};

use crate::protocol::{
    AsteroidDescription, MapMarker, StationDescription, WorldRanges, WreckDescription,
};
use crate::specs::Catalog;
use crate::utilities::OrderedMap;
use crate::vector::Vector;

use super::regions::{NavBeaconDescription, RegionGenerator, region_seed};
use super::sectors::{Sector, SectorConnectionSite};

const MAX_STATION_LISTS: usize = 64;
const COLD_DESCRIPTIONS_PER_SECTOR: usize = 512;
// Keep several players' exploration routes warm when they return through a sector.
const MAX_COLD_DESCRIPTIONS: usize = 2048;
const EXTRA_COLD_DESCRIPTIONS: usize = 16_384;

type RegionIndex = (i64, i64);
type Stations = Vec<Arc<StationDescription>>;

pub(crate) struct ColdRegionBudget {
    available: AtomicUsize,
}

impl Default for ColdRegionBudget {
    fn default() -> Self {
        Self {
            available: AtomicUsize::new(EXTRA_COLD_DESCRIPTIONS),
        }
    }
}

impl ColdRegionBudget {
    fn reserve(&self) -> bool {
        self.available
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |available| {
                available.checked_sub(1)
            })
            .is_ok()
    }

    fn release(&self, count: usize) {
        self.available.fetch_add(count, Ordering::Relaxed);
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct RegionBounds {
    from: RegionIndex,
    to: RegionIndex,
}

impl RegionBounds {
    fn new(position: Vector, reach: f64, size: f64) -> Self {
        let extent = Vector::new(reach, reach);
        Self {
            from: index_at(position - extent, size),
            to: index_at(position + extent, size),
        }
    }

    fn indices(self) -> impl Iterator<Item = RegionIndex> {
        (self.from.0..=self.to.0).flat_map(move |x| (self.from.1..=self.to.1).map(move |y| (x, y)))
    }
}

fn index_at(position: Vector, size: f64) -> RegionIndex {
    (
        (position.x / size).floor() as i64,
        (position.y / size).floor() as i64,
    )
}

fn coordinates((x, y): RegionIndex) -> Vector {
    Vector::new(x as f64, y as f64)
}

#[derive(Default)]
pub struct RegionView {
    pub asteroids: Vec<Arc<AsteroidDescription>>,
    pub station_markers: Stations,
    pub stations: Stations,
    pub wrecks: Vec<Arc<WreckDescription>>,
}

fn update_view<'a, T: 'a>(view: &mut Vec<Arc<T>>, visible: impl Iterator<Item = &'a Arc<T>>) {
    let mut length = 0;
    for value in visible {
        if let Some(previous) = view.get_mut(length) {
            if !Arc::ptr_eq(previous, value) {
                *previous = Arc::clone(value);
            }
        } else {
            view.push(Arc::clone(value));
        }
        length += 1;
    }
    view.truncate(length);
}

/// Loaded and saved regions share immutable descriptions with retained views.
pub struct ManagedRegion {
    pub seed: u32,
    pub asteroids: Vec<Arc<AsteroidDescription>>,
    pub stations: Stations,
    pub wrecks: Vec<Arc<WreckDescription>>,
}

#[derive(Default)]
struct QueriedRegions {
    bounds: Vec<RegionBounds>,
    marker_bounds: Vec<RegionBounds>,
    views: Vec<RegionView>,
}

pub struct RegionManager {
    world_seed: u32,
    region_size: f64,
    map_station_extent: Option<f64>,
    generator: RegionGenerator,
    default_ranges: WorldRanges,
    loaded: HashSet<RegionIndex>,
    next_loaded: HashSet<RegionIndex>,
    pre_generated: HashSet<RegionIndex>,
    cold_descriptions: OrderedMap<RegionIndex, ()>,
    cold_budget: Option<Arc<ColdRegionBudget>>,
    descriptions: HashMap<RegionIndex, ManagedRegion>,
    description_owners: HashMap<u32, Vec<RegionIndex>>,
    removed: HashSet<u32>,
    map_stations: Option<Vec<MapMarker>>,
    station_lists: HashMap<RegionBounds, Arc<[Arc<StationDescription>]>>,
    query_bounds: Vec<RegionBounds>,
    marker_bounds: Vec<RegionBounds>,
    queried: Option<QueriedRegions>,
}

impl RegionManager {
    pub fn new(world_seed: u32, catalog: &Catalog, sector: Option<&Sector>) -> Self {
        Self {
            world_seed,
            region_size: catalog.simulation.region_size,
            map_station_extent: sector.map(|sector| {
                let density = catalog.sector_generation.density[1];
                sector.radius_x.max(sector.radius_y) * density.scale * density.cutoff + 1.0
            }),
            generator: RegionGenerator::new(catalog, sector),
            default_ranges: WorldRanges::from_values(&catalog.simulation.world_ranges),
            loaded: HashSet::new(),
            next_loaded: HashSet::new(),
            pre_generated: HashSet::new(),
            cold_descriptions: OrderedMap::default(),
            cold_budget: None,
            descriptions: HashMap::new(),
            description_owners: HashMap::new(),
            removed: HashSet::new(),
            map_stations: None,
            station_lists: HashMap::new(),
            query_bounds: Vec::new(),
            marker_bounds: Vec::new(),
            queried: None,
        }
    }

    pub(crate) fn share_cold_budget(&mut self, budget: Arc<ColdRegionBudget>) {
        assert!(self.cold_descriptions.is_empty());
        self.cold_budget = Some(budget);
    }

    pub fn map_stations(&mut self) -> &[MapMarker] {
        self.map_stations.get_or_insert_with(|| {
            let Some(extent) = self.map_station_extent else {
                return Vec::new();
            };
            let bound = Vector::new(extent, extent);
            self.generator
                .generate_stations(self.world_seed, -bound, bound)
                .into_iter()
                .filter(|station| !self.removed.contains(&station.id))
                .map(|station| MapMarker {
                    kind: "station".to_owned(),
                    id: i64::from(station.id),
                    position: station.position,
                    definition_id: station.definition_id,
                    ..MapMarker::default()
                })
                .collect()
        })
    }

    pub fn pre_generate(&mut self, radius: f64) {
        let size = self.region_size;
        let reach = (radius / size).ceil() as i64;
        for x in -reach..reach {
            for y in -reach..reach {
                let nx = x.max(0).max(-x - 1) as f64 * size;
                let ny = y.max(0).max(-y - 1) as f64 * size;
                let index = (x, y);
                if nx * nx + ny * ny < radius * radius && self.pre_generated.insert(index) {
                    self.remove_cold(index);
                    self.description(index);
                }
            }
        }
    }

    fn description(&mut self, index: RegionIndex) -> &ManagedRegion {
        self.descriptions.entry(index).or_insert_with(|| {
            let region = coordinates(index);
            let description = self.generator.generate_region(self.world_seed, region);
            let mut register = |id| {
                if self.removed.contains(&id) {
                    return false;
                }
                let owners = self.description_owners.entry(id).or_default();
                if owners.last() != Some(&index) {
                    owners.push(index);
                }
                true
            };
            ManagedRegion {
                seed: region_seed(self.world_seed, region),
                asteroids: description
                    .asteroids
                    .into_iter()
                    .filter(|value| register(value.id))
                    .map(Arc::new)
                    .collect(),
                stations: description
                    .stations
                    .into_iter()
                    .filter(|value| register(value.id))
                    .map(Arc::new)
                    .collect(),
                wrecks: description
                    .wrecks
                    .into_iter()
                    .filter(|value| register(value.id))
                    .map(Arc::new)
                    .collect(),
            }
        })
    }

    pub fn load(&mut self, index: RegionIndex) -> &ManagedRegion {
        if self.loaded.insert(index) {
            self.remove_cold(index);
            self.queried = None;
        }
        self.description(index)
    }

    pub fn unload(&mut self, index: RegionIndex) {
        if self.loaded.remove(&index) {
            self.queried = None;
            self.keep_cold(index);
        }
    }

    fn keep_cold(&mut self, index: RegionIndex) {
        if self.pre_generated.contains(&index) {
            return;
        }
        let cold = self.cold_descriptions.len();
        // An eviction replaces a resident description without growing the cache.
        if cold >= MAX_COLD_DESCRIPTIONS
            || cold >= COLD_DESCRIPTIONS_PER_SECTOR
                && self
                    .cold_budget
                    .as_ref()
                    .is_some_and(|budget| !budget.reserve())
        {
            self.evict_cold();
        }
        self.cold_descriptions.set(index, ());
    }

    fn remove_cold(&mut self, index: RegionIndex) {
        let extra = self.cold_descriptions.len() > COLD_DESCRIPTIONS_PER_SECTOR;
        if self.cold_descriptions.remove(&index).is_some()
            && extra
            && let Some(budget) = &self.cold_budget
        {
            budget.release(1);
        }
    }

    fn evict_cold(&mut self) {
        let oldest = *self.cold_descriptions.iter().next().unwrap().0;
        self.cold_descriptions.remove(&oldest);
        let region = self.descriptions.remove(&oldest).unwrap();
        let ids = region
            .asteroids
            .iter()
            .map(|value| value.id)
            .chain(region.stations.iter().map(|value| value.id))
            .chain(region.wrecks.iter().map(|value| value.id));
        for id in ids {
            if let Entry::Occupied(mut entry) = self.description_owners.entry(id) {
                entry.get_mut().retain(|&owner| owner != oldest);
                if entry.get().is_empty() {
                    entry.remove();
                }
            }
        }
    }

    pub fn remove(&mut self, id: u32) {
        self.removed.insert(id);
        self.queried = None;
        self.station_lists.clear();
        if let Some(stations) = &mut self.map_stations {
            stations.retain(|station| station.id != i64::from(id));
        }
        for index in self.description_owners.remove(&id).into_iter().flatten() {
            if let Some(region) = self.descriptions.get_mut(&index) {
                region.asteroids.retain(|value| value.id != id);
                region.stations.retain(|value| value.id != id);
                region.wrecks.retain(|value| value.id != id);
            }
        }
    }

    pub fn nav_beacons(
        &mut self,
        from: Vector,
        to: Vector,
        gates: &[SectorConnectionSite],
    ) -> Vec<NavBeaconDescription> {
        let mut beacons = self
            .generator
            .generate_nav_beacons(self.world_seed, from, to, gates);
        beacons.retain(|beacon| !self.removed.contains(&beacon.id));
        beacons
    }

    fn station_list(&mut self, bounds: RegionBounds) -> Arc<[Arc<StationDescription>]> {
        if let Some(cached) = self.station_lists.get(&bounds) {
            return Arc::clone(cached);
        }
        let mut stations = Vec::new();
        for index in bounds.indices() {
            if let Some(description) = self.descriptions.get(&index) {
                stations.extend(description.stations.iter().cloned());
            } else {
                let from = coordinates(index) * self.region_size;
                let to = (coordinates(index) + Vector::new(1.0, 1.0)) * self.region_size;
                stations.extend(
                    self.generator
                        .generate_stations(self.world_seed, from, to)
                        .into_iter()
                        .filter(|station| !self.removed.contains(&station.id))
                        .map(Arc::new),
                );
            }
        }
        if self.station_lists.len() >= MAX_STATION_LISTS {
            self.station_lists.clear();
        }
        let stations: Arc<[_]> = stations.into();
        self.station_lists.insert(bounds, Arc::clone(&stations));
        stations
    }

    pub(crate) fn station_markers(&mut self, position: Vector, reach: f64) -> Stations {
        let bounds = RegionBounds::new(position, reach, self.region_size);
        let reach_squared = reach.powi(2);
        self.station_list(bounds)
            .iter()
            .filter(|station| station.position.distance_squared(position) <= reach_squared)
            .cloned()
            .collect()
    }

    fn refresh_query(&mut self) {
        let mut previous = std::mem::take(&mut self.loaded);
        let mut needed = std::mem::take(&mut self.next_loaded);
        let mut queried = self.queried.take().unwrap_or_default();
        queried
            .views
            .resize_with(self.query_bounds.len(), RegionView::default);
        for (index, view) in queried.views.iter_mut().enumerate() {
            view.asteroids.clear();
            view.wrecks.clear();
            let bounds = self.query_bounds[index];
            for region in bounds.indices() {
                if needed.insert(region) && !previous.remove(&region) {
                    self.remove_cold(region);
                }
                let description = self.description(region);
                view.asteroids.extend(description.asteroids.iter().cloned());
                view.wrecks.extend(description.wrecks.iter().cloned());
            }
        }
        self.loaded = needed;
        for region in previous.drain() {
            self.keep_cold(region);
        }
        self.next_loaded = previous;
        for (index, view) in queried.views.iter_mut().enumerate() {
            view.stations.clear();
            view.stations
                .extend(self.station_list(self.marker_bounds[index]).iter().cloned());
        }
        queried.bounds.clone_from(&self.query_bounds);
        queried.marker_bounds.clone_from(&self.marker_bounds);
        self.queried = Some(queried);
    }

    pub fn query(&mut self, position: Vector, ranges: Option<WorldRanges>) -> RegionView {
        let mut views = self.query_many(std::slice::from_ref(&position), ranges, &[]);
        views.pop().unwrap_or_default()
    }

    pub fn query_many(
        &mut self,
        positions: &[Vector],
        ranges: Option<WorldRanges>,
        limits: &[f64],
    ) -> Vec<RegionView> {
        let mut views = Vec::new();
        self.query_many_into(&mut views, positions, ranges, limits);
        views
    }

    /// Reuse each observer's result buffers when its range and region bounds are unchanged.
    pub fn query_many_into(
        &mut self,
        result: &mut Vec<RegionView>,
        positions: &[Vector],
        ranges: Option<WorldRanges>,
        limits: &[f64],
    ) {
        fn range_limit(limits: &[f64], index: usize) -> f64 {
            limits
                .get(index)
                .copied()
                .filter(|&limit| limit > 0.0)
                .unwrap_or(f64::INFINITY)
        }
        let ranges = ranges.unwrap_or(self.default_ranges);
        let reach = ranges.asteroid.max(ranges.wreck);
        let station_reach = ranges.station_marker.max(ranges.station_physics);
        self.query_bounds.clear();
        self.marker_bounds.clear();
        for (index, &position) in positions.iter().enumerate() {
            let limit = range_limit(limits, index);
            self.query_bounds.push(RegionBounds::new(
                position,
                reach.min(limit),
                self.region_size,
            ));
            self.marker_bounds.push(RegionBounds::new(
                position,
                station_reach.min(limit),
                self.region_size,
            ));
        }
        if self.queried.as_ref().is_none_or(|cached| {
            cached.bounds != self.query_bounds || cached.marker_bounds != self.marker_bounds
        }) {
            self.refresh_query();
        }
        let Some(cached) = &self.queried else { return };
        result.resize_with(positions.len(), RegionView::default);
        for (index, ((view, candidates), &position)) in result
            .iter_mut()
            .zip(&cached.views)
            .zip(positions)
            .enumerate()
        {
            let limit = range_limit(limits, index);
            let asteroid = ranges.asteroid.min(limit).powi(2);
            let wreck = ranges.wreck.min(limit).powi(2);
            let marker = ranges.station_marker.min(limit).powi(2);
            let physics = ranges.station_physics.min(limit).powi(2);
            update_view(
                &mut view.asteroids,
                candidates
                    .asteroids
                    .iter()
                    .filter(|value| value.position.distance_squared(position) <= asteroid),
            );
            update_view(
                &mut view.wrecks,
                candidates
                    .wrecks
                    .iter()
                    .filter(|value| value.position.distance_squared(position) <= wreck),
            );
            update_view(
                &mut view.station_markers,
                candidates
                    .stations
                    .iter()
                    .filter(|value| value.position.distance_squared(position) <= marker),
            );
            update_view(
                &mut view.stations,
                candidates
                    .stations
                    .iter()
                    .filter(|value| value.position.distance_squared(position) <= physics),
            );
        }
    }
}

impl Drop for RegionManager {
    fn drop(&mut self) {
        let extra = self
            .cold_descriptions
            .len()
            .saturating_sub(COLD_DESCRIPTIONS_PER_SECTOR);
        if extra > 0
            && let Some(budget) = &self.cold_budget
        {
            budget.release(extra);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cold_regions_share_extra_capacity_across_sectors() {
        let catalog = Catalog::load().unwrap();
        let budget = Arc::new(ColdRegionBudget {
            available: AtomicUsize::new(1),
        });
        let mut first = RegionManager::new(25, &catalog, None);
        let mut second = RegionManager::new(31, &catalog, None);
        first.share_cold_budget(Arc::clone(&budget));
        second.share_cold_budget(Arc::clone(&budget));
        for manager in [&mut first, &mut second] {
            for step in 0..=COLD_DESCRIPTIONS_PER_SECTOR {
                let index = (step as i64, 20);
                manager.load(index);
                manager.unload(index);
            }
        }

        assert_eq!(
            first.cold_descriptions.len(),
            COLD_DESCRIPTIONS_PER_SECTOR + 1
        );
        assert_eq!(second.cold_descriptions.len(), COLD_DESCRIPTIONS_PER_SECTOR);

        first.load((0, 20));
        second.load((-1, 20));
        second.unload((-1, 20));
        assert_eq!(
            second.cold_descriptions.len(),
            COLD_DESCRIPTIONS_PER_SECTOR + 1
        );
        drop(second);
        assert_eq!(budget.available.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn stable_bounds_reuse_result_storage_and_retain_earlier_views() {
        let catalog = Catalog::load().unwrap();
        let mut manager = RegionManager::new(25, &catalog, None);
        let mut views = manager.query_many(
            &[Vector::ZERO, Vector::new(3200.0, 1500.0)],
            None,
            &[0.0, 900.0],
        );
        let setup = Arc::clone(&views[0].asteroids[0]);
        let previous = manager.query(Vector::ZERO, None);
        assert!(Arc::ptr_eq(&setup, &previous.asteroids[0]));
        let storage = views[0].asteroids.as_ptr();
        let positions = [Vector::ZERO, Vector::new(3200.0, 1500.0)];
        manager.query_many_into(&mut views, &positions, None, &[0.0, 900.0]);
        manager.query_many_into(&mut views, &positions, None, &[0.0, 900.0]);
        assert_eq!(views[0].asteroids.as_ptr(), storage);
        manager.remove(setup.id);
        manager.query_many_into(&mut views, &positions, None, &[0.0, 900.0]);
        assert!(views[0].asteroids.iter().all(|value| value.id != setup.id));
        assert!(Arc::ptr_eq(&setup, &previous.asteroids[0]));
    }

    #[test]
    fn station_marker_cache_survives_loads_and_invalidates_removal() {
        let catalog = Catalog::load().unwrap();
        let mut manager = RegionManager::new(25, &catalog, None);
        let before = manager.query(Vector::ZERO, None).station_markers;
        let cache = manager.station_lists.len();
        manager.load((-20, -20));
        assert_eq!(manager.station_lists.len(), cache);
        assert_eq!(manager.query(Vector::ZERO, None).station_markers, before);
        let removed = before[0].id;
        manager.remove(removed);
        let after = manager.query(Vector::ZERO, None).station_markers;
        assert!(after.iter().all(|marker| marker.id != removed));
    }

    #[test]
    fn cold_region_eviction_preserves_warm_views_order_and_tombstones() {
        let catalog = Catalog::load().unwrap();
        let mut manager = RegionManager::new(25, &catalog, None);
        manager.pre_generate(1.0);
        let ranges = WorldRanges {
            asteroid: 6000.0,
            ..manager.default_ranges
        };
        let mut before = manager.query(Vector::ZERO, Some(ranges));
        let original_regions = manager.loaded.clone();
        let asteroid = before
            .asteroids
            .iter()
            .find(|asteroid| {
                !manager
                    .pre_generated
                    .contains(&index_at(asteroid.position, manager.region_size))
            })
            .unwrap()
            .clone();
        let station = before.station_markers[0].id;

        let far_position = |step| Vector::new(70_500.0 + f64::from(step) * 2_000.0, 500.0);
        manager.query(far_position(0), Some(WorldRanges::default()));
        let revisited = manager.query(Vector::ZERO, Some(ranges));
        assert!(
            revisited
                .asteroids
                .iter()
                .any(|value| Arc::ptr_eq(value, &asteroid))
        );
        for step in 0..=MAX_COLD_DESCRIPTIONS as i32 {
            manager.query(far_position(step), Some(WorldRanges::default()));
        }

        assert_eq!(manager.cold_descriptions.len(), MAX_COLD_DESCRIPTIONS);
        for index in original_regions {
            assert_eq!(
                manager.descriptions.contains_key(&index),
                manager.pre_generated.contains(&index)
            );
        }
        assert!(!manager.description_owners.contains_key(&asteroid.id));
        let active = manager.loaded.clone();
        assert_eq!(
            manager.station_markers(Vector::ZERO, ranges.station_marker),
            before.station_markers
        );
        assert_eq!(manager.loaded, active);

        manager.remove(asteroid.id);
        manager.remove(station);
        before.asteroids.retain(|value| value.id != asteroid.id);
        before.station_markers.retain(|value| value.id != station);
        before.stations.retain(|value| value.id != station);
        let after = manager.query(Vector::ZERO, Some(ranges));
        assert_eq!(after.asteroids, before.asteroids);
        assert_eq!(after.station_markers, before.station_markers);
        assert_eq!(after.stations, before.stations);
        assert_eq!(after.wrecks, before.wrecks);
    }
}
