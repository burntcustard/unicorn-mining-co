//! Tick ordering for gameplay collisions, including free motion and impact effects.

use hashbrown::{HashMap, HashSet};

use crate::physics::{Body, BodyId, Fixture, FixtureId, PhysicsRules, World};
use crate::protocol::SimulationEvent;
use crate::simulation::game_object::{GameObject, ObjectHitbox};
use crate::specs::Catalog;
use crate::utilities::OrderedMap;
use crate::utilities::vector::Vector;
use crate::utilities::vector_math::RotValue;

use super::game_collisions::{
    BodyMotion, ColliderGeometry, ColliderMaterial, CollisionGeometry, FreeMotion,
    GameplayCollider, GameplayContact, GameplayContacts, GeometryPose, Pose, gate_panel_speed,
    impact_damage, integrate_parked,
};

#[derive(Clone, Copy, Debug)]
pub struct GateMotion {
    pub opening: f64,
    pub half_travel: f64,
    pub crush_damage: f64,
}

pub trait CollisionEntity {
    type Collider: GameplayCollider;

    fn object(&self) -> &GameObject;
    fn object_mut(&mut self) -> &mut GameObject;

    /// Distinguish a new object reusing the same entity ID from the previous object.
    fn collision_incarnation(&self) -> u64 {
        0
    }

    fn collision_geometry_source(&self) -> Option<u64> {
        None
    }

    /// Give the conservative reach of asteroid geometry before materializing its fixtures.
    fn deferred_collision_extent(&self) -> Option<f64> {
        None
    }

    fn gate_motion(&self) -> Option<GateMotion> {
        None
    }

    fn with_colliders(&self, use_colliders: impl FnOnce(&[ColliderGeometry<'_, Self::Collider>]));

    fn visit_colliders(&self, mut visit: impl FnMut(usize, ColliderGeometry<'_, Self::Collider>)) {
        self.with_colliders(|colliders| {
            for (index, &collider) in colliders.iter().enumerate() {
                visit(index, collider);
            }
        });
    }

    fn damage(
        &mut self,
        _target: Self::Collider,
        amount: f64,
        _by: i64,
        _events: &mut Vec<SimulationEvent>,
    ) -> f64 {
        let object = self.object_mut();
        if object.health <= 0.0 || object.health.is_nan() {
            return 0.0;
        }
        object.health -= amount;
        if object.health < 1.0 && object.item {
            object.dead = true;
        }
        amount
    }

    fn shield_contact(&self, _collider: Self::Collider) -> bool {
        false
    }

    /// Return the segment or mount receiving crushing damage, with object-wide damage by default.
    fn crush_target(&self, _collider: Self::Collider) -> i64 {
        self.object().id
    }

    fn outline_color<'a>(
        &'a self,
        _collider: Self::Collider,
        colors: &'a std::collections::HashMap<String, Vec<String>>,
    ) -> &'a str {
        let white = colors["white"][2].as_str();
        let object = self.object();
        if object.kind == "asteroid" {
            if object.resource == Some(1) {
                colors["violet"][2].as_str()
            } else {
                white
            }
        } else {
            object
                .shades
                .as_ref()
                .and_then(|shades| shades.get(2))
                .filter(|shade| !shade.is_empty())
                .map_or(white, String::as_str)
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ColliderPart {
    Body,
    Hull(usize),
    Module { mount: usize, model_part: usize },
    DrillTip { mount: usize, model_part: usize },
    AsteroidSegment(usize),
    GatePanel(usize),
    PickupPoint,
}

#[derive(Clone, Copy, Debug)]
pub struct ObjectCollider {
    pub owner: i64,
    pub part: ColliderPart,
    pub dock_segment: bool,
    pub catches: bool,
    pub material: ColliderMaterial,
}

impl GameplayCollider for ObjectCollider {
    fn owner(self) -> i64 {
        self.owner
    }

    fn material(self) -> ColliderMaterial {
        self.material
    }

    fn can_contact(self, other: Self) -> bool {
        (!(self.part == ColliderPart::PickupPoint || self.catches))
            || self.cargo_contact_allowed(other)
    }
}

impl ObjectCollider {
    pub fn cargo_contact_allowed(self, other: Self) -> bool {
        self.part == ColliderPart::PickupPoint && other.catches
            || self.catches && other.part == ColliderPart::PickupPoint
    }
}

impl CollisionEntity for GameObject {
    type Collider = ObjectCollider;

    fn object(&self) -> &GameObject {
        self
    }

    fn object_mut(&mut self) -> &mut GameObject {
        self
    }

    fn with_colliders(&self, use_colliders: impl FnOnce(&[ColliderGeometry<'_, Self::Collider>])) {
        let Some(ObjectHitbox {
            owner,
            position,
            rotation,
            radius,
            outline,
            friction,
            bounciness,
            physics,
        }) = self.hitbox()
        else {
            use_colliders(&[]);
            return;
        };
        let collider = ColliderGeometry {
            pose: Pose { position, rotation },
            radius,
            collision_margin: None,
            outline,
            collides: true,
            physical: physics,
            pickup_point: false,
            catches: false,
            user_data: ObjectCollider {
                owner,
                part: ColliderPart::Body,
                dock_segment: false,
                catches: false,
                material: ColliderMaterial {
                    friction,
                    bounciness: bounciness.unwrap_or(0.0),
                    speed: 0.0,
                    gate_panel: None,
                },
            },
        };
        use_colliders(&[collider]);
    }
}

#[derive(Clone, Copy)]
struct Motion {
    entity_index: usize,
    body: BodyId,
    deferred: bool,
    parked: bool,
    start: Pose,
    velocity: Vector,
    spin: f64,
}

struct BodyRecord {
    id: i64,
    incarnation: u64,
    geometry: CollisionGeometry,
    previous: Pose,
    opening: f64,
    deferred_source: Option<u64>,
}

pub struct GameCollisions<C: GameplayCollider> {
    world: World<C>,
    bodies: OrderedMap<i64, BodyRecord>,
    free: FreeMotion,
    motions: Vec<Motion>,
    record_slots: Vec<usize>,
    bounds: Vec<BodyMotion>,
    live_ids: Vec<i64>,
    live_indices: HashMap<i64, usize>,
    dead_ids: Vec<i64>,
    contacts: GameplayContacts<C>,
}

pub struct PreparedCollisionBody<'a, T> {
    pub body: &'a Body,
    pub radius: f64,
    world: &'a World<T>,
    fixtures: &'a [FixtureId],
}

impl<T> PreparedCollisionBody<'_, T> {
    pub fn fixtures(&self) -> impl Iterator<Item = &Fixture<T>> {
        self.fixtures
            .iter()
            .map(|&id| self.world.fixture(id).expect("prepared fixture is live"))
    }
}

impl<C: GameplayCollider> GameCollisions<C> {
    pub fn new(catalog: &Catalog, limit_neighbors: bool) -> Self {
        let rules = PhysicsRules::from(&catalog.simulation);
        let mut world = World::new(rules);
        world.limit_collision_neighbors = limit_neighbors;
        Self {
            world,
            bodies: OrderedMap::default(),
            free: FreeMotion::default(),
            motions: Vec::new(),
            record_slots: Vec::new(),
            bounds: Vec::new(),
            live_ids: Vec::new(),
            live_indices: HashMap::new(),
            dead_ids: Vec::new(),
            contacts: GameplayContacts::new(rules.contact_speed_threshold),
        }
    }

    pub fn prepared_body(&self, entity_id: i64) -> Option<PreparedCollisionBody<'_, C>> {
        let record = self.bodies.get(&entity_id)?;
        if record.deferred_source.is_some() {
            return None;
        }
        let body = self.world.body(record.geometry.body)?;
        Some(PreparedCollisionBody {
            body,
            radius: record.geometry.radius,
            world: &self.world,
            fixtures: &record.geometry.fixtures,
        })
    }

    fn record_for<'a, E: CollisionEntity<Collider = C>>(
        world: &mut World<C>,
        bodies: &'a mut OrderedMap<i64, BodyRecord>,
        entity: &E,
        slot_hint: &mut usize,
    ) -> &'a mut BodyRecord {
        let object = entity.object();
        let id = object.id;
        let incarnation = entity.collision_incarnation();
        let hinted = bodies
            .get_at(*slot_hint, &id)
            .map(|record| (*slot_hint, record));
        if let Some((slot, record)) = hinted.or_else(|| bodies.get_indexed(&id))
            && record.incarnation == incarnation
        {
            *slot_hint = slot;
            return bodies
                .get_at_mut(slot, &id)
                .expect("collision record still occupies its slot");
        }
        if let Some(record) = bodies.remove(&id) {
            world.destroy_body(record.geometry.body);
        }
        let body = world.create_body();
        bodies.set(
            id,
            BodyRecord {
                id,
                incarnation,
                geometry: CollisionGeometry::new(body),
                previous: Pose {
                    position: object.position,
                    rotation: object.rotation,
                },
                opening: entity.gate_motion().map_or(0.0, |gate| gate.opening),
                deferred_source: None,
            },
        );
        *slot_hint = bodies.slot(&id).expect("collision record just created");
        bodies
            .get_at_mut(*slot_hint, &id)
            .expect("collision record just created")
    }

    pub fn capture_poses<'a, E: CollisionEntity<Collider = C> + 'a>(
        &mut self,
        entities: impl IntoIterator<Item = &'a mut E>,
    ) {
        let mut slots = self.record_slots.iter_mut();
        let mut uncached = usize::MAX;
        for entity in entities {
            let slot = slots.next().unwrap_or(&mut uncached);
            let object = entity.object_mut();
            if object.inactive_physics {
                object.ballistic = true;
                continue;
            }
            let pose = Pose {
                position: object.position,
                rotation: object.rotation,
            };
            object.rotation_jump = 0.0;
            Self::record_for(&mut self.world, &mut self.bodies, entity, slot).previous = pose;
        }
    }

    fn synchronize_geometry<E: CollisionEntity<Collider = C>>(
        world: &mut World<C>,
        record: &mut BodyRecord,
        entity: &E,
    ) {
        let pose = geometry_pose(entity);
        if let Some(source) = pose.source
            && let Some(extent) = entity.deferred_collision_extent()
        {
            if record.deferred_source == Some(source) {
                return;
            }
            if record
                .geometry
                .defer_asteroid(source, extent, world.rules.linear_slop)
            {
                record.deferred_source = Some(source);
                return;
            }
        }
        record.deferred_source = None;
        synchronize_geometry(world, &mut record.geometry, entity, pose);
    }

    pub fn step<'a, E: CollisionEntity<Collider = C>>(
        &'a mut self,
        entities: &mut [E],
        dt: f64,
        catalog: &Catalog,
        events: &mut Vec<SimulationEvent>,
    ) -> &'a [GameplayContact<C>] {
        self.contacts.clear();
        if self.live_ids.len() != entities.len()
            || self
                .live_ids
                .iter()
                .zip(entities.iter())
                .any(|(&id, entity)| id != entity.object().id)
        {
            self.live_ids.clear();
            self.live_ids
                .extend(entities.iter().map(|entity| entity.object().id));
            self.live_indices.clear();
            self.live_indices.extend(
                self.live_ids
                    .iter()
                    .enumerate()
                    .map(|(index, &id)| (id, index)),
            );
        }
        self.dead_ids.clear();
        for record in self.bodies.values() {
            if let Some(&index) = self.live_indices.get(&record.id) {
                if entities[index].object().inactive_physics {
                    self.world.park(record.geometry.body);
                }
            } else {
                self.world.destroy_body(record.geometry.body);
                self.dead_ids.push(record.id);
            }
        }
        for id in self.dead_ids.drain(..) {
            self.bodies.delete(&id);
        }
        self.motions.clear();
        self.bounds.clear();
        self.record_slots.resize(entities.len(), usize::MAX);
        for (index, entity) in entities.iter_mut().enumerate() {
            if entity.object().inactive_physics {
                continue;
            }
            let record = Self::record_for(
                &mut self.world,
                &mut self.bodies,
                entity,
                &mut self.record_slots[index],
            );
            let previous_opening = record.opening;
            let mut start = record.previous;
            let object = entity.object_mut();
            start.rotation += object.rotation_jump;
            object.rotation_jump = 0.0;
            let (velocity, spin) = if dt != 0.0 {
                (
                    (object.position - start.position) * (1.0 / dt),
                    (object.rotation - start.rotation) / dt,
                )
            } else {
                (Vector::ZERO, 0.0)
            };
            if let Some(gate) = entity.gate_motion() {
                let object = entity.object();
                let speed = gate_panel_speed(gate.half_travel, previous_opening, gate.opening, dt);
                self.contacts
                    .set_gate_motion(object.id, object.rotation, speed);
            }
            Self::synchronize_geometry(&mut self.world, record, entity);
            let object = entity.object();
            let geometry = &record.geometry;
            let deferred = record.deferred_source.is_some();
            self.motions.push(Motion {
                entity_index: index,
                body: geometry.body,
                deferred,
                parked: false,
                start,
                velocity,
                spin,
            });
            self.bounds.push(BodyMotion {
                position: object.position,
                start: start.position,
                radius: geometry.radius,
                collides: object.physics || !geometry.fixtures.is_empty() || deferred,
            });
        }
        let rules = catalog.simulation.physics;
        let free = self.free.find(&self.bounds, rules.wake_margin);
        for (index, motion) in self.motions.iter_mut().enumerate() {
            let entity = &mut entities[motion.entity_index];
            let body_id = motion.body;
            if free[index] {
                let body = self.world.body(body_id).expect("collision body is live");
                if !body.has_contacts() {
                    if !body.is_parked() {
                        self.world.park(body_id);
                    }
                    motion.parked = true;
                    entity.object_mut().ballistic = true;
                    continue;
                }
            }
            // Build a deferred asteroid only after the swept bounds require a wake-up.
            if motion.deferred {
                let record = self
                    .bodies
                    .get_mut(&entity.object().id)
                    .expect("motion has collision record");
                synchronize_geometry(
                    &mut self.world,
                    &mut record.geometry,
                    entity,
                    geometry_pose(entity),
                );
                record.deferred_source = None;
            }
            self.world
                .set_transform(body_id, motion.start.position, motion.start.rotation);
            let body = self
                .world
                .body_mut(body_id)
                .expect("collision body is live");
            body.linear_velocity = motion.velocity;
            body.angular_velocity = motion.spin;
            self.world.unpark(body_id);
        }
        self.world.step_with(
            dt,
            rules.velocity_iterations,
            rules.position_iterations,
            &mut self.contacts,
        );
        for &motion in &self.motions {
            let entity = entities[motion.entity_index].object_mut();
            entity.ballistic = true;
            if motion.parked {
                let motion =
                    integrate_parked(motion.start, motion.velocity, motion.spin, dt, rules);
                entity.position = motion.pose.position;
                entity.rotation = motion.pose.rotation;
                entity.velocity += motion.velocity_delta;
                entity.spin += motion.spin_delta;
            } else {
                let body = self
                    .world
                    .body(motion.body)
                    .expect("collision body is live");
                entity.position = body.position();
                entity.rotation = body.angle();
                entity.velocity += body.linear_velocity - motion.velocity;
                entity.spin += body.angular_velocity - motion.spin;
            }
        }
        for contact in &self.contacts.contacts {
            for collider in [contact.collider, contact.other] {
                if let Some(&index) = self.live_indices.get(&collider.owner()) {
                    entities[index].object_mut().ballistic = false;
                }
            }
        }
        for impact in &self.contacts.impacts {
            let [collider_a, collider_b] = [impact.contact.collider, impact.contact.other];
            let [id_a, id_b] = [collider_a.owner(), collider_b.owner()];
            let (Some(&index_a), Some(&index_b)) =
                (self.live_indices.get(&id_a), self.live_indices.get(&id_b))
            else {
                continue;
            };
            let Ok([a, b]) = entities.get_disjoint_mut([index_a, index_b]) else {
                continue;
            };
            let amount = impact_damage(
                impact.impact,
                a.object().force_mass(),
                b.object().force_mass(),
                rules,
            );
            let mut damage = [0.0; 2];
            if amount != 0.0 {
                if !a.object().dead {
                    damage[0] = a.damage(
                        collider_a,
                        amount,
                        b.object().player_number.unwrap_or(0),
                        events,
                    );
                }
                if !b.object().dead {
                    damage[1] = b.damage(
                        collider_b,
                        amount,
                        a.object().player_number.unwrap_or(0),
                        events,
                    );
                }
            }
            let colors = [
                a.outline_color(collider_a, &catalog.colors).to_owned(),
                b.outline_color(collider_b, &catalog.colors).to_owned(),
            ];
            let shield = [a.shield_contact(collider_a), b.shield_contact(collider_b)];
            events.push(SimulationEvent::CollisionEvent {
                by: 0,
                shield,
                a: id_a,
                b: id_b,
                impact: impact.impact,
                colors,
                damage,
                position: impact.contact.point,
            });
        }
        if dt > 0.0 {
            self.damage_crushed_ships(entities, catalog, events);
        }
        for motion in &self.motions {
            let entity = &entities[motion.entity_index];
            if let Some(gate) = entity.gate_motion() {
                self.bodies
                    .get_mut(&entity.object().id)
                    .expect("gate has collision record")
                    .opening = gate.opening;
            }
        }
        &self.contacts.contacts
    }

    fn damage_crushed_ships<E: CollisionEntity<Collider = C>>(
        &self,
        entities: &mut [E],
        catalog: &Catalog,
        events: &mut Vec<SimulationEvent>,
    ) {
        let mut gates = OrderedMap::<i64, OrderedMap<i64, Vec<GateContact<C>>>>::default();
        for contact in &self.contacts.contacts {
            if contact.depth <= 0.0 || !contact.physical {
                continue;
            }
            for (panel, hit, direction) in [
                (contact.collider, contact.other, 1.0),
                (contact.other, contact.collider, -1.0),
            ] {
                let (Some(&gate_index), Some(&ship_index)) = (
                    self.live_indices.get(&panel.owner()),
                    self.live_indices.get(&hit.owner()),
                ) else {
                    continue;
                };
                let (gate, ship) = (&entities[gate_index], &entities[ship_index]);
                let (Some(motion), Some(panel_motion)) =
                    (gate.gate_motion(), panel.material().gate_panel)
                else {
                    continue;
                };
                let prior = self
                    .bodies
                    .get(&panel.owner())
                    .expect("gate has collision record")
                    .opening;
                if motion.opening >= prior || ship.object().kind != "ship" {
                    continue;
                }
                let (sin, cos) = (-gate.object().rotation).sin_cos();
                let normal = RotValue { sin, cos }.rotate(contact.normal);
                let side = 1.0_f64.copysign(panel_motion.local_x);
                if normal.x * direction * side >= -0.5 {
                    continue;
                }
                if !gates.contains_key(&panel.owner()) {
                    gates.set(panel.owner(), OrderedMap::default());
                }
                let ships = gates
                    .get_mut(&panel.owner())
                    .expect("gate contact set is live");
                if !ships.contains_key(&hit.owner()) {
                    ships.set(hit.owner(), Vec::new());
                }
                ships
                    .get_mut(&hit.owner())
                    .expect("ship contacts are live")
                    .push(GateContact {
                        contact: *contact,
                        side,
                        normal: contact.normal * direction,
                        panel,
                        hit,
                    });
            }
        }
        for ships in gates.values() {
            for contacts in ships.values() {
                let Some(first) = contacts.first() else {
                    continue;
                };
                let pinched = contacts.iter().any(|a| {
                    contacts
                        .iter()
                        .any(|b| a.side != b.side && a.normal.dot(b.normal) < -0.98)
                });
                if !pinched {
                    continue;
                }
                let (gate_id, ship_id) = (first.panel.owner(), first.hit.owner());
                let (gate_index, ship_index) =
                    (self.live_indices[&gate_id], self.live_indices[&ship_id]);
                let Ok([gate, ship]) = entities.get_disjoint_mut([gate_index, ship_index]) else {
                    continue;
                };
                let amount = gate
                    .gate_motion()
                    .expect("gate contact is live")
                    .crush_damage;
                let mut damaged = HashSet::new();
                for entry in contacts {
                    if ship.object().dead || !damaged.insert(ship.crush_target(entry.hit)) {
                        continue;
                    }
                    let damage = ship.damage(entry.hit, amount, 0, events);
                    if damage == 0.0 {
                        continue;
                    }
                    let colors = [
                        ship.outline_color(entry.hit, &catalog.colors).to_owned(),
                        gate.outline_color(entry.panel, &catalog.colors).to_owned(),
                    ];
                    events.push(SimulationEvent::CollisionEvent {
                        by: 0,
                        shield: [false; 2],
                        a: ship_id,
                        b: gate_id,
                        impact: 0.0,
                        colors,
                        damage: [damage, 0.0],
                        position: entry.contact.point,
                    });
                }
            }
        }
    }
}

fn geometry_pose<E: CollisionEntity>(entity: &E) -> GeometryPose {
    let object = entity.object();
    GeometryPose {
        pose: Pose {
            position: object.position,
            rotation: object.rotation,
        },
        mass: object.mass,
        force_mass: object.force_mass(),
        angular_inertia_scale: object.angular_inertia_scale,
        source: entity.collision_geometry_source(),
    }
}

fn synchronize_geometry<E: CollisionEntity>(
    world: &mut World<E::Collider>,
    geometry: &mut CollisionGeometry,
    entity: &E,
    pose: GeometryPose,
) {
    if !geometry.matches_source(pose) {
        entity.with_colliders(|colliders| geometry.synchronize(world, pose, colliders));
    }
}

struct GateContact<C: GameplayCollider> {
    contact: GameplayContact<C>,
    side: f64,
    normal: Vector,
    panel: C,
    hit: C,
}

#[cfg(test)]
mod tests {
    use crate::simulation::game_object::ObjectProperties;
    use crate::simulation::polygon::ShapeOutline;

    use super::*;

    #[test]
    fn circle_and_polygon_impacts_match_go_recording() {
        let catalog = Catalog::load().unwrap();
        let dt = catalog.simulation.simulation_step;
        for polygon in [false, true] {
            let mut a = GameObject::new(
                1,
                ObjectProperties {
                    velocity: Vector::new(400.0, 0.0),
                    radius: Some(10.0),
                    mass: Some(100.0),
                    health: Some(10000.0),
                    bounciness: Some(0.2),
                    ..ObjectProperties::default()
                },
                &catalog.simulation,
            );
            a.kind = "item".into();
            let b = GameObject::new(
                2,
                ObjectProperties {
                    position: Vector::new(29.0, 0.0),
                    radius: Some(20.0),
                    mass: Some(100.0),
                    health: Some(10000.0),
                    shape_outline: polygon.then(|| ShapeOutline {
                        points: vec![[-20.0, -20.0], [20.0, -20.0], [20.0, 20.0], [-20.0, 20.0]],
                        edges: None,
                    }),
                    ..ObjectProperties::default()
                },
                &catalog.simulation,
            );
            let mut collisions = GameCollisions::new(&catalog, true);
            let mut bodies = [a, b];
            collisions.capture_poses(&mut bodies);
            bodies[0].position = bodies[0].position.add_scaled(bodies[0].velocity, dt);
            let mut events = Vec::new();
            let contacts = collisions.step(&mut bodies, dt, &catalog, &mut events);
            let [a, b] = &bodies;
            let expected = if polygon {
                (5.983333333333333, 36.35, 2, 1, 2.0, -1.0, 9.0)
            } else {
                (6.0, 36.333333333333336, 1, 2, 1.0, 1.0, 9.5)
            };
            assert!((a.position.x - expected.0).abs() <= 2e-8);
            assert!((b.position.x - expected.1).abs() <= 2e-8);
            assert_eq!(a.position.y, 0.0);
            assert_eq!(b.position.y, 0.0);
            assert_eq!(a.velocity, Vector::new(180.0, 0.0));
            assert_eq!(b.velocity, Vector::new(220.0, 0.0));
            assert_eq!(a.health, 9968.0);
            assert_eq!(b.health, 9968.0);
            assert!(!a.ballistic && !b.ballistic);
            assert_eq!(contacts.len(), 1);
            let contact = &contacts[0];
            assert_eq!(contact.collider.owner(), expected.2);
            assert_eq!(contact.other.owner(), expected.3);
            assert_eq!(contact.depth, expected.4);
            assert_eq!(contact.normal, Vector::new(expected.5, 0.0));
            assert_eq!(contact.point, Vector::new(expected.6, 0.0));
            let [
                SimulationEvent::CollisionEvent {
                    a,
                    b,
                    impact,
                    colors,
                    damage,
                    position,
                    ..
                },
            ] = events.as_slice()
            else {
                panic!("expected one collision event");
            };
            assert_eq!((*a, *b, *impact), (expected.2, expected.3, 400.0));
            assert_eq!(colors, &["#fff", "#fff"]);
            assert_eq!(*damage, [32.0, 32.0]);
            assert_eq!(*position, contact.point);
        }
    }

    #[test]
    fn inactive_bodies_keep_their_identity_and_reactivate_at_current_pose() {
        let catalog = Catalog::load().unwrap();
        let mut collision = GameCollisions::new(&catalog, true);
        let a = GameObject::new(
            1,
            ObjectProperties {
                radius: Some(10.0),
                ..ObjectProperties::default()
            },
            &catalog.simulation,
        );
        let b = GameObject::new(
            2,
            ObjectProperties {
                position: Vector::new(15.0, 0.0),
                radius: Some(10.0),
                ..ObjectProperties::default()
            },
            &catalog.simulation,
        );
        let mut events = Vec::new();
        let mut bodies = [a, b];
        collision.capture_poses(&mut bodies);
        assert!(
            !collision
                .step(&mut bodies, 0.0, &catalog, &mut events)
                .is_empty()
        );
        let body = collision.bodies.get(&1).unwrap().geometry.body;
        bodies[0].inactive_physics = true;
        collision.capture_poses(&mut bodies);
        assert!(
            collision
                .step(&mut bodies, 0.0, &catalog, &mut events)
                .is_empty()
        );
        assert!(collision.world.body(body).unwrap().is_parked());
        assert!(bodies[0].ballistic);
        bodies[0].inactive_physics = false;
        bodies[0].position = Vector::new(11.0, 0.0);
        collision.capture_poses(&mut bodies);
        assert!(
            !collision
                .step(&mut bodies, 0.0, &catalog, &mut events)
                .is_empty()
        );
        assert_eq!(collision.bodies.get(&1).unwrap().geometry.body, body);
        assert_eq!(
            collision.world.body(body).unwrap().position(),
            bodies[0].position
        );
        collision.step(&mut bodies[1..], 0.0, &catalog, &mut events);
        assert!(collision.world.body(body).is_none());
    }
}
