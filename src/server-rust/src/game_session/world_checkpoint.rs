use std::collections::{BTreeMap, HashSet, VecDeque};
use std::time::{Duration, Instant};

use crate::persistence::{SavedEntity, SectorState};
use crate::random::SeededRandom;
use crate::simulation::saved_entity::SavedModel;
use crate::simulation::streaming::StreamingRegions;
use crate::simulation::world::{Entity, EntityChange, World};
use crate::simulation::world_step::WorldIds;

const CHECKPOINT_INTERVAL: Duration = Duration::from_secs(180);
pub(crate) const CHECKPOINT_BUDGET: usize = 8;

enum Pending {
    Changed(EntityChange),
    Checkpoint {
        generated: bool,
        state: Box<SavedModel>,
    },
}

/// World change tracking and incremental capture on the thread that owns the
/// simulation. The SQLite worker consumes the resulting immutable records.
pub struct WorldCheckpoint {
    pending: BTreeMap<i64, Pending>,
    stored: HashSet<i64>,
    checkpoint: VecDeque<(i64, u64)>,
    next_checkpoint: Instant,
}

impl WorldCheckpoint {
    pub fn new(now: Instant) -> Self {
        Self {
            pending: BTreeMap::new(),
            stored: HashSet::new(),
            checkpoint: VecDeque::new(),
            next_checkpoint: now + CHECKPOINT_INTERVAL,
        }
    }

    pub fn restore(
        &mut self,
        world: &mut World,
        regions: &mut StreamingRegions<Entity>,
        rows: Vec<SavedEntity<SavedModel>>,
    ) -> Result<(), String> {
        for row in rows {
            if let Some(state) = row.state {
                let model = state
                    .restore(&world.catalog, &mut world.outlines)
                    .map_err(|error| format!("restore entity {}: {error}", row.id))?;
                let entity = world.make_entity(model, row.generated);
                regions.restore_sleeping::<World>(row.id, entity, row.generated);
                if !row.generated {
                    self.stored.insert(row.id);
                }
            } else if row.generated {
                regions.restore_removal(row.id);
            }
        }
        world.save_changes();
        Ok(())
    }

    pub fn sector_state(world: &World) -> SectorState {
        SectorState {
            tick: world.tick,
            random_state: world.random.state(),
            next_entity_id: world.ids.next_entity,
            next_object_id: world.ids.last_object,
            ..SectorState::default()
        }
    }

    pub fn restore_sector_state(world: &mut World, state: &SectorState) {
        world.tick = state.tick;
        world.random = SeededRandom::new(state.random_state);
        world.ids = WorldIds {
            next_entity: state.next_entity_id,
            last_object: state.next_object_id,
        };
    }

    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    pub fn advance(&mut self, now: Instant, world: &mut World, regions: &StreamingRegions<Entity>) {
        self.advance_with_budget(now, world, regions, CHECKPOINT_BUDGET);
    }

    pub(crate) fn advance_with_budget(
        &mut self,
        now: Instant,
        world: &mut World,
        regions: &StreamingRegions<Entity>,
        budget: usize,
    ) -> usize {
        self.record_changes(world, regions);
        if now >= self.next_checkpoint && self.checkpoint.is_empty() {
            self.checkpoint.extend(
                world
                    .entities()
                    .map(|entity| (entity.model.object().id, entity.incarnation)),
            );
            self.next_checkpoint = now + CHECKPOINT_INTERVAL;
        }
        let consumed = budget.min(self.checkpoint.len());
        for _ in 0..consumed {
            let (id, incarnation) = self.checkpoint.pop_front().expect("queued checkpoint");
            let Some(entity) = world.entity(id) else {
                continue;
            };
            if entity.incarnation != incarnation
                || !entity.belongs_in_world_save()
                || entity.model.object().dead
            {
                continue;
            }
            if entity.transient() {
                self.record_unavailable(id, entity.generated);
            } else {
                self.pending
                    .entry(id)
                    .or_insert_with(|| Pending::Checkpoint {
                        generated: entity.generated,
                        state: Box::new(SavedModel::capture(&entity.model, &world.catalog)),
                    });
            }
        }
        budget - consumed
    }

    /// Called after the sole writer reports capacity. The caller stops writes
    /// if the underlying store becomes unavailable during submission.
    pub fn capture(
        &mut self,
        sector_id: &str,
        world: &mut World,
        regions: &StreamingRegions<Entity>,
    ) -> Vec<SavedEntity<SavedModel>> {
        self.record_changes(world, regions);
        let mut rows = Vec::with_capacity(self.pending.len());
        for (id, pending) in std::mem::take(&mut self.pending) {
            let (generated, state) = match pending {
                Pending::Checkpoint { generated, state } => (generated, Some(*state)),
                Pending::Changed(change) => {
                    let live = (!change.removed)
                        .then(|| entity(world, regions, id))
                        .flatten();
                    let state = live
                        .filter(|entity| !entity.model.object().dead && !entity.transient())
                        .map(|entity| SavedModel::capture(&entity.model, &world.catalog));
                    (change.generated, state)
                }
            };
            if !generated {
                if state.is_some() {
                    self.stored.insert(id);
                } else if !self.stored.remove(&id) {
                    continue;
                }
            }
            rows.push(SavedEntity {
                id,
                sector_id: sector_id.to_owned(),
                generated,
                state,
            });
        }
        rows
    }

    fn record_changes(&mut self, world: &mut World, regions: &StreamingRegions<Entity>) {
        let mut changes = std::mem::take(world.save_changes());
        for (id, change) in changes.drain() {
            if change.removed || entity(world, regions, id).is_some_and(Entity::transient) {
                self.record_unavailable(id, change.generated);
            } else {
                self.pending.insert(id, Pending::Changed(change));
            }
        }
        *world.save_changes() = changes;
    }

    fn record_unavailable(&mut self, id: i64, generated: bool) {
        if generated || self.stored.contains(&id) {
            self.pending.insert(
                id,
                Pending::Changed(EntityChange {
                    generated,
                    removed: true,
                }),
            );
        } else {
            self.pending.remove(&id);
        }
    }
}

fn entity<'a>(
    world: &'a World,
    regions: &'a StreamingRegions<Entity>,
    id: i64,
) -> Option<&'a Entity> {
    world.entity(id).or_else(|| regions.sleeping(id))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::simulation::game_object::{GameObject, ObjectProperties};
    use crate::specs::Catalog;
    use crate::vector::Vector;

    use super::*;
    use crate::simulation::world::EntityKind;

    fn add(world: &mut World, id: i64, object: ObjectProperties, generated: bool) {
        let object = GameObject::new(id, object, &world.catalog.simulation);
        world.add_entity(EntityKind::Object(Box::new(object)), generated);
    }

    #[test]
    fn checkpoints_restore_sleeping_state_and_record_later_removals() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let now = Instant::now();
        let mut checkpoint = WorldCheckpoint::new(now);
        let mut world = World::new(25.0, Arc::clone(&catalog));
        let mut regions = StreamingRegions::new(25, &catalog, None);
        checkpoint
            .restore(&mut world, &mut regions, vec![])
            .unwrap();
        add(
            &mut world,
            44,
            ObjectProperties {
                position: Vector::new(2.0, 3.0),
                health: Some(628.0),
                ..Default::default()
            },
            false,
        );
        add(
            &mut world,
            45,
            ObjectProperties {
                decay: Some(2.0),
                ..Default::default()
            },
            false,
        );
        add(&mut world, 46, ObjectProperties::default(), true);
        world.remove_entity(46);
        regions.sync(&mut world, &[]);
        let rows = checkpoint.capture("start", &mut world, &regions);
        assert_eq!(rows.iter().map(|row| row.id).collect::<Vec<_>>(), [44, 46]);
        assert!(rows[0].state.is_some());
        assert!(rows[1].generated && rows[1].state.is_none());

        let mut resumed = WorldCheckpoint::new(now);
        let mut world = World::new(25.0, Arc::clone(&catalog));
        let mut regions = StreamingRegions::new(25, &catalog, None);
        resumed.restore(&mut world, &mut regions, rows).unwrap();
        assert!(world.entity(44).is_none());
        regions.sync(&mut world, &[Vector::ZERO]);
        assert_eq!(world.entity(44).unwrap().model.object().health, 628.0);
        world.remove_entity(44);
        let rows = resumed.capture("start", &mut world, &regions);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 44);
        assert!(!rows[0].generated && rows[0].state.is_none());
    }

    #[test]
    fn periodic_capture_has_a_fixed_per_tick_budget() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let now = Instant::now();
        let mut checkpoint = WorldCheckpoint::new(now);
        let mut world = World::new(25.0, Arc::clone(&catalog));
        let mut regions = StreamingRegions::new(25, &catalog, None);
        checkpoint
            .restore(&mut world, &mut regions, vec![])
            .unwrap();
        for id in 30..40 {
            add(&mut world, id, ObjectProperties::default(), true);
        }
        checkpoint.advance(now + CHECKPOINT_INTERVAL, &mut world, &regions);
        assert_eq!(checkpoint.pending_count(), CHECKPOINT_BUDGET);
        world.remove_entity(30);
        checkpoint.advance(now + CHECKPOINT_INTERVAL, &mut world, &regions);
        let rows = checkpoint.capture("start", &mut world, &regions);
        assert_eq!(rows.len(), 10);
        assert_eq!(rows[0].id, 30);
        assert!(rows[0].state.is_none());
        assert!(rows[1..].iter().all(|row| row.state.is_some()));
    }
}
