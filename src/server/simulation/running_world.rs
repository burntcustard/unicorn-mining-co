use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::sync::Arc;

use smallvec::SmallVec;

use crate::gameplay::collision_world::{
    ColliderPart, CollisionEntity, GameCollisions, GateMotion, ObjectCollider,
    PreparedCollisionBody,
};
use crate::gameplay::game_collisions::{ColliderGeometry, GameplayContact};
use crate::objects::craft::{CargoObject, Craft};
use crate::objects::craft_damage::{CraftDamage, CraftSpawn};
use crate::objects::item::Item;
use crate::objects::modules::WeaponTarget;
use crate::objects::modules::laser::resolve_laser;
use crate::objects::projectile::{
    FractureTarget, ProjectileTarget, ProjectileTargets, WeaponContext, WeaponGeometry,
    WeaponImpact, WeaponWorld,
};
use crate::objects::ship::ShipStep;
use crate::protocol::{Input, SimulationEvent};
use crate::specs::Catalog;
use crate::utilities::OrderedMap;
use crate::utilities::vector::Vector;

use super::asteroid::Asteroid;
use super::asteroid_fracture::{AsteroidFragment, FractureEffect, MinedItem};
use super::game_object::{GameObject, MotionContext, ObjectProperties};
use super::local_movement::MovementParent;
use super::update_tier::{MovementEntity, MovementHandle, MovementWorld, ObserverPlayer};
use super::update_world::{SteppedWorld, WorldIds, WorldStep, WorldStepOptions};
use super::world::{Entity, EntityKind, World};

type Contact = GameplayContact<ObjectCollider>;

pub struct RunningWorld {
    pub world: World,
    tick: WorldStep<i64, Contact>,
    collisions: GameCollisions<ObjectCollider>,
    contacts: HashMap<i64, Vec<Contact>>,
    effects: Effects,
    weapon_geometry: WeaponGeometry,
    weapon_geometry_epoch: u64,
    projectile_ids: Vec<MovementHandle<i64>>,
    projectile_targets: ProjectileTargets,
    movement_parents: Vec<MovementParent>,
    movement_parents_epoch: Option<u64>,
}

impl RunningWorld {
    fn movement_entity(&self, handle: MovementHandle<i64>) -> Option<&Entity> {
        self.world
            .entities
            .get_at(handle.slot, &handle.id)
            .or_else(|| self.world.entity(handle.id))
    }

    pub fn new(seed: f64, catalog: Arc<Catalog>) -> Self {
        Self {
            collisions: GameCollisions::new(&catalog, true),
            world: World::new(seed, catalog),
            tick: WorldStep::default(),
            contacts: HashMap::new(),
            effects: Effects::default(),
            weapon_geometry: WeaponGeometry::default(),
            weapon_geometry_epoch: 0,
            projectile_ids: Vec::new(),
            projectile_targets: ProjectileTargets::default(),
            movement_parents: Vec::new(),
            movement_parents_epoch: None,
        }
    }

    pub fn update(&mut self, options: WorldStepOptions<'_>, events: &mut Vec<SimulationEvent>) {
        let catalog = Arc::clone(&self.world.catalog);
        let mut tick = std::mem::take(&mut self.tick);
        tick.update(self, &catalog.simulation, options, events);
        self.tick = tick;
        self.world.clear_removed_parents();
        let epoch = self.world.entity_epoch();
        if epoch != self.weapon_geometry_epoch {
            self.weapon_geometry
                .retain_awake(|id| self.world.entity(id).map(|entity| entity.incarnation));
            self.weapon_geometry_epoch = epoch;
        }
    }

    #[cfg(target_arch = "x86_64")]
    #[target_feature(enable = "avx")]
    unsafe fn round_motion_avx(&mut self) {
        use crate::utilities::MOTION_ROUND_SCALE;
        use std::arch::x86_64::*;

        const ROUND: i32 = _MM_FROUND_TO_NEAREST_INT | _MM_FROUND_NO_EXC;
        let scale = _mm256_set1_pd(MOTION_ROUND_SCALE);
        let unscale = _mm256_set1_pd(1.0 / MOTION_ROUND_SCALE);
        let angular_scale = _mm_set1_pd(MOTION_ROUND_SCALE);
        let angular_unscale = _mm_set1_pd(1.0 / MOTION_ROUND_SCALE);
        for entity in self.world.entities.values_mut() {
            let object = entity.model.object_mut();
            let linear = _mm256_setr_pd(
                object.position.x,
                object.position.y,
                object.velocity.x,
                object.velocity.y,
            );
            let linear = _mm256_mul_pd(
                _mm256_round_pd::<ROUND>(_mm256_mul_pd(linear, scale)),
                unscale,
            );
            let angular = _mm_setr_pd(object.rotation, object.spin);
            let angular = _mm_mul_pd(
                _mm_round_pd::<ROUND>(_mm_mul_pd(angular, angular_scale)),
                angular_unscale,
            );
            let mut motion = [0.0; 4];
            // SAFETY: motion holds four writable and possibly unaligned floats.
            unsafe { _mm256_storeu_pd(motion.as_mut_ptr(), linear) };
            let [x, y, vx, vy] = motion;
            object.position = Vector::new(x, y);
            object.velocity = Vector::new(vx, vy);
            object.rotation = _mm_cvtsd_f64(angular);
            object.spin = _mm_cvtsd_f64(_mm_unpackhi_pd(angular, angular));
        }
    }

    pub fn prepared_collision_body(
        &self,
        id: i64,
    ) -> Option<PreparedCollisionBody<'_, ObjectCollider>> {
        self.collisions.prepared_body(id)
    }

    fn apply_effects(&mut self) {
        self.effects.apply(&mut self.world);
    }

    fn update_projectile(
        &mut self,
        id: i64,
        events: &mut Vec<SimulationEvent>,
        resolve: Option<Option<WeaponImpact>>,
    ) -> bool {
        let Some(mut entity) = self.world.entities.take_for_update(&id) else {
            return false;
        };
        let EntityKind::Projectile(projectile) = &mut entity.model else {
            self.world.finish_entity_update(id, Some(entity));
            return false;
        };
        let catalog = Arc::clone(&self.world.catalog);
        let mut context = WeaponContext {
            world: &mut self.world,
            geometry: &mut self.weapon_geometry,
            catalog: &catalog,
            events,
        };
        match resolve {
            Some(Some(impact)) => {
                projectile.apply_impact(impact, &mut context);
            }
            Some(None) => {}
            None => projectile.on_death(&mut context),
        }
        self.movement_parents_epoch = None;
        let remove = resolve.is_some() && projectile.object.dead;
        self.world
            .finish_entity_update(id, (!remove).then_some(entity));
        remove
    }
}

impl Effects {
    fn apply(&mut self, world: &mut World) {
        world.ids = self.ids.get();
        for effect in self.changes.get_mut().drain(..) {
            match effect {
                Change::Remove(id) => {
                    world.destroy_entity(id);
                }
                Change::Asteroid(id, fragment) => {
                    let asteroid =
                        Asteroid::from_fragment(id, fragment, &world.catalog, &mut world.outlines);
                    world.add_entity(EntityKind::Asteroid(Box::new(asteroid)), false);
                }
                Change::Mined(id, item) => {
                    let Some(definition) = world.catalog.item_ids.get(item.resource as usize)
                    else {
                        continue;
                    };
                    let properties = ObjectProperties {
                        position: item.motion.position,
                        velocity: item.motion.velocity,
                        rotation: item.motion.rotation,
                        spin: item.motion.spin,
                        ..ObjectProperties::default()
                    };
                    if let Some(mut item) = Item::new(id, definition, properties, &world.catalog) {
                        item.object.mined = true;
                        world.add_entity(EntityKind::Item(Box::new(item)), false);
                    }
                }
            }
        }
    }
}

impl MovementWorld for RunningWorld {
    type Entity = i64;

    fn movement_entities(&self) -> impl Iterator<Item = MovementEntity<'_, i64>> {
        self.world
            .entities
            .indexed_entries()
            .map(|(slot, &id, entity)| MovementEntity {
                handle: MovementHandle { id, slot },
                object: entity.model.object(),
                is_craft: entity.model.craft().is_some(),
                is_parent: matches!(entity.model, EntityKind::Station(_)),
                can_resolve_lasers: matches!(entity.model, EntityKind::Ship(_)),
            })
    }

    fn observer_players(&self) -> impl Iterator<Item = ObserverPlayer<i64>> {
        self.world.players().map(|player| ObserverPlayer {
            ship: Some(player.ship_id),
            range: player.observer_range,
        })
    }

    fn object(&self, entity: MovementHandle<i64>) -> Option<&GameObject> {
        self.movement_entity(entity)
            .map(|entity| entity.model.object())
    }
    fn object_mut(&mut self, entity: MovementHandle<i64>) -> Option<&mut GameObject> {
        self.world
            .entities
            .get_at_or_mut(entity.slot, &entity.id)
            .map(|entity| entity.model.object_mut())
    }
    fn is_craft(&self, entity: i64) -> bool {
        self.world
            .entity(entity)
            .is_some_and(|entity| entity.model.craft().is_some())
    }
    fn is_controlled_ship(&self, entity: i64) -> bool {
        self.world
            .entity(entity)
            .is_some_and(|entity| matches!(entity.model, EntityKind::Ship(_)))
    }

    fn begin_movement(&mut self) {
        self.movement_parents_epoch = None;
    }

    fn update_entity(
        &mut self,
        handle: MovementHandle<i64>,
        duration: f64,
        parents: &[MovementHandle<i64>],
    ) {
        self.begin_movement();
        self.update_scheduled_entity(handle, duration, parents);
    }

    fn update_scheduled_entity(
        &mut self,
        handle: MovementHandle<i64>,
        duration: f64,
        parents: &[MovementHandle<i64>],
    ) {
        let Some(entity) = self.movement_entity(handle) else {
            return;
        };
        let id = handle.id;
        let uses_local_motion = !matches!(
            entity.model,
            EntityKind::Portal(_) | EntityKind::Projectile(_)
        );
        let current_parent = if uses_local_motion {
            entity
                .model
                .object()
                .local_movement
                .parent
                .and_then(|id| self.world.parent(id))
        } else {
            None
        };
        let reference_position = |id| {
            self.world
                .entity(id)
                .map(|entity| entity.model.object().position)
        };
        let (docked_position, portal_position) =
            entity.model.craft().map_or((None, None), |craft| {
                (
                    craft.docked_to.and_then(reference_position),
                    craft.transit_gate.and_then(reference_position),
                )
            });
        let weapon_target = match &entity.model {
            EntityKind::Ship(ship) => ship
                .target_id
                .filter(|&target| target != id)
                .and_then(|target| self.world.entity(target))
                .filter(|target| !target.model.object().dead && !target.model.object().buried)
                .map(|target| {
                    let object = target.model.object();
                    WeaponTarget {
                        position: match &target.model {
                            EntityKind::Ship(ship) => ship.weapon_target_position(),
                            _ => object.position,
                        },
                        velocity: object.velocity,
                    }
                }),
            _ => None,
        };
        let entity_epoch = self.world.entity_epoch();
        if uses_local_motion && self.movement_parents_epoch != Some(entity_epoch) {
            self.movement_parents.clear();
            let world = &self.world;
            self.movement_parents
                .extend(parents.iter().filter_map(|parent| {
                    world
                        .entities
                        .get_at(parent.slot, &parent.id)
                        .and_then(|entity| entity.model.movement_parent())
                        .or_else(|| world.parent(parent.id))
                }));
            self.movement_parents_epoch = Some(entity_epoch);
        }
        let mut movement = MotionContext {
            current_parent,
            parents: if uses_local_motion {
                &self.movement_parents
            } else {
                &[]
            },
            ..MotionContext::default()
        };
        let tick = self.world.tick;
        let mut ids = self.world.ids;
        let mut random = self.world.random;
        let catalog = &self.world.catalog;
        let Some(entity) = self.world.entities.get_at_or_mut(handle.slot, &id) else {
            return;
        };
        let mut released = None;
        let mut aftermath = CraftDamage::default();
        let mut projectiles = SmallVec::new();
        match &mut entity.model {
            EntityKind::Ship(ship) => {
                released = ship.update_cargo_release(duration, tick, catalog, || ids.entity());
                let transiting = ship.craft.transit_time != 0.0;
                ship.advance_flight(
                    duration,
                    ShipStep {
                        movement,
                        tick: Some(tick),
                        docked_position,
                        portal_position,
                    },
                );
                if !transiting {
                    aftermath = ship.resolve_damage(catalog, &mut random, || ids.entity());
                    ship.update_weapon_aim(duration, weapon_target);
                    projectiles = ship.fire_projectiles(duration, catalog, || ids.entity());
                }
            }
            EntityKind::Station(station) => {
                // Later objects in this pass must observe the station's new pose.
                self.movement_parents_epoch = None;
                station.craft.update_modules(duration, 1.0, Some(tick));
                station.craft.object.update(duration, movement);
                aftermath = station
                    .craft
                    .resolve_damage(catalog, &mut random, || ids.entity());
            }
            EntityKind::Craft(craft) => {
                craft.update_modules(duration, 1.0, Some(tick));
                craft.object.update(duration, movement);
                aftermath = craft.resolve_damage(catalog, &mut random, || ids.entity());
            }
            EntityKind::Portal(portal) => {
                portal.update(duration);
            }
            EntityKind::Asteroid(asteroid) => {
                movement.decaying = Some(asteroid.decaying());
                asteroid.object.update(duration, movement);
            }
            EntityKind::Projectile(projectile) => {
                projectile.update(duration);
            }
            model => {
                model.object_mut().update(duration, movement);
            }
        }
        self.world.ids = ids;
        self.world.random = random;
        if aftermath.changed || released.is_some() {
            self.world.mark_entity_changed(id);
        }
        if let Some(item) = released {
            self.world
                .add_entity(EntityKind::Item(Box::new(item)), false);
        }
        for spawn in aftermath.spawns {
            let model = match spawn {
                CraftSpawn::Wreckage(craft) => EntityKind::Craft(craft),
                CraftSpawn::Item(item) => EntityKind::Item(item),
                CraftSpawn::Module { object, module } => EntityKind::Module { object, module },
            };
            self.world.add_entity(model, false);
        }
        for projectile in projectiles {
            self.world
                .add_entity(EntityKind::Projectile(projectile), false);
        }
    }

    fn control(&mut self, id: i64, input: Input, events: &mut Vec<SimulationEvent>) {
        let Some(entity) = self.world.entity(id) else {
            return;
        };
        let EntityKind::Ship(ship) = &entity.model else {
            return;
        };
        let launch_from = input.launch.then_some(ship.craft.docked_to).flatten();
        let world = &mut self.world;
        let launch_bearing = if let Some(Entity {
            model: EntityKind::Station(station),
            ..
        }) = launch_from.and_then(|station| world.entities.get(&station))
        {
            station.launch_bearing(|| world.random.next_float())
        } else {
            None
        };
        if let Some(Entity {
            model: EntityKind::Ship(ship),
            ..
        }) = world.entity_mut(id)
        {
            ship.control(input, launch_bearing, events);
        }
        if input.launch
            && let Some(Entity {
                model: EntityKind::Station(station),
                ..
            }) = launch_from.and_then(|station| world.entity_mut(station))
        {
            station.end_trade_visit(id);
        }
    }

    fn remove(&mut self, entity: i64) {
        self.world.destroy_entity(entity);
        self.contacts.remove(&entity);
        self.weapon_geometry.remove(entity);
    }

    fn on_death(&mut self, id: i64, events: &mut Vec<SimulationEvent>) {
        if self
            .world
            .entity(id)
            .is_some_and(|entity| matches!(entity.model, EntityKind::Projectile(_)))
        {
            self.update_projectile(id, events, None);
        }
    }

    fn death_event(&self, id: i64) -> Option<SimulationEvent> {
        match &self.world.entity(id)?.model {
            EntityKind::Projectile(projectile) => projectile.death_event(),
            _ => None,
        }
    }

    fn resolve_lasers(&mut self, id: i64, duration: f64, events: &mut Vec<SimulationEvent>) {
        let Some(Entity {
            model: EntityKind::Ship(ship),
            ..
        }) = self.world.entity(id)
        else {
            return;
        };
        let beams = ship.laser_beams().collect::<SmallVec<[_; 16]>>();
        if beams.is_empty() {
            return;
        }
        let catalog = Arc::clone(&self.world.catalog);
        let mut context = WeaponContext {
            world: &mut self.world,
            geometry: &mut self.weapon_geometry,
            events,
            catalog: &catalog,
        };
        for beam in beams {
            resolve_laser(beam, duration, &mut context);
        }
        self.movement_parents_epoch = None;
    }
}

impl SteppedWorld for RunningWorld {
    type Contact = Contact;

    fn tick(&self) -> u64 {
        self.world.tick
    }
    fn set_tick(&mut self, tick: u64) {
        self.world.tick = tick;
    }
    fn players_in_order(&self) -> impl Iterator<Item = (i64, i64)> {
        self.world
            .players()
            .map(|player| (player.player_number, player.ship_id))
    }

    fn reset_biting(&mut self) {
        for entity in self.world.entities.values_mut() {
            let EntityKind::Ship(ship) = &mut entity.model else {
                continue;
            };
            for module in ship
                .craft
                .mounts
                .iter_mut()
                .filter_map(|mount| mount.module.as_mut())
            {
                for part in &mut module.parts {
                    part.biting = false;
                }
            }
        }
    }

    fn capture_projectile_sweeps(&mut self) {
        for entity in self.world.entities.values_mut() {
            if let EntityKind::Projectile(projectile) = &mut entity.model {
                projectile.capture_sweep();
            }
        }
    }

    fn capture_collision_poses(&mut self) {
        self.collisions
            .capture_poses(self.world.entities.values_mut());
    }

    fn round_motion(&mut self) {
        #[cfg(target_arch = "x86_64")]
        if std::arch::is_x86_feature_detected!("avx") {
            // SAFETY: AVX support is checked before entering the loop.
            return unsafe { self.round_motion_avx() };
        }
        for entity in self.world.entities.values_mut() {
            entity.model.object_mut().round_motion();
        }
    }

    fn collide(&mut self, dt: f64, events: &mut Vec<SimulationEvent>, contacts: &mut Vec<Contact>) {
        self.effects.ids.set(self.world.ids);
        let catalog = &self.world.catalog;
        let mut entities = Vec::with_capacity(self.world.entities.len());
        entities.extend(
            self.world
                .entities
                .values_mut()
                .map(|entity| CollisionObject {
                    entity,
                    catalog,
                    effects: &self.effects,
                }),
        );
        contacts.extend_from_slice(self.collisions.step(&mut entities, dt, catalog, events));
        self.apply_effects();
    }

    fn resolve_projectile_hits(&mut self, dt: f64, events: &mut Vec<SimulationEvent>) {
        let mut projectiles = std::mem::take(&mut self.projectile_ids);
        projectiles.extend(self.world.entities.indexed_entries().filter_map(
            |(slot, &id, entity)| {
                matches!(entity.model, EntityKind::Projectile(_))
                    .then_some(MovementHandle { id, slot })
            },
        ));
        let linear_slop = self.world.catalog.simulation.linear_slop;
        let traces = projectiles.len();
        let mut use_cache = traces >= 4;
        if use_cache {
            self.projectile_targets.rebuild(
                self.world.entities().map(CollisionEntity::object),
                dt,
                traces,
            );
        }
        for MovementHandle { id, slot } in projectiles.drain(..) {
            let Some(Entity {
                model: EntityKind::Projectile(projectile),
                ..
            }) = self
                .world
                .entities
                .get_at(slot, &id)
                .or_else(|| self.world.entity(id))
            else {
                continue;
            };
            let impact = projectile.trace_impact(
                dt,
                &self.world,
                use_cache.then_some(&mut self.projectile_targets),
                &mut self.weapon_geometry,
                linear_slop,
            );
            if impact.is_some() || projectile.object.dead {
                let physical = impact.filter(|impact| use_cache && impact.physical);
                let previous_target = physical
                    .filter(|_| projectile.spec.explosion.is_none())
                    .and_then(|impact| self.world.entity(impact.collider.owner))
                    .and_then(|entity| ProjectileTarget::new(entity.object(), Some(dt)));
                let epoch = self.world.entity_epoch();
                let removed = self.update_projectile(id, events, Some(impact));

                // A nonphysical hit only removes the projectile. A nonexplosive
                // physical hit can preserve the index if it leaves all target
                // membership and the affected target's reach unchanged. The trace
                // itself always reads the current colliders.
                if let Some(impact) = physical {
                    use_cache = self.world.entity_epoch() == epoch.wrapping_add(u64::from(removed))
                        && previous_target.is_some_and(|previous| {
                            self.world
                                .entity(impact.collider.owner)
                                .and_then(|entity| ProjectileTarget::new(entity.object(), Some(dt)))
                                == Some(previous)
                        });
                }
            }
        }
        self.projectile_ids = projectiles;
    }

    fn contact_owners(contact: &Contact) -> [Option<i64>; 2] {
        [Some(contact.collider.owner), Some(contact.other.owner)]
    }

    fn queue_contact(&mut self, entity: i64, contact: &Contact) -> bool {
        if !self.is_craft(entity) {
            return false;
        }
        let contacts = self.contacts.entry(entity).or_default();
        let first = contacts.is_empty();
        contacts.push(*contact);
        first
    }

    fn handle_docking_contacts(
        &mut self,
        entity: i64,
        _dt: f64,
        events: &mut Vec<SimulationEvent>,
    ) {
        let Some(contacts) = self.contacts.get(&entity) else {
            return;
        };
        for contact in contacts {
            let (bay, other) = own_contact(entity, contact);
            if !bay.dock_segment {
                continue;
            }
            if let Some((
                docking,
                Entity {
                    model: EntityKind::Ship(ship),
                    ..
                },
            )) = self.world.entities.get_pair_mut(&entity, &other.owner)
                && let Some(craft) = docking.model.craft()
            {
                ship.dock_at(craft, events);
            }
        }
    }

    fn handle_contacts(&mut self, id: i64, dt: f64, events: &mut Vec<SimulationEvent>) {
        let Some(mut contacts) = self.contacts.remove(&id) else {
            return;
        };
        if self.is_controlled_ship(id) {
            let mut drills: OrderedMap<(usize, usize), (f64, ObjectCollider, Vector)> =
                OrderedMap::default();
            for contact in &contacts {
                let (own, target) = own_contact(id, contact);
                if own.catches && target.part == ColliderPart::PickupPoint {
                    self.collect(id, target.owner, events);
                }
                if let ColliderPart::DrillTip { mount, model_part } = own.part {
                    let key = (mount, model_part);
                    if drills
                        .get(&key)
                        .is_none_or(|(depth, _, _)| contact.depth > *depth)
                    {
                        drills.set(key, (contact.depth, target, contact.point));
                    }
                }
            }
            for (&(mount, model_part), &(_, target, position)) in drills.iter() {
                self.drill(id, (mount, model_part), target, position, (dt, events));
            }
        }
        contacts.clear();
        self.contacts.insert(id, contacts);
    }

    fn clear_contacts(&mut self, id: i64) {
        if let Some(contacts) = self.contacts.get_mut(&id) {
            contacts.clear();
        }
    }
}

impl RunningWorld {
    fn collect(&mut self, ship_id: i64, item_id: i64, events: &mut Vec<SimulationEvent>) {
        let Some(Entity {
            model: EntityKind::Ship(ship),
            ..
        }) = self.world.entity(ship_id)
        else {
            return;
        };
        let Some(player_number) = ship.craft.object.player_number else {
            return;
        };
        let Some(entity) = self.world.entity(item_id) else {
            return;
        };
        let object = entity.model.object();
        if !object.item
            || !matches!(
                entity.model,
                EntityKind::Item(_) | EntityKind::Module { .. }
            )
        {
            return;
        }
        let pickup_cooldown =
            object.dropped_by == Some(player_number) && self.world.tick < object.pickup_after;
        let hatch_active = ship.craft.mounts.iter().any(|mount| {
            mount.health >= 1.0
                && mount.module.as_ref().is_some_and(|module| {
                    module.spec.behavior == "cargoHatch"
                        && module.parts.iter().any(|part| part.active != 0.0)
                })
        });
        if pickup_cooldown
            || !hatch_active
            || object.dead
            || (object.message.is_none() && ship.craft.cargo_contents.len() >= ship.cargo_space)
        {
            return;
        }
        let collected = SimulationEvent::ItemCollected {
            by: player_number,
            item_id,
            resource: object.resource.unwrap_or(0),
            message: object.message.clone(),
            unlock: object.message.as_ref().map(|_| object.unlock.clone()),
        };
        let keep = object.message.is_none();
        if let Some(entity) = self.world.remove_entity(item_id)
            && keep
            && let Some(Entity {
                model: EntityKind::Ship(ship),
                ..
            }) = self.world.entity_mut(ship_id)
        {
            match entity.model {
                EntityKind::Item(mut item) => {
                    item.object.dead = true;
                    ship.craft.cargo_contents.push(CargoObject::Item(item));
                }
                EntityKind::Module { module, .. } => {
                    ship.craft.cargo_contents.push(CargoObject::Module(module))
                }
                _ => {}
            }
            self.world.mark_entity_changed(ship_id);
        }
        events.push(collected);
    }

    fn drill(
        &mut self,
        ship_id: i64,
        drill: (usize, usize),
        target: ObjectCollider,
        position: Vector,
        (dt, events): (f64, &mut Vec<SimulationEvent>),
    ) {
        let catalog = &self.world.catalog;
        self.effects.ids.set(self.world.ids);
        let Some((
            Entity {
                model: EntityKind::Ship(ship),
                ..
            },
            target_entity,
        )) = self.world.entities.get_pair_mut(&ship_id, &target.owner)
        else {
            return;
        };
        let Some(player_number) = ship.craft.object.player_number else {
            return;
        };
        let Some(module) = ship
            .craft
            .mounts
            .get_mut(drill.0)
            .and_then(|mount| mount.module.as_mut())
        else {
            return;
        };
        let Some(part) = module.parts.get_mut(drill.1) else {
            return;
        };
        let spec = &module.spec;
        if part.activation_progress <= spec.activation_threshold
            || target_entity.model.object().dead
        {
            return;
        }
        let steps = dt * spec.damage_steps_per_second;
        let damage = spec.damage * steps;
        let mut victim = CollisionObject {
            entity: target_entity,
            catalog,
            effects: &self.effects,
        };
        let color = victim.outline_color(target, &catalog.colors).to_owned();
        let mut resource = None;
        let mut fracture = None;
        if let EntityKind::Asteroid(asteroid) = &mut victim.entity.model {
            let segment = match target.part {
                ColliderPart::AsteroidSegment(index) => Some(index),
                _ => None,
            };
            if asteroid.damage_segment(segment, damage) <= 0.0 {
                return;
            }
            let ship_object = &mut ship.craft.object;
            let pull = (asteroid.object.position - ship_object.position).normalized();
            let factor = 1.0 - spec.grip_decay.powf(steps);
            ship_object.velocity += (asteroid.object.velocity - ship_object.velocity) * factor
                + pull * (factor / spec.grip_scale);
            resource = asteroid.object.resource;
            fracture = asteroid.fracture_after_damage(segment, catalog);
        } else {
            let before = target_health(&victim.entity.model, target.part);
            if before.is_nan() || before <= 0.0 {
                return;
            }
            victim.damage(target, damage, player_number, events);
            let after = target_health(&victim.entity.model, target.part);
            if after >= before {
                return;
            }
        }
        part.biting = true;
        events.push(SimulationEvent::DrillDamage {
            target_id: target.owner,
            by: player_number,
            damage,
            color,
            resource,
            position,
        });
        if let Some(fracture) = fracture
            && let EntityKind::Asteroid(asteroid) = &victim.entity.model
        {
            self.effects
                .fracture(asteroid, fracture, player_number, events);
            ship.craft.object.velocity = asteroid.object.velocity;
        }
        self.apply_effects();
    }
}

fn target_health(model: &EntityKind, part: ColliderPart) -> f64 {
    match (model.craft(), part) {
        (Some(craft), ColliderPart::Hull(index)) => {
            craft.hulls.get(index).map_or(f64::NAN, |hull| hull.health)
        }
        (
            Some(craft),
            ColliderPart::Module { mount, .. } | ColliderPart::DrillTip { mount, .. },
        ) => craft
            .mounts
            .get(mount)
            .map_or(f64::NAN, |mount| mount.health),
        _ => model.object().health,
    }
}

fn own_contact(id: i64, contact: &Contact) -> (ObjectCollider, ObjectCollider) {
    let Contact {
        collider, other, ..
    } = *contact;
    if collider.owner == id {
        (collider, other)
    } else {
        (other, collider)
    }
}

enum Change {
    Remove(i64),
    Asteroid(i64, AsteroidFragment),
    Mined(i64, MinedItem),
}

#[derive(Default)]
struct Effects {
    ids: Cell<WorldIds>,
    changes: RefCell<Vec<Change>>,
}

impl Effects {
    fn fracture(
        &self,
        asteroid: &Asteroid,
        fracture: FractureEffect,
        by: i64,
        events: &mut Vec<SimulationEvent>,
    ) {
        let id = asteroid.object.id;
        let mut ids = self.ids.get();
        let mut changes = self.changes.borrow_mut();
        changes.push(Change::Remove(id));
        match fracture {
            FractureEffect::Split(children) => {
                let child_ids = children
                    .into_iter()
                    .map(|child| {
                        let id = ids.entity();
                        changes.push(Change::Asteroid(id, child));
                        id
                    })
                    .collect();
                events.push(SimulationEvent::AsteroidSplit {
                    asteroid_id: id,
                    child_ids,
                });
            }
            FractureEffect::Destroyed { drops, debris } => {
                changes.extend(
                    drops
                        .into_iter()
                        .map(|item| Change::Mined(ids.entity(), item)),
                );
                changes.extend(
                    debris
                        .into_iter()
                        .map(|part| Change::Asteroid(ids.entity(), part)),
                );
                events.push(SimulationEvent::AsteroidDestroyed {
                    asteroid_id: id,
                    by,
                    contents: asteroid.contents.clone(),
                });
            }
        }
        self.ids.set(ids);
    }
}

struct CollisionObject<'a> {
    entity: &'a mut Entity,
    catalog: &'a Catalog,
    effects: &'a Effects,
}

impl CollisionEntity for CollisionObject<'_> {
    type Collider = ObjectCollider;

    fn object(&self) -> &GameObject {
        self.entity.model.object()
    }
    fn object_mut(&mut self) -> &mut GameObject {
        self.entity.model.object_mut()
    }
    fn collision_incarnation(&self) -> u64 {
        self.entity.incarnation
    }

    fn collision_geometry_source(&self) -> Option<u64> {
        match &self.entity.model {
            EntityKind::Asteroid(asteroid) => asteroid.geometry_revision(),
            EntityKind::Portal(portal) => portal.collision_geometry_source(),
            model => model
                .craft()
                .and_then(|craft| craft.tracked_collision_source()),
        }
    }

    fn deferred_collision_extent(&self) -> Option<f64> {
        match &self.entity.model {
            EntityKind::Asteroid(asteroid) => asteroid.deferred_extent(),
            _ => None,
        }
    }

    fn gate_motion(&self) -> Option<GateMotion> {
        self.entity.gate_motion()
    }

    fn with_colliders(&self, visit: impl FnOnce(&[ColliderGeometry<'_, ObjectCollider>])) {
        self.entity.with_colliders(visit);
    }

    fn damage(
        &mut self,
        target: ObjectCollider,
        amount: f64,
        by: i64,
        events: &mut Vec<SimulationEvent>,
    ) -> f64 {
        let applied = self.entity.damage(target, amount, by, events);
        if let EntityKind::Asteroid(asteroid) = &mut self.entity.model {
            if let Some(fracture) =
                asteroid.fracture_after_damage(asteroid_index(target), self.catalog)
            {
                self.effects.fracture(asteroid, fracture, by, events);
            }
        } else if self.object().dead {
            self.effects
                .changes
                .borrow_mut()
                .push(Change::Remove(self.object().id));
        }
        applied
    }

    fn shield_contact(&self, collider: ObjectCollider) -> bool {
        self.entity
            .model
            .craft()
            .is_some_and(|craft| craft.shield_contact(collider))
    }

    fn crush_target(&self, collider: ObjectCollider) -> i64 {
        self.entity
            .model
            .craft()
            .map_or(self.object().id, |craft| craft.crush_target(collider))
    }

    fn outline_color<'a>(
        &'a self,
        collider: ObjectCollider,
        colors: &'a HashMap<String, Vec<String>>,
    ) -> &'a str {
        self.entity.outline_color(collider, colors)
    }
}

impl CollisionEntity for Entity {
    type Collider = ObjectCollider;

    fn object(&self) -> &GameObject {
        self.model.object()
    }
    fn object_mut(&mut self) -> &mut GameObject {
        self.model.object_mut()
    }
    fn collision_incarnation(&self) -> u64 {
        self.incarnation
    }

    fn gate_motion(&self) -> Option<GateMotion> {
        match &self.model {
            EntityKind::Portal(portal) => portal.gate_motion(),
            _ => None,
        }
    }

    fn with_colliders(&self, visit: impl FnOnce(&[ColliderGeometry<'_, ObjectCollider>])) {
        match &self.model {
            EntityKind::Object(object) => object.with_colliders(visit),
            EntityKind::Ship(ship) => ship.with_colliders(visit),
            EntityKind::Station(station) => station.with_colliders(visit),
            EntityKind::Craft(craft) => craft.with_colliders(visit),
            EntityKind::Portal(portal) => portal.with_colliders(visit),
            EntityKind::Item(item) => item.with_colliders(visit),
            EntityKind::Module { object, .. } => {
                object.with_colliders(|colliders| {
                    if let Some(hitbox) = colliders.first() {
                        let pickup = ColliderGeometry {
                            radius: 0.0,
                            outline: None,
                            collision_margin: None,
                            physical: false,
                            pickup_point: true,
                            user_data: ObjectCollider {
                                part: ColliderPart::PickupPoint,
                                ..hitbox.user_data
                            },
                            ..*hitbox
                        };
                        visit(&[*hitbox, pickup]);
                    } else {
                        visit(&[]);
                    }
                });
            }
            EntityKind::Asteroid(asteroid) => asteroid.with_colliders(visit),
            EntityKind::Projectile(projectile) => projectile.with_colliders(visit),
        }
    }

    fn visit_colliders(&self, mut visit: impl FnMut(usize, ColliderGeometry<'_, ObjectCollider>)) {
        if let EntityKind::Asteroid(asteroid) = &self.model {
            asteroid.visit_colliders(visit);
        } else {
            self.with_colliders(|colliders| {
                for (index, &collider) in colliders.iter().enumerate() {
                    visit(index, collider);
                }
            });
        }
    }

    fn damage(
        &mut self,
        target: ObjectCollider,
        amount: f64,
        by: i64,
        events: &mut Vec<SimulationEvent>,
    ) -> f64 {
        match &mut self.model {
            EntityKind::Ship(ship) => ship.damage(target, amount, by, events),
            EntityKind::Station(station) => station.damage(target, amount, by, events),
            EntityKind::Craft(craft) => craft.damage(target, amount, by, events),
            EntityKind::Portal(portal) => portal.damage(target, amount, by, events),
            EntityKind::Asteroid(asteroid) => {
                asteroid.damage_segment(asteroid_index(target), amount)
            }
            model => model.object_mut().damage(target, amount, by, events),
        }
    }

    fn outline_color<'a>(
        &'a self,
        collider: ObjectCollider,
        colors: &'a HashMap<String, Vec<String>>,
    ) -> &'a str {
        self.model.craft().map_or_else(
            || self.object().outline_color(collider, colors),
            |craft| craft.outline_color(collider, colors),
        )
    }
}

fn asteroid_index(collider: ObjectCollider) -> Option<usize> {
    match collider.part {
        ColliderPart::AsteroidSegment(index) => Some(index),
        _ => None,
    }
}

impl WeaponWorld for World {
    type Entity = Entity;

    fn weapon_targets(&self) -> impl Iterator<Item = &Entity> {
        self.entities()
    }
    fn weapon_target(&self, id: i64) -> Option<&Entity> {
        self.entity(id)
    }
    fn weapon_target_mut(&mut self, id: i64) -> Option<&mut Entity> {
        self.entity_mut(id)
    }
    fn for_each_weapon_target_mut(&mut self, visit: impl FnMut(&mut Entity)) {
        self.entities.values_mut().for_each(visit);
    }

    fn weapon_target_is_wreckage(&self, entity: &Entity) -> bool {
        entity.model.craft().is_some_and(Craft::is_wreckage)
    }

    fn damage_weapon_target(
        &mut self,
        target: ObjectCollider,
        amount: f64,
        by: i64,
        events: &mut Vec<SimulationEvent>,
    ) -> f64 {
        let Some(entity) = self.entity_mut(target.owner) else {
            return 0.0;
        };
        let applied = entity.damage(target, amount, by, events);
        if entity.object().dead {
            self.destroy_entity(target.owner);
        }
        applied
    }

    fn fracture_asteroid(
        &mut self,
        id: i64,
        target: FractureTarget,
        by: i64,
        catalog: &Catalog,
        events: &mut Vec<SimulationEvent>,
    ) {
        let mut effects = Effects {
            ids: Cell::new(self.ids),
            ..Effects::default()
        };
        let Some(Entity {
            model: EntityKind::Asteroid(asteroid),
            ..
        }) = self.entity_mut(id)
        else {
            return;
        };
        let target = match target {
            FractureTarget::Direct(target) => target,
            FractureTarget::FirstDamaged => asteroid.first_broken_segment(),
        };
        if let Some(fracture) = asteroid.fracture_after_damage(target, catalog) {
            effects.fracture(asteroid, fracture, by, events);
            effects.apply(self);
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::objects::station::Station;
    use crate::test_fixtures::load_example_catalog;

    use super::*;

    #[test]
    fn projectile_blast_updates_reach_for_following_shots() {
        use crate::objects::projectile::Projectile;

        let catalog = Arc::new(load_example_catalog().unwrap());
        let mut simulation = RunningWorld::new(25.0, Arc::clone(&catalog));
        for (id, x, radius, mass) in [(20, 40.0, 5.0, 1e15), (21, 50.0, 2.0, 1.0)] {
            let target = GameObject::new(
                id,
                ObjectProperties {
                    position: Vector::new(x, 0.0),
                    radius: Some(radius),
                    mass: Some(mass),
                    health: Some(100.0),
                    ..Default::default()
                },
                &catalog.simulation,
            );
            simulation
                .world
                .add_entity(EntityKind::Object(Box::new(target)), false);
        }

        for (id, weapon, start, end) in [
            (
                30,
                "plasmaAccelerator",
                Vector::ZERO,
                Vector::new(48.0, 0.0),
            ),
            (
                31,
                "autogun",
                Vector::new(-20.0, 0.0),
                Vector::new(-10.0, 0.0),
            ),
            (
                32,
                "autogun",
                Vector::new(-20.0, 1_000.0),
                Vector::new(-10.0, 1_000.0),
            ),
            (
                33,
                "autogun",
                Vector::new(-20.0, 2_000.0),
                Vector::new(-10.0, 2_000.0),
            ),
        ] {
            let mut projectile = Projectile::new(
                id,
                weapon,
                ObjectProperties {
                    position: end,
                    ..Default::default()
                },
                &catalog,
            )
            .unwrap();
            projectile.sweep_start = start;
            if let Some(explosion) = &mut projectile.spec.explosion {
                explosion.radius = 40.0;
                explosion.impulse = 250.0;
                explosion.max_speed = 0.0;
                explosion.damage = 0.0;
            }
            simulation
                .world
                .add_entity(EntityKind::Projectile(Box::new(projectile)), false);
        }

        let mut events = Vec::new();
        simulation.resolve_projectile_hits(1.0, &mut events);
        let impacts: Vec<_> = events
            .iter()
            .filter_map(|event| match event {
                SimulationEvent::CollisionEvent { a, b, .. } => Some((*a, *b)),
                _ => None,
            })
            .collect();
        assert_eq!(impacts, [(30, 20), (31, 21)]);
    }

    #[test]
    fn movement_after_a_station_update_uses_its_new_position() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let mut running = RunningWorld::new(25.0, Arc::clone(&catalog));
        let mut station = Station::new(
            2,
            "corral-5",
            ObjectProperties {
                velocity: Vector::new(20.0, 0.0),
                ..ObjectProperties::default()
            },
            Some(Vec::new()),
            &catalog,
            || unreachable!(),
        )
        .unwrap();
        station.local_movement_radius = 0.125;
        for id in [1, 3] {
            let object = GameObject::new(id, ObjectProperties::default(), &catalog.simulation);
            running
                .world
                .add_entity(EntityKind::Object(Box::new(object)), false);
        }
        running
            .world
            .add_entity(EntityKind::Station(Box::new(station)), false);
        let first = MovementHandle::by_id(1);
        let parents = [MovementHandle::by_id(2)];
        let last = MovementHandle::by_id(3);

        running.begin_movement();
        running.update_scheduled_entity(first, 0.1, &parents);
        running.update_scheduled_entity(parents[0], 0.1, &parents);
        running.update_scheduled_entity(last, 0.1, &parents);

        assert_eq!(
            running.object(first).unwrap().local_movement.parent,
            Some(2)
        );
        assert_eq!(running.object(last).unwrap().local_movement.parent, None);
    }
}
