use hashbrown::HashMap;

use crate::protocol::AsteroidSplice;
use crate::specs::Simulation;
use crate::utilities::vector::Vector;

use super::cadence::Cadence;

const CELL_SIZE: f64 = 3000.0;
const SPATIAL_MASK_CAPACITY: usize = 128;
const NO_MEMBER: usize = usize::MAX;
#[derive(Clone, Copy, Debug)]
pub struct ReplicatedEntity {
    pub source_index: usize,
    pub id: i64,
    pub position: Vector,
    pub station: bool,
    pub asteroid: bool,
    pub ballistic: bool,
    pub dead: bool,
    pub buried: bool,
}

type Cell = (i64, i64);
type CellBounds = (Cell, Cell);

fn cell(position: Vector) -> Cell {
    (
        (position.x / CELL_SIZE).floor() as i64,
        (position.y / CELL_SIZE).floor() as i64,
    )
}

fn bounded(position: Vector) -> bool {
    position.x.abs() <= 1e12 && position.y.abs() <= 1e12
}

#[derive(Default)]
pub struct ReplicationView {
    entities: Vec<ReplicatedEntity>,
    #[cfg(target_arch = "x86_64")]
    simd: SimdView,
    epoch: u64,
    indexed_epoch: Option<u64>,
    spatial_prepared: bool,
    spatial_usable: bool,
    spatial_cells: HashMap<Cell, Vec<usize>>,
    spatial_pool: Vec<Vec<usize>>,
    spatial_keys: Vec<Option<Cell>>,
    spatial_mask_slots: HashMap<CellBounds, usize>,
    spatial_masks: Vec<Vec<u64>>,
    stations: Vec<usize>,
    cadence: Option<Cadence>,
    indices: HashMap<i64, usize>,
}

#[cfg(target_arch = "x86_64")]
#[derive(Default)]
struct SimdView {
    unload_squared: Vec<f64>,
    x: Vec<f64>,
    y: Vec<f64>,
    ranges: Option<[u64; 2]>,
}

#[cfg(target_arch = "x86_64")]
impl SimdView {
    fn prepare(&mut self, entities: &[ReplicatedEntity], unload_squared: [f64; 2]) {
        let ranges = unload_squared.map(f64::to_bits);
        if self.ranges == Some(ranges) {
            return;
        }
        self.unload_squared.clear();
        self.x.clear();
        self.y.clear();
        for entity in entities {
            self.unload_squared
                .push(unload_squared[usize::from(entity.station)]);
            self.x.push(entity.position.x);
            self.y.push(entity.position.y);
        }
        self.ranges = Some(ranges);
    }
}

impl ReplicationView {
    /// Reuse one view for all observers in a sector. The entity epoch changes
    /// when membership or iteration order changes.
    pub fn prepare(
        &mut self,
        entities: impl IntoIterator<Item = ReplicatedEntity>,
        entity_epoch: u64,
    ) {
        self.entities.clear();
        self.entities.extend(entities);
        if self.indices.is_empty() || self.epoch != entity_epoch {
            self.indices.clear();
            self.indices.extend(
                self.entities
                    .iter()
                    .enumerate()
                    .map(|(index, entity)| (entity.id, index)),
            );
        }
        self.epoch = entity_epoch;
        self.spatial_prepared = false;
        #[cfg(target_arch = "x86_64")]
        {
            self.simd.ranges = None;
        }
    }

    fn prepare_spatial(&mut self) -> bool {
        if self.spatial_prepared {
            return self.spatial_usable;
        }
        self.spatial_prepared = true;
        if self.indexed_epoch.replace(self.epoch) != Some(self.epoch) {
            self.spatial_usable = false;
            return false;
        }
        let mut unchanged = self.spatial_usable && self.spatial_keys.len() == self.entities.len();
        self.spatial_keys.resize(self.entities.len(), None);
        self.spatial_usable = false;
        for (index, entity) in self.entities.iter().enumerate() {
            if !bounded(entity.position) {
                return false;
            }
            let key = (!entity.station).then(|| cell(entity.position));
            unchanged &= self.spatial_keys[index] == key;
            self.spatial_keys[index] = key;
        }
        if !unchanged {
            self.spatial_mask_slots.clear();
            self.stations.clear();
            for (_, mut bucket) in self.spatial_cells.drain() {
                bucket.clear();
                self.spatial_pool.push(bucket);
            }
            for (index, key) in self.spatial_keys.iter().copied().enumerate() {
                if let Some(key) = key {
                    self.spatial_cells
                        .entry(key)
                        .or_insert_with(|| self.spatial_pool.pop().unwrap_or_default())
                        .push(index);
                } else {
                    self.stations.push(index);
                }
            }
        }
        self.spatial_usable = true;
        true
    }

    fn spatial_candidates(&mut self, position: Vector, reach: f64) -> Option<usize> {
        if !(0.0..=CELL_SIZE * 4.0).contains(&reach)
            || !bounded(position)
            || !self.prepare_spatial()
        {
            return None;
        }
        let from = cell(Vector::new(
            (position.x - reach).next_down(),
            (position.y - reach).next_down(),
        ));
        let to = cell(Vector::new(
            (position.x + reach).next_up(),
            (position.y + reach).next_up(),
        ));
        let bounds = (from, to);
        if let Some(slot) = self.spatial_mask_slots.get(&bounds) {
            return Some(*slot);
        }
        // The same rectangle is often queried for many ticks. Share its
        // candidate mask until an entity changes cells or the view changes.
        if self.spatial_mask_slots.len() >= SPATIAL_MASK_CAPACITY {
            self.spatial_mask_slots.clear();
        }
        let slot = self.spatial_mask_slots.len();
        if slot == self.spatial_masks.len() {
            self.spatial_masks.push(Vec::new());
        }
        let selected = &mut self.spatial_masks[slot];
        selected.clear();
        selected.resize(self.entities.len().div_ceil(64), 0);
        let mut select = |index: usize| selected[index / 64] |= 1 << (index % 64);
        for x in from.0..=to.0 {
            for y in from.1..=to.1 {
                if let Some(bucket) = self.spatial_cells.get(&(x, y)) {
                    for &index in bucket {
                        select(index);
                    }
                }
            }
        }
        for &index in &self.stations {
            select(index);
        }
        self.spatial_mask_slots.insert(bounds, slot);
        Some(slot)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SelectedEntity {
    pub index: usize,
    pub(super) member: usize,
    pub loaded: bool,
    pub update: bool,
}

pub struct Selection<'a> {
    pub entities: &'a [SelectedEntity],
    pub(super) view: &'a [ReplicatedEntity],
    pub membership_changed: bool,
    pub removed_entity_ids: &'a [u64],
    pub asteroid_positions: Option<&'a [Vector]>,
    pub asteroid_splice: Option<AsteroidSplice<'a>>,
    pub(super) member_capacity: usize,
}

pub struct SelectOptions<'a> {
    pub tick: u64,
    pub load: bool,
    pub players: usize,
    pub position: Vector,
    pub owned: i64,
    pub force_update: &'a [i64],
}

pub struct ObserverSelection {
    snapshot_tick: u64,
    stamp: u64,
    members: HashMap<i64, usize>,
    member_stamps: Vec<u64>,
    snapshot_deltas: bool,
    removed_entity_ids: Vec<u64>,
    free_members: Vec<usize>,
    cache_epoch: Option<u64>,
    index_cache: Vec<usize>,
    selected: Vec<SelectedEntity>,
    asteroid_tick: u64,
    asteroid_positions: Vec<Vector>,
    asteroid_buffer: Vec<Vector>,
    use_avx2: bool,
}

impl ObserverSelection {
    pub fn new(allow_simd: bool) -> Self {
        #[cfg(target_arch = "x86_64")]
        let use_avx2 = allow_simd && std::is_x86_feature_detected!("avx2");
        #[cfg(not(target_arch = "x86_64"))]
        let use_avx2 = {
            let _ = allow_simd;
            false
        };
        Self {
            snapshot_tick: 0,
            stamp: 0,
            members: HashMap::new(),
            member_stamps: Vec::new(),
            snapshot_deltas: false,
            removed_entity_ids: Vec::new(),
            free_members: Vec::new(),
            cache_epoch: None,
            index_cache: Vec::new(),
            selected: Vec::new(),
            asteroid_tick: 0,
            asteroid_positions: Vec::new(),
            asteroid_buffer: Vec::new(),
            use_avx2,
        }
    }

    pub fn set_snapshot_deltas(&mut self, enabled: bool) {
        self.snapshot_deltas = enabled;
    }

    pub fn select<'a>(
        &'a mut self,
        view: &'a mut ReplicationView,
        rules: &Simulation,
        options: SelectOptions<'_>,
    ) -> Selection<'a> {
        if options.load {
            self.members.clear();
            self.member_stamps.clear();
            self.free_members.clear();
        }
        self.removed_entity_ids.clear();
        let previous_size = self.members.len();
        let count = view.entities.len();
        self.selected.clear();
        let previous_epoch = self.cache_epoch.replace(view.epoch);
        let use_cache =
            !options.load && previous_epoch == Some(view.epoch) && self.index_cache.len() == count;
        let owned_index = view.indices.get(&options.owned).copied();
        let position = owned_index.map_or(options.position, |index| view.entities[index].position);
        let range = rules.replication;
        let entity_unload = range.entity_unload * range.entity_unload;
        let marker_unload = range.marker_unload * range.marker_unload;
        let maximum_unload = [
            entity_unload,
            if entity_unload.is_nan() || marker_unload.is_nan() {
                f64::INFINITY
            } else {
                entity_unload.max(marker_unload)
            },
        ];
        let reach_squared = [
            [range.entity_load * range.entity_load, entity_unload],
            [range.marker_load * range.marker_load, marker_unload],
        ];
        let sparse = options.players >= 8 && previous_size.saturating_mul(4) < count;
        let spatial = if sparse && count >= 512 {
            view.spatial_candidates(position, range.entity_unload)
        } else {
            None
        };
        // Keep the scalar scan when most entities were already in range.
        #[cfg(target_arch = "x86_64")]
        let simd_end = if options.players >= 8
            && previous_size < count - count / 8
            && self.use_avx2
            && spatial.is_none()
            && count >= 16
        {
            view.simd.prepare(&view.entities, maximum_unload);
            count & !15
        } else {
            0
        };
        let visible_interval = rules.update_tiers["visible"].replicate_every;
        let distant_interval = rules.update_tiers["distant"].replicate_every;
        let ballistics = rules.ballistic_replicate_every;
        let cadence = view
            .cadence
            .filter(|cached| {
                cached.tick == options.tick
                    && cached.previous == self.snapshot_tick
                    && cached.intervals == [distant_interval, visible_interval]
                    && cached.ballistic == ballistics
            })
            .unwrap_or_else(|| {
                Cadence::new(
                    options.tick,
                    self.snapshot_tick,
                    visible_interval,
                    distant_interval,
                    ballistics,
                )
            });
        if view
            .cadence
            .is_none_or(|cached| cached.tick != options.tick)
        {
            view.cadence = Some(cadence);
        }
        let visible_squared = rules.visible_range * rules.visible_range;
        let mut retained = 0;

        let mut accept = |index: usize, distance: f64| {
            let entity = &view.entities[index];
            let station = entity.station;
            let station_index = usize::from(station);
            let owned = Some(index) == owned_index;
            if distance > maximum_unload[station_index] && !owned {
                return;
            }
            let previous = if use_cache {
                self.index_cache[index]
            } else {
                self.members.get(&entity.id).copied().unwrap_or(NO_MEMBER)
            };
            let loaded = previous != NO_MEMBER;
            let reach = reach_squared[station_index][usize::from(loaded)];
            if !owned
                && distance
                    .partial_cmp(&reach)
                    .is_none_or(|order| order.is_gt())
            {
                return;
            }
            retained += usize::from(loaded);
            let member = if loaded {
                previous
            } else {
                let member = self.free_members.pop().unwrap_or_else(|| {
                    self.member_stamps.push(0);
                    self.member_stamps.len() - 1
                });
                self.members.insert(entity.id, member);
                member
            };
            let update = !loaded
                || options.force_update.contains(&entity.id)
                || cadence.due(
                    entity.id,
                    entity.ballistic && (entity.asteroid || station),
                    distance <= visible_squared,
                );
            self.selected.push(SelectedEntity {
                index,
                member,
                loaded,
                update,
            });
        };
        let distance = |index: usize| {
            let object = view.entities[index].position;
            let dx = object.x - position.x;
            let dy = object.y - position.y;
            dx * dx + dy * dy
        };
        if let Some(slot) = spatial {
            for (block, mut mask) in view.spatial_masks[slot].iter().copied().enumerate() {
                if let Some(index) = owned_index
                    && index / 64 == block
                {
                    mask |= 1 << (index % 64);
                }
                while mask != 0 {
                    let index = block * 64 + mask.trailing_zeros() as usize;
                    mask &= mask - 1;
                    accept(index, distance(index));
                }
            }
        } else {
            #[cfg(not(target_arch = "x86_64"))]
            let simd_end = 0;
            #[cfg(target_arch = "x86_64")]
            for base in (0..simd_end).step_by(16) {
                let mut distances = [0.0; 16];
                // SAFETY: the CPU capability was checked at construction,
                // and the loop only visits complete, in-bounds blocks.
                let mut mask = unsafe { accepted_avx2(&view.simd, base, position, &mut distances) };
                if let Some(index) = owned_index {
                    let offset = index.wrapping_sub(base);
                    if offset < 16 {
                        mask |= 1 << offset;
                    }
                }
                while mask != 0 {
                    let offset = mask.trailing_zeros() as usize;
                    mask &= mask - 1;
                    accept(base + offset, distances[offset]);
                }
            }
            for index in simd_end..count {
                accept(index, distance(index));
            }
        }
        let membership_changed = retained != previous_size || self.selected.len() != retained;
        if previous_size != retained {
            self.stamp = self.stamp.wrapping_add(1);
            for entry in &self.selected {
                self.member_stamps[entry.member] = self.stamp;
            }
            self.members.retain(|&id, member| {
                if self.member_stamps[*member] == self.stamp {
                    return true;
                }
                if self.snapshot_deltas {
                    self.removed_entity_ids.push(id as u64);
                }
                self.free_members.push(*member);
                false
            });
            self.removed_entity_ids.sort_unstable();
        }
        if !use_cache || membership_changed {
            // Spatial and SIMD filters may skip a previously selected index.
            self.index_cache.clear();
            self.index_cache.resize(count, NO_MEMBER);
            for entry in &self.selected {
                self.index_cache[entry.index] = entry.member;
            }
        }
        self.snapshot_tick = options.tick;

        let mut asteroid_positions = None;
        let mut asteroid_splice = None;
        if options.load || options.tick.wrapping_sub(self.asteroid_tick) >= ballistics.max(1) as u64
        {
            let radar = rules.server_region_ranges["asteroid"];
            self.asteroid_tick = options.tick;
            self.asteroid_buffer.clear();
            let radar_squared = radar * radar;
            let radar_slot = spatial.and_then(|_| view.spatial_candidates(position, radar));
            let visible = |entity: &ReplicatedEntity| {
                entity.asteroid
                    && !entity.dead
                    && !entity.buried
                    && entity.position.distance_squared(position) <= radar_squared
            };
            if let Some(slot) = radar_slot {
                for (block, mut mask) in view.spatial_masks[slot].iter().copied().enumerate() {
                    while mask != 0 {
                        let index = block * 64 + mask.trailing_zeros() as usize;
                        mask &= mask - 1;
                        let entity = &view.entities[index];
                        if visible(entity) {
                            self.asteroid_buffer.push(entity.position);
                        }
                    }
                }
            } else {
                self.asteroid_buffer.extend(
                    view.entities
                        .iter()
                        .filter(|entity| visible(entity))
                        .map(|entity| entity.position),
                );
            }
            if options.load || self.asteroid_buffer != self.asteroid_positions {
                std::mem::swap(&mut self.asteroid_buffer, &mut self.asteroid_positions);
                if self.snapshot_deltas && !options.load {
                    asteroid_splice =
                        asteroid_splice_between(&self.asteroid_buffer, &self.asteroid_positions);
                }
                if asteroid_splice.is_none() {
                    asteroid_positions = Some(&self.asteroid_positions[..]);
                }
            }
        }
        Selection {
            entities: &self.selected,
            view: &view.entities,
            membership_changed: membership_changed && !self.snapshot_deltas,
            removed_entity_ids: &self.removed_entity_ids,
            asteroid_positions,
            asteroid_splice,
            member_capacity: self.member_stamps.len(),
        }
    }
}

fn asteroid_splice_between<'a>(
    previous: &[Vector],
    positions: &'a [Vector],
) -> Option<AsteroidSplice<'a>> {
    let same = |&(left, right): &(&Vector, &Vector)| {
        left.x.to_bits() == right.x.to_bits() && left.y.to_bits() == right.y.to_bits()
    };
    let prefix = previous.iter().zip(positions).take_while(same).count();
    let suffix = previous[prefix..]
        .iter()
        .rev()
        .zip(positions[prefix..].iter().rev())
        .take_while(same)
        .count();
    let delete_count = previous.len() - prefix - suffix;
    let count = positions.len() - prefix - suffix;
    let varint_size =
        |value: usize| (usize::BITS - value.leading_zeros()).max(1).div_ceil(7) as usize;
    let packed =
        1 + varint_size(prefix) + varint_size(delete_count) + varint_size(count) + 16 * count;
    let full = varint_size(positions.len()) + 16 * positions.len();
    (packed < full).then(|| AsteroidSplice {
        start: prefix,
        delete_count,
        positions: &positions[prefix..prefix + count],
    })
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn accepted_avx2(
    view: &SimdView,
    base: usize,
    position: Vector,
    distances: &mut [f64; 16],
) -> u16 {
    use std::arch::x86_64::*;
    let px = _mm256_set1_pd(position.x);
    let py = _mm256_set1_pd(position.y);
    let mut rejected = 0;
    for offset in [0, 4, 8, 12] {
        let index = base + offset;
        // SAFETY: the checked caller provides 16 valid entries from every
        // packed view slice and a 16-element output. Unaligned loads are used.
        let (dx, dy, reach) = unsafe {
            (
                _mm256_sub_pd(_mm256_loadu_pd(view.x.as_ptr().add(index)), px),
                _mm256_sub_pd(_mm256_loadu_pd(view.y.as_ptr().add(index)), py),
                _mm256_loadu_pd(view.unload_squared.as_ptr().add(index)),
            )
        };
        let distance = _mm256_add_pd(_mm256_mul_pd(dx, dx), _mm256_mul_pd(dy, dy));
        // SAFETY: offset is a multiple of four and at most 12.
        unsafe { _mm256_storeu_pd(distances.as_mut_ptr().add(offset), distance) };
        let far = _mm256_cmp_pd::<_CMP_GT_OQ>(distance, reach);
        rejected |= (_mm256_movemask_pd(far) as u16) << offset;
    }
    _mm256_zeroupper();
    !rejected
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::specs::Catalog;

    fn entity(id: i64, x: f64) -> ReplicatedEntity {
        ReplicatedEntity {
            source_index: id as usize,
            id,
            position: Vector::new(x, 0.0),
            station: false,
            asteroid: true,
            ballistic: true,
            dead: false,
            buried: false,
        }
    }

    #[test]
    fn spatial_and_simd_paths_match_dense_selection_and_cadence() {
        let rules = Catalog::load().unwrap().simulation;
        let mut dense_view = ReplicationView::default();
        let mut sparse_view = ReplicationView::default();
        let mut dense = ObserverSelection::new(false);
        let mut sparse = ObserverSelection::new(true);
        let mut entities: Vec<_> = (1..=650)
            .map(|id| {
                let mut object = entity(id, (id - 330) as f64 * 234.0);
                object.station = id % 23 == 0;
                object.asteroid = !object.station;
                object
            })
            .collect();
        entities[4].position.x = f64::NAN;
        let options = |tick, players| SelectOptions {
            tick,
            players,
            load: tick == 0,
            owned: 325,
            position: Vector::ZERO,
            force_update: &[326, 332],
        };
        for tick in 0..140 {
            let epoch = if tick < 70 { 1 } else { 2 };
            if tick == 35 {
                entities[4].position.x = 25_000.0;
            }
            if tick == 70 {
                entities.swap(325, 324);
            }
            entities
                .iter_mut()
                .skip(5)
                .for_each(|entity| entity.position.x += 53.9);
            dense_view.prepare(entities.iter().copied(), epoch);
            sparse_view.prepare(entities.iter().copied(), epoch);
            let a = dense.select(&mut dense_view, &rules, options(tick, 4));
            let b = sparse.select(&mut sparse_view, &rules, options(tick, 16));
            let wire_selection = |(entry, view): (&SelectedEntity, &[ReplicatedEntity])| {
                (
                    entry.index,
                    view[entry.index].id,
                    entry.loaded,
                    entry.update,
                )
            };
            assert!(
                a.entities
                    .iter()
                    .map(|entry| wire_selection((entry, a.view)))
                    .eq(b
                        .entities
                        .iter()
                        .map(|entry| wire_selection((entry, b.view)))),
                "tick {tick}"
            );
            assert_eq!(a.membership_changed, b.membership_changed, "tick {tick}");
            assert_eq!(a.asteroid_positions, b.asteroid_positions, "tick {tick}");
        }
    }

    #[test]
    fn radar_covers_cells_outside_the_entity_unload_range() {
        let rules = Catalog::load().unwrap().simulation;
        let mut view = ReplicationView::default();
        let mut observer = ObserverSelection::new(true);
        let mut entities = vec![entity(1, -20.0), entity(2, 3100.0)];
        entities.extend((3..=520).map(|id| entity(id, 15_000.0 + id as f64)));
        let options = |tick, load| SelectOptions {
            tick,
            load,
            players: 32,
            position: Vector::ZERO,
            owned: 1,
            force_update: &[],
        };
        view.prepare(entities.iter().copied(), 1);
        observer.select(&mut view, &rules, options(0, true));

        // This asteroid stays outside the entity query and inside the radar query.
        entities[1].position.x = 3250.0;
        view.prepare(entities.iter().copied(), 1);
        let selection = observer.select(&mut view, &rules, options(8, false));
        assert!(
            selection
                .entities
                .iter()
                .all(|entry| selection.view[entry.index].id != 2)
        );
        assert_eq!(
            selection.asteroid_positions.unwrap(),
            &[entities[0].position, entities[1].position]
        );
    }

    #[test]
    fn membership_hysteresis_owned_overrides_and_radar_clears() {
        let rules = Catalog::load().unwrap().simulation;
        let range = rules.replication;
        let mut view = ReplicationView::default();
        let mut observer = ObserverSelection::new(true);
        let options = |tick, load| SelectOptions {
            tick,
            load,
            players: 1,
            position: Vector::ZERO,
            owned: 1,
            force_update: &[],
        };
        let ship = ReplicatedEntity {
            asteroid: false,
            ..entity(1, 0.0)
        };
        view.prepare([ship, entity(2, range.entity_load)], 1);
        let initial = observer.select(&mut view, &rules, options(0, true));
        assert_eq!(
            initial
                .entities
                .iter()
                .map(|value| initial.view[value.index].id)
                .collect::<Vec<_>>(),
            [1, 2]
        );
        assert!(initial.membership_changed);
        view.prepare([ship, entity(2, range.entity_unload)], 1);
        assert_eq!(
            observer
                .select(&mut view, &rules, options(1, false))
                .entities
                .len(),
            2
        );
        view.prepare([ship, entity(2, range.entity_unload + 1.0)], 1);
        assert_eq!(
            observer
                .select(&mut view, &rules, options(2, false))
                .entities
                .len(),
            1
        );
        view.prepare([ship], 2);
        let load = observer.select(&mut view, &rules, options(3, true));
        assert_eq!(load.entities.len(), 1);
        assert_eq!(load.asteroid_positions, Some([].as_slice()));
    }
}
