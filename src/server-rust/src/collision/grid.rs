//! Deterministic body-grouped broad phase and swept proxy bounds.

use std::hash::Hash;

use hashbrown::HashMap;

use crate::vector::Vector;

use super::Aabb;

const CELL_SIZE: f64 = 256.0;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ProxyId(u64);

impl ProxyId {
    pub fn get(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SpatialProxy<T, O> {
    pub id: ProxyId,
    pub user_data: T,
    pub owner: Option<O>,
    pub aabb: Aabb,
    group: u64,
}

struct SpatialGroup {
    nodes: Vec<ProxyId>,
    cells: Vec<i32>,
    bounds: Aabb,
    query_stamp: u64,
    dirty: bool,
}

impl Default for SpatialGroup {
    fn default() -> Self {
        Self {
            nodes: Vec::new(),
            cells: Vec::new(),
            bounds: Aabb::EMPTY,
            query_stamp: 0,
            dirty: false,
        }
    }
}

pub struct SpatialGrid<T, O> {
    proxies: HashMap<ProxyId, SpatialProxy<T, O>>,
    owner_groups: HashMap<Option<O>, u64>,
    groups: HashMap<u64, SpatialGroup>,
    cells: HashMap<i32, Vec<u64>>,
    dirty: Vec<u64>,
    cell_scratch: Vec<i32>,
    query_stamp: u64,
    next_id: u64,
    aabb_extension: f64,
    aabb_multiplier: f64,
}

impl<T: Copy, O: Copy + Eq + Hash> SpatialGrid<T, O> {
    pub fn new(aabb_extension: f64, aabb_multiplier: f64) -> Self {
        Self {
            proxies: HashMap::new(),
            owner_groups: HashMap::new(),
            groups: HashMap::new(),
            cells: HashMap::new(),
            dirty: Vec::new(),
            cell_scratch: Vec::new(),
            query_stamp: 0,
            next_id: 0,
            aabb_extension,
            aabb_multiplier,
        }
    }

    pub fn get(&self, id: ProxyId) -> Option<&SpatialProxy<T, O>> {
        self.proxies.get(&id)
    }

    pub fn create_proxy(&mut self, mut bounds: Aabb, user_data: T, owner: Option<O>) -> ProxyId {
        self.next_id += 1;
        let id = ProxyId(self.next_id);
        let group_id = *self.owner_groups.entry(owner).or_insert(id.0);
        let group = self.groups.entry(group_id).or_default();
        bounds.extend(self.aabb_extension);
        self.proxies.insert(
            id,
            SpatialProxy {
                id,
                user_data,
                owner,
                aabb: bounds,
                group: group_id,
            },
        );
        group.nodes.push(id);
        if !group.dirty {
            group.dirty = true;
            self.dirty.push(group_id);
        }
        id
    }

    pub fn destroy_proxy(&mut self, id: ProxyId) {
        let Some(node) = self.proxies.remove(&id) else {
            return;
        };
        let group = self
            .groups
            .get_mut(&node.group)
            .expect("live proxy has a group");
        group.nodes.retain(|&other| other != id);
        if !group.dirty {
            group.dirty = true;
            self.dirty.push(node.group);
        }
        if group.nodes.is_empty() {
            self.owner_groups.remove(&node.owner);
        }
    }

    fn move_proxy(
        &mut self,
        id: ProxyId,
        mut bounds: Aabb,
        displacement: Vector,
    ) -> Option<(Aabb, bool)> {
        let node = self.proxies.get_mut(&id)?;
        if node.aabb.contains(bounds) {
            return Some((node.aabb, false));
        }
        bounds.extend(self.aabb_extension);
        let margin = displacement * self.aabb_multiplier;
        bounds.lower_bound.x += 0.0_f64.min(margin.x);
        bounds.lower_bound.y += 0.0_f64.min(margin.y);
        bounds.upper_bound.x += 0.0_f64.max(margin.x);
        bounds.upper_bound.y += 0.0_f64.max(margin.y);
        node.aabb = bounds;
        let group = self
            .groups
            .get_mut(&node.group)
            .expect("live proxy has a group");
        if !group.dirty {
            group.dirty = true;
            self.dirty.push(node.group);
        }
        Some((bounds, true))
    }

    fn update_groups(&mut self) {
        for id in self.dirty.drain(..) {
            let group = self
                .groups
                .get_mut(&id)
                .expect("dirty group is retained until update");
            group.dirty = false;
            group.bounds = Aabb::EMPTY;
            for node in &group.nodes {
                group.bounds = group.bounds.combine(self.proxies[node].aabb);
            }
            self.cell_scratch.clear();
            if !group.nodes.is_empty() {
                self.cell_scratch.extend(cell_keys(group.bounds));
            }
            if group.cells != self.cell_scratch {
                for key in &group.cells {
                    // A cell key can repeat when grid coordinates hash to the same key.
                    if let Some(cell) = self.cells.get_mut(key) {
                        cell.retain(|&other| other != id);
                        if cell.is_empty() {
                            self.cells.remove(key);
                        }
                    }
                }
                std::mem::swap(&mut group.cells, &mut self.cell_scratch);
                for &key in &group.cells {
                    let cell = self.cells.entry(key).or_default();
                    if !cell.contains(&id) {
                        cell.push(id);
                    }
                }
            }
            if group.nodes.is_empty() {
                self.groups.remove(&id);
            }
        }
    }

    /// Writes a snapshot of overlapping proxies in insertion order. Callers can issue
    /// another query using a separate buffer while consuming these results.
    pub fn query(&mut self, bounds: Aabb, owner: Option<O>, hits: &mut Vec<ProxyId>) {
        self.update_groups();
        let own_group = owner.and_then(|owner| self.owner_groups.get(&Some(owner)).copied());
        hits.clear();
        self.query_proxies(bounds, own_group, |proxy| hits.push(proxy.id));
        hits.sort_unstable();
    }

    fn query_proxies(
        &mut self,
        bounds: Aabb,
        own_group: Option<u64>,
        mut visit: impl FnMut(&SpatialProxy<T, O>),
    ) {
        self.query_stamp = self.query_stamp.wrapping_add(1);
        if self.query_stamp == 0 {
            for group in self.groups.values_mut() {
                group.query_stamp = 0;
            }
            self.query_stamp = 1;
        }
        let stamp = self.query_stamp;
        for key in cell_keys(bounds) {
            let Some(cell) = self.cells.get(&key) else {
                continue;
            };
            for &id in cell {
                let group = self.groups.get_mut(&id).expect("indexed group is live");
                if own_group == Some(id) || group.query_stamp == stamp {
                    continue;
                }
                group.query_stamp = stamp;
                if !group.bounds.overlaps(bounds) {
                    continue;
                }
                for id in &group.nodes {
                    let proxy = &self.proxies[id];
                    if proxy.aabb.overlaps(bounds) {
                        visit(proxy);
                    }
                }
            }
        }
    }
}

fn cell_keys(bounds: Aabb) -> impl Iterator<Item = i32> {
    let from_x = (bounds.lower_bound.x / CELL_SIZE).floor() as i64;
    let to_x = (bounds.upper_bound.x / CELL_SIZE).floor() as i64;
    let from_y = (bounds.lower_bound.y / CELL_SIZE).floor() as i64;
    let to_y = (bounds.upper_bound.y / CELL_SIZE).floor() as i64;
    (from_x..=to_x).flat_map(move |x| {
        (from_y..=to_y).map(move |y| (x as u32).wrapping_mul(0x9e3779b1) as i32 ^ y as i32)
    })
}

pub struct BroadPhase<T, O> {
    pub grid: SpatialGrid<T, O>,
    move_buffer: Vec<ProxyId>,
    query_hits: Vec<(ProxyId, T)>,
}

impl<T: Copy, O: Copy + Eq + Hash> BroadPhase<T, O> {
    pub fn new(aabb_extension: f64, aabb_multiplier: f64) -> Self {
        Self {
            grid: SpatialGrid::new(aabb_extension, aabb_multiplier),
            move_buffer: Vec::new(),
            query_hits: Vec::new(),
        }
    }

    pub fn create_proxy(&mut self, bounds: Aabb, user_data: T, owner: Option<O>) -> ProxyId {
        let id = self.grid.create_proxy(bounds, user_data, owner);
        self.buffer_move(id);
        id
    }

    pub fn destroy_proxy(&mut self, id: ProxyId) {
        self.move_buffer.retain(|&buffered| buffered != id);
        self.grid.destroy_proxy(id);
    }

    pub fn move_proxy(&mut self, id: ProxyId, bounds: Aabb, displacement: Vector) -> Option<Aabb> {
        let (fat_bounds, moved) = self.grid.move_proxy(id, bounds, displacement)?;
        if moved {
            self.buffer_move(id);
        }
        Some(fat_bounds)
    }

    pub fn buffer_move(&mut self, id: ProxyId) {
        self.move_buffer.push(id);
    }

    pub fn update_pairs(&mut self, mut add_pair: impl FnMut(T, T)) {
        if self.move_buffer.is_empty() {
            return;
        }
        self.grid.update_groups();
        while let Some(query_id) = self.move_buffer.pop() {
            let Some(&query_proxy) = self.grid.get(query_id) else {
                continue;
            };
            self.query_hits.clear();
            let own_group = query_proxy.owner.map(|_| query_proxy.group);
            self.grid.query_proxies(query_proxy.aabb, own_group, |hit| {
                self.query_hits.push((hit.id, hit.user_data));
            });
            self.query_hits.sort_unstable_by_key(|&(id, _)| id);
            for &(id, other) in &self.query_hits {
                if id == query_id {
                    continue;
                }
                if id < query_id {
                    add_pair(other, query_proxy.user_data);
                } else {
                    add_pair(query_proxy.user_data, other);
                }
            }
        }
    }

    pub fn test_overlap(&self, a: ProxyId, b: ProxyId) -> bool {
        self.grid
            .get(a)
            .zip(self.grid.get(b))
            .is_some_and(|(a, b)| a.aabb.overlaps(b.aabb))
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RecordedProxy {
        id: i32,
        proxy_id: u64,
        bounds: Aabb,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Operation {
        kind: String,
        id: Option<i32>,
        owner: Option<i32>,
        #[serde(default)]
        bounds: Aabb,
        #[serde(default)]
        displacement: Vector,
        #[serde(default)]
        nested: Aabb,
        #[serde(default)]
        limit: usize,
        pairs: Vec<[i32; 2]>,
        hits: Vec<i32>,
        nested_hits: Vec<i32>,
        proxies: Vec<RecordedProxy>,
    }

    #[test]
    fn typescript_broad_phase_lifecycle() {
        let records: Vec<Operation> =
            serde_json::from_str(include_str!("../../../../tests/fixtures/broad-phase.json"))
                .unwrap();
        assert!(records.len() >= 500);
        let rules = crate::specs::Catalog::load().unwrap();
        let physics = rules.simulation.physics;
        let mut broad = BroadPhase::new(physics.aabb_extension, physics.aabb_multiplier);
        let mut proxies = HashMap::new();
        let mut scratch = Vec::new();
        let mut nested_scratch = Vec::new();
        for (step, op) in records.into_iter().enumerate() {
            let mut pairs = Vec::new();
            let mut hits = Vec::new();
            let mut nested_hits = Vec::new();
            match op.kind.as_str() {
                "create" => {
                    let id = op.id.unwrap();
                    proxies.insert(id, broad.create_proxy(op.bounds, id, op.owner));
                }
                "move" => {
                    broad.move_proxy(proxies[&op.id.unwrap()], op.bounds, op.displacement);
                }
                "destroy" => broad.destroy_proxy(proxies.remove(&op.id.unwrap()).unwrap()),
                "buffer" => broad.buffer_move(proxies[&op.id.unwrap()]),
                "pairs" => broad.update_pairs(|a, b| pairs.push([a, b])),
                "query" => {
                    broad.grid.query(op.bounds, op.owner, &mut scratch);
                    for &id in &scratch {
                        hits.push(broad.grid.get(id).unwrap().user_data);
                        if hits.len() == 1 {
                            broad.grid.query(op.nested, None, &mut nested_scratch);
                            nested_hits.extend(
                                nested_scratch
                                    .iter()
                                    .map(|&id| broad.grid.get(id).unwrap().user_data),
                            );
                        }
                        if op.limit != 0 && hits.len() == op.limit {
                            break;
                        }
                    }
                }
                _ => panic!("unknown operation {}", op.kind),
            }
            assert_eq!(pairs, op.pairs, "step {step} pairs");
            assert_eq!(hits, op.hits, "step {step} hits");
            assert_eq!(nested_hits, op.nested_hits, "step {step} nested hits");
            assert_eq!(proxies.len(), op.proxies.len(), "step {step} proxy count");
            for expected in op.proxies {
                let proxy = broad.grid.get(proxies[&expected.id]).unwrap();
                assert_eq!(proxy.id.get(), expected.proxy_id, "step {step} proxy ID");
                assert_eq!(proxy.aabb, expected.bounds, "step {step} proxy bounds");
            }
        }
    }
}
