use std::collections::HashMap;

use crate::protocol::{InputFrame, SimulationEvent};
use crate::specs::Simulation;

use super::update_tier::{MovementHandle, MovementSchedule, MovementWorld, UpdateEntities};

/// Entity IDs enter snapshots. Locally mounted objects use negative IDs.
#[derive(Clone, Copy, Debug)]
pub struct WorldIds {
    pub next_entity: i64,
    /// The most recently issued negative object ID.
    pub last_object: i64,
}

impl Default for WorldIds {
    fn default() -> Self {
        Self {
            next_entity: 1,
            last_object: 0,
        }
    }
}

impl WorldIds {
    pub fn record_entity(&mut self, id: i64) {
        self.next_entity = self.next_entity.max(id.saturating_add(1));
    }

    pub fn entity(&mut self) -> i64 {
        let id = self.next_entity;
        self.next_entity = id.wrapping_add(1);
        id
    }

    pub fn object(&mut self) -> i64 {
        self.last_object = self.last_object.wrapping_sub(1);
        self.last_object
    }
}

/// Gameplay owns entity handles and the collision state. All callbacks run on
/// the same world owner, enabling creation or removal during any phase.
pub trait SteppedWorld: MovementWorld {
    type Contact;

    fn tick(&self) -> u64;
    fn set_tick(&mut self, tick: u64);
    fn players_in_order(&self) -> impl Iterator<Item = (i64, Self::Entity)>;
    fn reset_biting(&mut self);
    fn capture_projectile_sweeps(&mut self);
    fn capture_collision_poses(&mut self);

    fn collide(
        &mut self,
        dt: f64,
        events: &mut Vec<SimulationEvent>,
        contacts: &mut Vec<Self::Contact>,
    );
    /// Iterate current projectiles, including those added during iteration.
    fn resolve_projectile_hits(&mut self, dt: f64, events: &mut Vec<SimulationEvent>);

    fn contact_owners(contact: &Self::Contact) -> [Option<Self::Entity>; 2];
    /// Return true when this is the first contact for an eligible handler.
    fn queue_contact(&mut self, entity: Self::Entity, contact: &Self::Contact) -> bool;
    fn handle_docking_contacts(
        &mut self,
        entity: Self::Entity,
        dt: f64,
        events: &mut Vec<SimulationEvent>,
    );
    fn handle_contacts(&mut self, entity: Self::Entity, dt: f64, events: &mut Vec<SimulationEvent>);
    fn clear_contacts(&mut self, entity: Self::Entity);
    fn round_motion(&mut self);
}

#[derive(Default)]
pub struct WorldStepOptions<'a> {
    /// Zero advances one tick.
    pub ticks: u64,
    pub duration: Option<f64>,
    pub inputs: Option<&'a HashMap<i64, InputFrame>>,
}

pub struct WorldStep<Entity, Contact> {
    movement: MovementSchedule<Entity>,
    player_ships: Vec<(i64, Entity)>,
    contacts: Vec<Contact>,
    contact_handlers: Vec<Entity>,
}

impl<Entity, Contact> Default for WorldStep<Entity, Contact> {
    fn default() -> Self {
        Self {
            movement: MovementSchedule::default(),
            player_ships: Vec::new(),
            contacts: Vec::new(),
            contact_handlers: Vec::new(),
        }
    }
}

impl<Entity: Copy, Contact> WorldStep<Entity, Contact> {
    pub fn update<W: SteppedWorld<Entity = Entity, Contact = Contact>>(
        &mut self,
        world: &mut W,
        rules: &Simulation,
        options: WorldStepOptions<'_>,
        events: &mut Vec<SimulationEvent>,
    ) {
        let ticks = options.ticks.max(1);
        let dt = options.duration.unwrap_or(rules.simulation_step);
        let tick = world.tick();
        events.clear();

        world.reset_biting();

        self.player_ships.clear();
        self.player_ships.extend(world.players_in_order());
        for &(player, ship) in &self.player_ships {
            if world.object(MovementHandle::by_id(ship)).is_some() && world.is_controlled_ship(ship)
            {
                let input = options
                    .inputs
                    .and_then(|inputs| inputs.get(&player))
                    .map(|frame| frame.input)
                    .unwrap_or_default();
                world.control(ship, input, events);
            }
        }

        world.capture_projectile_sweeps();
        world.capture_collision_poses();

        for index in 0..ticks {
            self.movement.update(
                world,
                rules,
                UpdateEntities {
                    entities: None,
                    tick: tick.wrapping_add(index),
                    duration: Some(dt / ticks as f64),
                    inputs: options.inputs,
                    input_offset: index as f64 * dt / ticks as f64,
                },
                events,
            );
        }

        self.contacts.clear();
        world.collide(dt, events, &mut self.contacts);
        world.resolve_projectile_hits(dt, events);
        self.contact_handlers.clear();
        for contact in &self.contacts {
            for entity in W::contact_owners(contact).into_iter().flatten() {
                if world.queue_contact(entity, contact) {
                    self.contact_handlers.push(entity);
                }
            }
        }

        // Settle docking before processing cargo pickup and drilling contacts.
        for &entity in &self.contact_handlers {
            world.handle_docking_contacts(entity, dt, events);
        }
        for &entity in &self.contact_handlers {
            world.handle_contacts(entity, dt, events);
        }
        for &entity in &self.contact_handlers {
            world.clear_contacts(entity);
        }

        world.round_motion();
        world.set_tick(tick.wrapping_add(ticks));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::Input;
    use crate::simulation::game_object::GameObject;
    use crate::simulation::update_tier::{MovementEntity, ObserverPlayer};

    struct CollisionOrderWorld {
        object: GameObject,
        contact_count: usize,
        tick: u64,
        phases: Vec<&'static str>,
    }

    impl MovementWorld for CollisionOrderWorld {
        type Entity = i64;

        fn movement_entities(&self) -> impl Iterator<Item = MovementEntity<'_, i64>> {
            std::iter::once(MovementEntity {
                handle: MovementHandle::by_id(17),
                object: &self.object,
                is_craft: true,
                is_parent: false,
                can_resolve_lasers: true,
            })
        }
        fn observer_players(&self) -> impl Iterator<Item = ObserverPlayer<Self::Entity>> {
            std::iter::empty()
        }
        fn object(&self, entity: MovementHandle<Self::Entity>) -> Option<&GameObject> {
            (entity.id == 17).then_some(&self.object)
        }
        fn object_mut(&mut self, entity: MovementHandle<Self::Entity>) -> Option<&mut GameObject> {
            (entity.id == 17).then_some(&mut self.object)
        }
        fn is_craft(&self, _entity: Self::Entity) -> bool {
            true
        }
        fn is_controlled_ship(&self, _entity: Self::Entity) -> bool {
            true
        }

        fn update_entity(
            &mut self,
            _entity: MovementHandle<Self::Entity>,
            _duration: f64,
            _parents: &[MovementHandle<Self::Entity>],
        ) {
            if self.phases.last() != Some(&"move") {
                self.phases.push("move");
            }
        }

        fn control(
            &mut self,
            _entity: Self::Entity,
            _input: Input,
            _events: &mut Vec<SimulationEvent>,
        ) {
            self.phases.push("control");
        }

        fn remove(&mut self, _entity: Self::Entity) {
            panic!("live object removed");
        }
    }

    impl SteppedWorld for CollisionOrderWorld {
        type Contact = [Option<i64>; 2];

        fn tick(&self) -> u64 {
            self.tick
        }
        fn set_tick(&mut self, tick: u64) {
            self.tick = tick;
        }
        fn players_in_order(&self) -> impl Iterator<Item = (i64, Self::Entity)> {
            std::iter::once((1, 17))
        }
        fn reset_biting(&mut self) {
            self.phases.push("reset biting");
        }
        fn capture_projectile_sweeps(&mut self) {
            self.phases.push("capture sweep");
        }
        fn capture_collision_poses(&mut self) {
            self.phases.push("capture poses");
        }

        fn collide(
            &mut self,
            _dt: f64,
            _events: &mut Vec<SimulationEvent>,
            contacts: &mut Vec<Self::Contact>,
        ) {
            self.phases.push("collide");
            contacts.extend([[Some(17), None], [None, Some(17)]]);
        }

        fn resolve_projectile_hits(&mut self, _dt: f64, _events: &mut Vec<SimulationEvent>) {
            self.phases.push("projectiles");
        }
        fn contact_owners(contact: &Self::Contact) -> [Option<Self::Entity>; 2] {
            *contact
        }

        fn queue_contact(&mut self, _entity: Self::Entity, _contact: &Self::Contact) -> bool {
            self.contact_count += 1;
            self.contact_count == 1
        }

        fn handle_docking_contacts(
            &mut self,
            _entity: Self::Entity,
            _dt: f64,
            _events: &mut Vec<SimulationEvent>,
        ) {
            assert_eq!(self.contact_count, 2);
            self.phases.push("docking");
        }

        fn handle_contacts(
            &mut self,
            _entity: Self::Entity,
            _dt: f64,
            _events: &mut Vec<SimulationEvent>,
        ) {
            self.phases.push("cargo and drill");
        }

        fn clear_contacts(&mut self, _entity: Self::Entity) {
            self.contact_count = 0;
            self.phases.push("clear contacts");
        }

        fn round_motion(&mut self) {
            self.object.round_motion();
            self.phases.push("round motion");
        }
    }

    #[test]
    fn world_step_preserves_gameplay_phase_order_and_tick_count() {
        let catalog = crate::specs::Catalog::load().unwrap();
        let rules = &catalog.simulation;
        let mut world = CollisionOrderWorld {
            object: GameObject::new(17, Default::default(), rules),
            contact_count: 0,
            tick: 311,
            phases: Vec::new(),
        };
        let mut step = WorldStep::default();
        step.update(
            &mut world,
            rules,
            WorldStepOptions {
                ticks: 2,
                ..WorldStepOptions::default()
            },
            &mut Vec::new(),
        );
        assert_eq!(world.tick, 313);
        assert_eq!(
            world.phases,
            [
                "reset biting",
                "control",
                "capture sweep",
                "capture poses",
                "move",
                "collide",
                "projectiles",
                "docking",
                "cargo and drill",
                "clear contacts",
                "round motion"
            ]
        );
    }
}
