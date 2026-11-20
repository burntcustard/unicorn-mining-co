//! Fixed-step movement scheduling and timed control changes.

use std::collections::HashMap;

use crate::protocol::{Input, InputFrame, SimulationEvent};
use crate::specs::Simulation;
use crate::vector::Vector;

use super::game_object::GameObject;
use super::observers::{ObserverTiers, Observers};

#[derive(Clone, Copy, Debug)]
pub struct ObserverPlayer<E> {
    pub ship: Option<E>,
    /// A positive limit holds distant objects outside this observer's range.
    pub range: f64,
}

#[derive(Clone, Copy)]
pub struct MovementHandle<E> {
    pub id: E,
    /// An optional OrderedMap slot. usize::MAX always falls back to the ID.
    pub slot: usize,
}

impl<E> MovementHandle<E> {
    pub fn by_id(id: E) -> Self {
        Self {
            id,
            slot: usize::MAX,
        }
    }
}

pub struct MovementEntity<'a, E> {
    pub handle: MovementHandle<E>,
    pub object: &'a GameObject,
    pub is_craft: bool,
    pub is_parent: bool,
    /// True if this entity can resolve a laser at any point in the scheduled tick.
    pub can_resolve_lasers: bool,
}

pub trait MovementWorld {
    /// A stable handle for the duration of a scheduled tick.
    type Entity: Copy;

    fn movement_entities(&self) -> impl Iterator<Item = MovementEntity<'_, Self::Entity>>;
    fn observer_players(&self) -> impl Iterator<Item = ObserverPlayer<Self::Entity>>;
    fn object(&self, entity: MovementHandle<Self::Entity>) -> Option<&GameObject>;
    fn object_mut(&mut self, entity: MovementHandle<Self::Entity>) -> Option<&mut GameObject>;

    fn is_craft(&self, _entity: Self::Entity) -> bool {
        false
    }

    fn is_controlled_ship(&self, _entity: Self::Entity) -> bool {
        false
    }

    fn update_entity(
        &mut self,
        entity: MovementHandle<Self::Entity>,
        duration: f64,
        parents: &[MovementHandle<Self::Entity>],
    );

    /// Start a pass whose scheduled updates share the same parent handles.
    fn begin_movement(&mut self) {}

    fn update_scheduled_entity(
        &mut self,
        entity: MovementHandle<Self::Entity>,
        duration: f64,
        parents: &[MovementHandle<Self::Entity>],
    ) {
        self.update_entity(entity, duration, parents);
    }

    fn control(
        &mut self,
        _entity: Self::Entity,
        _input: Input,
        _events: &mut Vec<SimulationEvent>,
    ) {
    }

    fn resolve_lasers(
        &mut self,
        _entity: Self::Entity,
        _duration: f64,
        _events: &mut Vec<SimulationEvent>,
    ) {
    }

    fn on_death(&mut self, _entity: Self::Entity, _events: &mut Vec<SimulationEvent>) {}

    fn death_event(&self, _entity: Self::Entity) -> Option<SimulationEvent> {
        None
    }

    // Keep expired entities addressable until after their death hooks.
    fn remove(&mut self, entity: Self::Entity);
}

#[derive(Clone, Copy)]
pub struct UpdateEntities<'a, E> {
    pub entities: Option<&'a [E]>,
    pub tick: u64,
    pub duration: Option<f64>,
    pub inputs: Option<&'a HashMap<i64, InputFrame>>,
    pub input_offset: f64,
}

impl<E> Default for UpdateEntities<'_, E> {
    fn default() -> Self {
        Self {
            entities: None,
            tick: 0,
            duration: None,
            inputs: None,
            input_offset: 0.0,
        }
    }
}

#[derive(Clone, Copy)]
struct ScheduledEntity<E> {
    entity: MovementHandle<E>,
    substeps: i32,
    due: bool,
    can_resolve_lasers: bool,
    step: f64,
    laser_duration: f64,
}

pub struct MovementSchedule<E> {
    observers: Observers,
    parents: Vec<MovementHandle<E>>,
    entries: Vec<ScheduledEntity<E>>,
}

impl<E> Default for MovementSchedule<E> {
    fn default() -> Self {
        Self {
            observers: Observers::default(),
            parents: Vec::new(),
            entries: Vec::new(),
        }
    }
}

impl<E: Copy> MovementSchedule<E> {
    pub fn update(
        &mut self,
        world: &mut impl MovementWorld<Entity = E>,
        rules: &Simulation,
        options: UpdateEntities<'_, E>,
        events: &mut Vec<SimulationEvent>,
    ) {
        let tiers = ObserverTiers::from(rules);
        let step = rules.simulation_step;
        let duration = options.duration.unwrap_or(step);

        self.observers.clear();
        for observer in world.observer_players() {
            let position = observer
                .ship
                .and_then(|ship| world.object(MovementHandle::by_id(ship)))
                .map(|ship| ship.position);
            if observer.range > 0.0 {
                self.observers.push_limited(position, observer.range);
            } else if let Some(position) = position {
                self.observers.push(position);
            }
        }

        self.entries.clear();
        self.parents.clear();
        let mut schedule = |entity, object: &GameObject, is_craft, can_resolve_lasers| {
            let tier = self
                .observers
                .tier_for(object.position, object.velocity, is_craft, &tiers);
            self.entries.push(ScheduledEntity {
                entity,
                substeps: tier.substeps,
                due: options
                    .tick
                    .wrapping_add(1)
                    .is_multiple_of(tier.update_every as u64),
                can_resolve_lasers,
                step: (object.pending_update_time + step) / f64::from(tier.substeps),
                laser_duration: 0.0,
            });
        };

        if let Some(entities) = options.entities {
            for &id in entities {
                let handle = MovementHandle::by_id(id);
                if let Some(object) = world.object(handle) {
                    schedule(handle, object, world.is_craft(id), true);
                }
            }
            self.parents.extend(
                world
                    .movement_entities()
                    .filter(|entity| entity.is_parent)
                    .map(|entity| entity.handle),
            );
        } else {
            for entity in world.movement_entities() {
                if entity.is_parent {
                    self.parents.push(entity.handle);
                }
                schedule(
                    entity.handle,
                    entity.object,
                    entity.is_craft,
                    entity.can_resolve_lasers,
                );
            }
        }

        world.begin_movement();
        for substep in 0..tiers.visible.substeps {
            for entry in &mut self.entries {
                let run = entry.due && substep < entry.substeps;
                if substep != 0 && !run {
                    continue;
                }
                let entity = entry.entity;
                let Some(object) = world.object_mut(entity) else {
                    continue;
                };
                if object.dead {
                    continue;
                }
                if substep == 0 {
                    object.pending_update_time += duration;
                }
                if !run || object.pending_update_time <= 0.0 {
                    continue;
                }

                let segment = object.pending_update_time.min(entry.step);
                let mut elapsed = duration - object.pending_update_time;
                object.pending_update_time -= segment;
                let end = elapsed + segment;
                let player_id = object.player_id;

                let input = player_id
                    .and_then(|id| options.inputs?.get(&id))
                    .filter(|_| world.is_controlled_ship(entity.id));
                if let Some(input) = input {
                    for change in &input.changes {
                        let offset = change.offset - options.input_offset;
                        if offset < elapsed || offset >= end {
                            continue;
                        }

                        if offset > elapsed {
                            world.update_scheduled_entity(entity, offset - elapsed, &self.parents);
                            if entry.can_resolve_lasers {
                                entry.laser_duration += offset - elapsed;
                            }
                        }

                        if entry.can_resolve_lasers {
                            world.resolve_lasers(entity.id, entry.laser_duration, events);
                            entry.laser_duration = 0.0;
                        }
                        world.control(entity.id, change.input, events);
                        elapsed = offset;
                    }
                }

                world.update_scheduled_entity(entity, end - elapsed, &self.parents);
                // A simulation tick normally resolves damage once. Control
                // changes can resolve it earlier for a short press.
                if entry.can_resolve_lasers {
                    entry.laser_duration += end - elapsed;
                    if substep == entry.substeps - 1
                        || world
                            .object(entity)
                            .is_some_and(|object| object.pending_update_time <= 0.0)
                    {
                        world.resolve_lasers(entity.id, entry.laser_duration, events);
                        entry.laser_duration = 0.0;
                    }
                }

                if world.object(entity).is_some_and(|object| object.dead) {
                    world.on_death(entity.id, events);
                    if let Some(event) = world.death_event(entity.id) {
                        events.push(event);
                    }
                    world.remove(entity.id);
                }
            }
        }
    }
}

pub fn update_tier(
    position: Vector,
    observer_positions: &[Vector],
    rules: &ObserverTiers,
) -> crate::specs::UpdateTier {
    if observer_positions
        .iter()
        .any(|&observer| position.distance_squared(observer) <= rules.visible_range_squared)
    {
        rules.visible
    } else {
        rules.distant
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;
    use crate::protocol::InputChange;
    use crate::simulation::game_object::{MotionContext, ObjectProperties};
    use crate::simulation::local_movement::MovementParent;
    use crate::specs::Catalog;

    #[derive(Deserialize)]
    struct FixtureObject {
        id: i64,
        #[serde(flatten)]
        properties: ObjectProperties,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ObservedMotion {
        id: i64,
        position: Vector,
        velocity: Vector,
        rotation: f64,
        spin: f64,
        pending_update_time: f64,
        health: Option<f64>,
        parent: Option<i64>,
        rate: f64,
    }

    #[derive(Deserialize)]
    struct Snapshot {
        tick: u64,
        entities: Vec<ObservedMotion>,
    }

    #[derive(Deserialize)]
    struct Fixture {
        objects: Vec<FixtureObject>,
        snapshots: Vec<Snapshot>,
        frame: RecordedFrame,
        calls: Vec<Call>,
    }

    fn find_mut(objects: &mut [GameObject], id: i64) -> &mut GameObject {
        objects
            .iter_mut()
            .find(|object| object.id == id)
            .expect("fixture object")
    }

    fn holder_record(object: &GameObject) -> MovementParent {
        let mut parent = MovementParent::radial(object.id, object.position, object.spin, 20.0);
        parent.dead = object.dead;
        parent.resident = !object.dead;
        parent
    }

    fn check_snapshot(objects: &[GameObject], expected: &Snapshot) {
        assert_eq!(
            objects.len(),
            expected.entities.len(),
            "tick {}",
            expected.tick
        );
        for (object, observed) in objects.iter().zip(&expected.entities) {
            assert_eq!(object.id, observed.id);
            assert_eq!(object.local_movement.parent, observed.parent);
            for (name, actual, expected_value) in [
                ("position.x", object.position.x, observed.position.x),
                ("position.y", object.position.y, observed.position.y),
                ("velocity.x", object.velocity.x, observed.velocity.x),
                ("velocity.y", object.velocity.y, observed.velocity.y),
                ("rotation", object.rotation, observed.rotation),
                ("spin", object.spin, observed.spin),
                (
                    "pending_update_time",
                    object.pending_update_time,
                    observed.pending_update_time,
                ),
                ("rate", object.local_movement.rate, observed.rate),
            ] {
                assert!(
                    (actual - expected_value).abs() <= 2e-8,
                    "tick {} object {} {name}: {actual} != {expected_value}",
                    expected.tick,
                    object.id,
                );
            }

            if let Some(health) = observed.health {
                assert!((object.health - health).abs() <= 2e-8);
            } else {
                assert!(object.health.is_nan());
            }
        }
    }

    #[derive(Deserialize)]
    struct RecordedFrame {
        input: Input,
        changes: Vec<RecordedChange>,
    }

    #[derive(Deserialize)]
    struct RecordedChange {
        input: Input,
        offset: f64,
    }

    #[derive(Debug, Deserialize)]
    struct Call {
        #[serde(rename = "type")]
        kind: String,
        value: f64,
    }

    #[derive(Default)]
    struct FixtureWorld {
        objects: Vec<GameObject>,
        removed_holder: Option<GameObject>,
        active_player: bool,
        record_controls: bool,
        calls: Vec<Call>,
        deaths: usize,
    }

    impl MovementWorld for FixtureWorld {
        type Entity = i64;

        fn movement_entities(&self) -> impl Iterator<Item = MovementEntity<'_, i64>> {
            self.objects.iter().map(|object| MovementEntity {
                handle: MovementHandle::by_id(object.id),
                object,
                is_craft: self.record_controls,
                is_parent: object.id == 20,
                can_resolve_lasers: true,
            })
        }

        fn observer_players(&self) -> impl Iterator<Item = ObserverPlayer<i64>> {
            self.active_player
                .then_some(ObserverPlayer {
                    ship: Some(1),
                    range: 0.0,
                })
                .into_iter()
        }

        fn object(&self, entity: MovementHandle<i64>) -> Option<&GameObject> {
            self.objects.iter().find(|object| object.id == entity.id)
        }

        fn object_mut(&mut self, entity: MovementHandle<i64>) -> Option<&mut GameObject> {
            self.objects
                .iter_mut()
                .find(|object| object.id == entity.id)
        }

        fn is_craft(&self, _entity: i64) -> bool {
            self.record_controls
        }

        fn is_controlled_ship(&self, _entity: i64) -> bool {
            self.record_controls
        }

        fn update_entity(
            &mut self,
            entity: MovementHandle<i64>,
            duration: f64,
            parents: &[MovementHandle<i64>],
        ) {
            if self.record_controls {
                self.calls.push(Call {
                    kind: "update".into(),
                    value: duration,
                });
                return;
            }

            let active = parents
                .first()
                .and_then(|&parent| self.object(parent))
                .map(holder_record);
            let parent = active.or_else(|| self.removed_holder.as_ref().map(holder_record));
            find_mut(&mut self.objects, entity.id).update(
                duration,
                MotionContext {
                    current_parent: parent,
                    parents: active.as_slice(),
                    ..MotionContext::default()
                },
            );
        }

        fn control(&mut self, _entity: i64, input: Input, _events: &mut Vec<SimulationEvent>) {
            self.calls.push(Call {
                kind: "control".into(),
                value: input.thrust,
            });
        }

        fn on_death(&mut self, _entity: i64, _events: &mut Vec<SimulationEvent>) {
            self.deaths += 1;
        }

        fn death_event(&self, entity: i64) -> Option<SimulationEvent> {
            let object = self.object(MovementHandle::by_id(entity))?;
            Some(SimulationEvent::ObjectDestroyed {
                object_id: object.id,
                color: String::new(),
                damage: 0.0,
                position: object.position,
            })
        }

        fn remove(&mut self, entity: i64) {
            self.objects.retain(|object| object.id != entity);
        }
    }

    #[test]
    fn movement_matches_existing_typescript_snapshots() -> Result<(), Box<dyn std::error::Error>> {
        let Fixture {
            objects, snapshots, ..
        } = serde_json::from_str(include_str!("../../../../tests/fixtures/movement.json"))?;
        let catalog = Catalog::load()?;
        let rules = &catalog.simulation;
        let mut objects: Vec<_> = objects
            .into_iter()
            .map(|object| GameObject::new(object.id, object.properties, rules))
            .collect();
        let holder = GameObject::new(
            20,
            ObjectProperties {
                spin: 0.7,
                ..ObjectProperties::default()
            },
            rules,
        );
        objects.push(holder);

        let mut world = FixtureWorld {
            objects,
            ..FixtureWorld::default()
        };
        let mut schedule = MovementSchedule::default();
        let mut events = Vec::new();
        let mut snapshots = snapshots.iter().peekable();

        for tick in 0..1800 {
            match tick {
                40 => {
                    let mut holder = world.objects.pop().expect("the active holder");
                    holder.dead = true;
                    world.removed_holder = Some(holder);
                }
                80 => {
                    let mut holder = world.removed_holder.take().expect("the removed holder");
                    holder.dead = false;
                    world.objects.push(holder);
                }
                120 => find_mut(&mut world.objects, 1).position = Vector::new(50000.0, 100.0),
                240 => find_mut(&mut world.objects, 2).velocity = Vector::ZERO,
                400 => find_mut(&mut world.objects, 3).velocity = Vector::new(3.0, -8.0),
                500 => find_mut(&mut world.objects, 5).buried = true,
                560 => find_mut(&mut world.objects, 5).buried = false,
                _ => {}
            }

            world.active_player = tick < 600;
            schedule.update(
                &mut world,
                rules,
                UpdateEntities {
                    tick,
                    ..UpdateEntities::default()
                },
                &mut events,
            );

            if let Some(snapshot) = snapshots.next_if(|snapshot| snapshot.tick == tick) {
                check_snapshot(&world.objects, snapshot);
            }
        }
        assert_eq!(snapshots.count(), 0);

        Ok(())
    }

    #[test]
    fn timed_controls_keep_recorded_tick_boundaries() -> Result<(), Box<dyn std::error::Error>> {
        let Fixture { frame, calls, .. } =
            serde_json::from_str(include_str!("../../../../tests/fixtures/movement.json"))?;
        let catalog = Catalog::load()?;
        let rules = &catalog.simulation;
        let mut world = FixtureWorld {
            objects: vec![GameObject::new(
                1,
                ObjectProperties {
                    player_id: Some(1),
                    ..ObjectProperties::default()
                },
                rules,
            )],
            record_controls: true,
            ..FixtureWorld::default()
        };
        let frame = InputFrame {
            input: frame.input,
            changes: frame
                .changes
                .into_iter()
                .map(|change| InputChange {
                    input: change.input,
                    offset: change.offset,
                })
                .collect(),
        };
        let inputs = HashMap::from([(1, frame)]);
        MovementSchedule::default().update(
            &mut world,
            rules,
            UpdateEntities {
                inputs: Some(&inputs),
                ..UpdateEntities::default()
            },
            &mut Vec::new(),
        );

        assert_eq!(world.calls.len(), calls.len());
        for (actual, expected) in world.calls.iter().zip(calls) {
            assert_eq!(actual.kind, expected.kind);
            assert!((actual.value - expected.value).abs() <= 1e-12);
        }

        Ok(())
    }

    #[test]
    fn expiry_runs_death_hooks_once_per_entity() -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let mut rules = catalog.simulation;
        let mut schedule = MovementSchedule::default();
        for substeps in [1, 2, 3] {
            rules
                .update_tiers
                .get_mut("visible")
                .expect("visible tier")
                .substeps = substeps;
            for expires_at in 0..substeps {
                let mut world = FixtureWorld {
                    objects: vec![GameObject::new(
                        1,
                        ObjectProperties {
                            health: Some(
                                rules.simulation_step * (f64::from(expires_at) + 0.5)
                                    / f64::from(substeps),
                            ),
                            decay: Some(1.0),
                            velocity: Vector::new(1.0, 0.0),
                            ..ObjectProperties::default()
                        },
                        &rules,
                    )],
                    ..FixtureWorld::default()
                };
                let mut events = Vec::new();
                schedule.update(&mut world, &rules, UpdateEntities::default(), &mut events);
                schedule.update(
                    &mut world,
                    &rules,
                    UpdateEntities {
                        entities: Some(&[1]),
                        ..UpdateEntities::default()
                    },
                    &mut events,
                );
                assert_eq!(world.deaths, 1);
                assert_eq!(events.len(), 1);
                assert!(world.objects.is_empty());
            }
        }

        Ok(())
    }
}
