use std::hash::Hash;

use crate::utilities::vector::Vector;

use super::{Aabb, ProxyId, SpatialGrid};

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
    use hashbrown::HashMap;
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
        let records: Vec<Operation> = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/broad-phase.json"
        )))
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
