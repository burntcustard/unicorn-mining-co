//! Gameplay geometry and materials at the boundary of the rigid-body world.

use std::f64::consts::{PI, TAU};

use hashbrown::HashMap;

use crate::collision::Shape;
use crate::physics::{
    BodyId, ContactContext, ContactListener, Fixture, FixtureId, FixtureOptions, World,
};
use crate::specs::{Physics, Point};
use crate::utilities::{ease_progress, round_ties_up};
use crate::vector::{RotValue, Vector};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Pose {
    pub position: Vector,
    pub rotation: f64,
}

#[derive(Clone, Copy)]
pub struct ColliderGeometry<'a, T> {
    pub pose: Pose,
    pub radius: f64,
    pub collision_margin: Option<f64>,
    pub outline: Option<&'a [Point]>,
    pub collides: bool,
    pub physical: bool,
    pub pickup_point: bool,
    pub catches: bool,
    pub user_data: T,
}

impl<T> ColliderGeometry<'_, T> {
    fn flags(&self) -> usize {
        let outline_count = self.outline.map_or(0, <[Point]>::len);
        (outline_count << 4)
            | usize::from(self.physical)
            | (usize::from(self.collision_margin.is_some()) << 1)
            | (usize::from(self.pickup_point) << 2)
            | (usize::from(self.catches) << 3)
    }

    fn retains_area(&self) -> bool {
        self.outline.is_none_or(|outline| {
            let mut area = 0.0;
            for (index, &point) in outline.iter().enumerate() {
                let next = outline[(index + 1) % outline.len()];
                area = area + point[0] * next[1] - next[0] * point[1];
            }
            area.abs() > 0.1
        })
    }
}

#[derive(Clone, Copy)]
pub struct GeometryPose {
    pub pose: Pose,
    pub mass: f64,
    pub force_mass: f64,
    pub angular_inertia_scale: f64,
    /// Opaque token identifying a stable hitbox geometry owned by the entity.
    pub source: Option<u64>,
}

/// Keep matching fixtures alive across hitbox revisions so contact caches and
/// broad-phase proxy order survive hull and module changes.
pub struct CollisionGeometry {
    pub body: BodyId,
    pub radius: f64,
    pub fixtures: Vec<FixtureId>,
    source: Option<u64>,
    raw: Vec<f64>,
    quantized: Vec<f64>,
    scratch: Vec<f64>,
    usable: Vec<usize>,
    starts: Vec<usize>,
    previous_starts: Vec<usize>,
    previous_fixtures: Vec<FixtureId>,
}

impl CollisionGeometry {
    pub fn new(body: BodyId) -> Self {
        Self {
            body,
            radius: 0.0,
            fixtures: Vec::new(),
            source: None,
            raw: Vec::new(),
            quantized: Vec::new(),
            scratch: Vec::new(),
            usable: Vec::new(),
            starts: Vec::new(),
            previous_starts: Vec::new(),
            previous_fixtures: Vec::new(),
        }
    }

    /// Record enough reach to run broad-phase wake checks before building asteroid fixtures.
    pub fn defer_asteroid(&mut self, source: u64, extent: f64, linear_slop: f64) -> bool {
        if !self.fixtures.is_empty() {
            return false;
        }
        self.radius = extent + 2.0 * linear_slop;
        self.source = Some(source);
        self.raw.clear();
        self.quantized.clear();
        self.previous_starts.clear();
        true
    }

    pub fn matches_source(&self, pose: GeometryPose) -> bool {
        pose.source.is_some()
            && pose.source == self.source
            && self.matches(pose.mass, 0)
            && self.matches(pose.angular_inertia_scale, 1)
    }

    fn matches(&self, value: f64, index: usize) -> bool {
        self.raw
            .get(index)
            .is_some_and(|&previous| previous == value)
            || self
                .quantized
                .get(index)
                .is_some_and(|&previous| previous == quantize_geometry(value))
    }

    fn row_matches(&self, index: usize) -> bool {
        let Some(&previous) = self.previous_starts.get(index) else {
            return false;
        };
        let current = self.starts[index];
        let current_end = self
            .starts
            .get(index + 1)
            .copied()
            .unwrap_or(self.scratch.len());
        let previous_end = self
            .previous_starts
            .get(index + 1)
            .copied()
            .unwrap_or(self.raw.len());
        let length = current_end - current;
        (previous_end - previous) == length
            && (0..length)
                .all(|offset| self.matches(self.scratch[current + offset], previous + offset))
    }

    pub fn synchronize<T: Copy>(
        &mut self,
        world: &mut World<T>,
        pose: GeometryPose,
        colliders: &[ColliderGeometry<'_, T>],
    ) {
        if self.matches_source(pose) {
            return;
        }
        self.scratch.clear();
        self.scratch.extend([pose.mass, pose.angular_inertia_scale]);
        self.starts.clear();
        let (sin, cos) = (-pose.pose.rotation).sin_cos();
        let inverse = RotValue { sin, cos };
        self.usable.clear();
        let mut has_degenerate_geometry = false;
        self.usable.extend(
            colliders
                .iter()
                .enumerate()
                .filter_map(|(index, collider)| {
                    if !collider.collides {
                        return None;
                    }
                    let retains_area = collider.retains_area();
                    has_degenerate_geometry |= !retains_area;
                    retains_area.then_some(index)
                }),
        );
        for &index in &self.usable {
            let collider = &colliders[index];
            self.starts.push(self.scratch.len());
            self.scratch.extend([
                collider.flags() as f64,
                collider.collision_margin.unwrap_or(0.0),
            ]);
            let offset = inverse.rotate(collider.pose.position - pose.pose.position);
            if let Some(outline) = collider.outline {
                let (sin, cos) = (collider.pose.rotation - pose.pose.rotation).sin_cos();
                let rotation = RotValue { sin, cos };
                for &[x, y] in outline {
                    let point = offset + rotation.rotate(Vector::new(x, y));
                    self.scratch.extend([point.x, point.y]);
                }
            } else {
                self.scratch.extend([offset.x, offset.y, collider.radius]);
            }
        }
        let matching_mass =
            self.matches(pose.mass, 0) && self.matches(pose.angular_inertia_scale, 1);
        self.source = if has_degenerate_geometry {
            None
        } else {
            pose.source
        };
        if matching_mass
            && self.scratch.len() == self.raw.len()
            && self
                .scratch
                .iter()
                .enumerate()
                .all(|(index, &value)| self.matches(value, index))
        {
            for (&fixture, &index) in self.fixtures.iter().zip(&self.usable) {
                world.replace_fixture_user_data(fixture, colliders[index].user_data);
            }
            return;
        }
        std::mem::swap(&mut self.fixtures, &mut self.previous_fixtures);
        self.fixtures.clear();
        for (index, &fixture) in self.previous_fixtures.iter().enumerate() {
            let retain = matching_mass && index < self.starts.len() && self.row_matches(index);
            if !retain {
                world.destroy_fixture(fixture);
            }
        }
        let slop = world.rules.linear_slop;
        for (index, &collider_index) in self.usable.iter().enumerate() {
            let collider = &colliders[collider_index];
            if matching_mass && self.row_matches(index) {
                let fixture = self.previous_fixtures[index];
                world.replace_fixture_user_data(fixture, collider.user_data);
                self.fixtures.push(fixture);
                continue;
            }
            let values = &self.scratch[self.starts[index] + 2..];
            let shape = if let Some(outline) = collider.outline {
                let vertices: Vec<_> = values[..2 * outline.len()]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|&[x, y]| Vector::new(x, y))
                    .collect();
                Shape::polygon(&vertices, collider.collision_margin, slop)
            } else {
                Shape::circle(Vector::new(values[0], values[1]), values[2])
            };
            let options = FixtureOptions {
                user_data: collider.user_data,
                physical: collider.physical,
            };
            let fixture = world
                .create_fixture(self.body, shape, options)
                .expect("synchronizing live gameplay body outside a solver step");
            self.fixtures.push(fixture);
        }
        std::mem::swap(&mut self.raw, &mut self.scratch);
        std::mem::swap(&mut self.previous_starts, &mut self.starts);
        self.quantized.clear();
        self.quantized
            .extend(self.raw.iter().copied().map(quantize_geometry));
        let fixtures = self.fixtures.iter().filter_map(|&id| world.fixture(id));
        self.radius = fixtures.clone().fold(0.0_f64, |radius, fixture| {
            let geometry = fixture.shape.base();
            let extent = geometry
                .vertices()
                .iter()
                .map(|vertex| vertex.length())
                .fold(f64::NEG_INFINITY, f64::max);
            radius.max(geometry.radius + extent)
        });
        let inertia = pose.force_mass * pose.angular_inertia_scale * inertia_per_mass(fixtures);
        world.set_proxy_radius(self.body, self.radius);
        world.set_mass(self.body, pose.force_mass, inertia);
    }
}

fn quantize_geometry(value: f64) -> f64 {
    round_ties_up(value * 1e6)
}

fn inertia_per_mass<'a, T: 'a>(fixtures: impl Iterator<Item = &'a Fixture<T>>) -> f64 {
    let (mut area, mut moment) = (0.0, 0.0);
    for fixture in fixtures.filter(|fixture| fixture.physical) {
        match &fixture.shape {
            Shape::Circle(circle) => {
                let radius_squared = circle.base.radius * circle.base.radius;
                let circle_area = PI * radius_squared;
                let point = circle.position();
                area += circle_area;
                moment +=
                    circle_area * (radius_squared / 2.0 + point.x * point.x + point.y * point.y);
            }
            Shape::Polygon(polygon) => {
                let vertices = polygon.base.vertices();
                for (index, &point) in vertices.iter().enumerate() {
                    let next = vertices[(index + 1) % vertices.len()];
                    let cross = point.x * next.y - next.x * point.y;
                    area += cross / 2.0;
                    moment += (cross
                        * (point.x * point.x
                            + point.x * next.x
                            + next.x * next.x
                            + point.y * point.y
                            + point.y * next.y
                            + next.y * next.y))
                        / 12.0;
                }
            }
        }
    }
    if area > 0.0 { moment / area } else { 0.0 }
}

#[derive(Clone, Copy)]
pub struct BodyMotion {
    pub position: Vector,
    pub start: Vector,
    pub radius: f64,
    /// Object physics, a live fixture, or deferred asteroid geometry can wake the body.
    pub collides: bool,
}

#[derive(Clone, Copy)]
struct MotionBounds {
    left: f64,
    center: Vector,
    reach: f64,
}

#[derive(Default)]
pub struct FreeMotion {
    bounds: Vec<MotionBounds>,
    order: Vec<usize>,
    free: Vec<bool>,
}

impl FreeMotion {
    pub fn find(&mut self, motions: &[BodyMotion], wake_margin: f64) -> &[bool] {
        let count = motions.len();
        let previous_count = self.order.len();
        self.order.retain(|&index| index < count);
        self.order.extend(previous_count..count);
        self.bounds.clear();
        self.bounds.extend(motions.iter().map(|motion| {
            let displacement = motion.position - motion.start;
            let reach = motion.radius + displacement.length() + wake_margin;
            let center = Vector::new(
                motion.start.x + displacement.x / 2.0,
                motion.start.y + displacement.y / 2.0,
            );
            MotionBounds {
                left: center.x - reach,
                center,
                reach,
            }
        }));
        self.free.clear();
        self.free.resize(count, true);
        if previous_count > 0 {
            for index in 1..count {
                let item = self.order[index];
                let key = self.bounds[item].left;
                let mut cursor = index;
                while cursor > 0 && self.bounds[self.order[cursor - 1]].left > key {
                    self.order[cursor] = self.order[cursor - 1];
                    cursor -= 1;
                }
                self.order[cursor] = item;
            }
        } else {
            self.order.sort_unstable_by(|&a, &b| {
                self.bounds[a]
                    .left
                    .partial_cmp(&self.bounds[b].left)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }
        for (index, &first) in self.order.iter().enumerate() {
            if !motions[first].collides {
                continue;
            }
            let a = self.bounds[first];
            let right = a.center.x + a.reach;
            for &second in &self.order[index + 1..] {
                let b = self.bounds[second];
                if b.left > right {
                    break;
                }
                if !motions[second].collides || !self.free[first] && !self.free[second] {
                    continue;
                }
                let reach = a.reach + b.reach;
                if a.center.distance_squared(b.center) <= reach * reach {
                    self.free[first] = false;
                    self.free[second] = false;
                }
            }
        }
        &self.free
    }
}

#[derive(Clone, Copy, Debug)]
pub struct IntegratedMotion {
    pub pose: Pose,
    pub velocity_delta: Vector,
    pub spin_delta: f64,
}

/// Advance an isolated parked body with the same limits as a physical island.
pub fn integrate_parked(
    start: Pose,
    velocity: Vector,
    spin: f64,
    dt: f64,
    rules: Physics,
) -> IntegratedMotion {
    let mut angle = start.rotation;
    if angle > PI {
        angle -= TAU;
    } else if angle < -PI {
        angle += TAU;
    }
    if !(-PI..=PI).contains(&angle) {
        let (sin, cos) = angle.sin_cos();
        angle = sin.atan2(cos);
    }
    if dt <= 0.0 {
        return IntegratedMotion {
            pose: Pose {
                position: start.position,
                rotation: angle,
            },
            velocity_delta: Vector::ZERO,
            spin_delta: 0.0,
        };
    }
    let mut linear = velocity;
    let mut angular = spin;
    let translation = (velocity * dt).length_squared();
    if translation > rules.max_translation * rules.max_translation {
        linear = linear * (rules.max_translation / translation.sqrt());
    }
    let rotation = dt * angular;
    if rotation * rotation > rules.max_rotation * rules.max_rotation {
        angular *= rules.max_rotation / rotation.abs();
    }
    let pose = Pose {
        position: start.position.add_scaled(linear, dt),
        rotation: angle + dt * angular,
    };
    IntegratedMotion {
        pose,
        velocity_delta: linear - velocity,
        spin_delta: angular - spin,
    }
}

pub fn gate_panel_speed(half_travel: f64, previous_opening: f64, opening: f64, dt: f64) -> f64 {
    if dt == 0.0 {
        0.0
    } else {
        half_travel
            * (ease_progress(ease_progress(opening))
                - ease_progress(ease_progress(previous_opening)))
            / dt
    }
}

#[derive(Clone, Copy, Debug)]
pub struct GatePanelMotion {
    pub local_x: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct ColliderMaterial {
    pub friction: f64,
    pub bounciness: f64,
    pub speed: f64,
    pub gate_panel: Option<GatePanelMotion>,
}

pub trait GameplayCollider: Copy {
    fn owner(self) -> i64;
    fn material(self) -> ColliderMaterial;
    fn can_contact(self, other: Self) -> bool;
}

#[derive(Clone, Copy, Debug)]
pub struct GameplayContact<T> {
    pub collider: T,
    pub other: T,
    pub depth: f64,
    pub physical: bool,
    pub normal: Vector,
    pub point: Vector,
}

#[derive(Clone, Copy, Debug)]
pub struct Impact<T> {
    pub contact: GameplayContact<T>,
    pub impact: f64,
}

pub struct GameplayContacts<T> {
    pub contacts: Vec<GameplayContact<T>>,
    pub impacts: Vec<Impact<T>>,
    impact_indices: HashMap<(FixtureId, FixtureId), usize>,
    gates: HashMap<i64, (RotValue, f64)>,
    contact_speed_threshold: f64,
}

impl<T> GameplayContacts<T> {
    pub fn new(contact_speed_threshold: f64) -> Self {
        Self {
            contacts: Vec::new(),
            impacts: Vec::new(),
            impact_indices: HashMap::new(),
            gates: HashMap::new(),
            contact_speed_threshold,
        }
    }

    pub fn clear(&mut self) {
        self.contacts.clear();
        self.impacts.clear();
        self.impact_indices.clear();
        self.gates.clear();
    }

    pub fn set_gate_motion(&mut self, owner: i64, rotation: f64, speed: f64) {
        let (sin, cos) = rotation.sin_cos();
        self.gates.insert(owner, (RotValue { sin, cos }, speed));
    }
}

impl<T: GameplayCollider> ContactListener<T> for GameplayContacts<T> {
    fn can_contact(&mut self, first: &Fixture<T>, second: &Fixture<T>) -> bool {
        first.user_data.can_contact(second.user_data)
            && second.user_data.can_contact(first.user_data)
    }

    fn pre_solve(&mut self, context: ContactContext<'_, T>) {
        let manifold = context.world_manifold();
        if manifold.point_count == 0 {
            return;
        }
        let point = manifold.points[0];
        let normal = manifold.normal;
        let collider = context.fixture_a.user_data;
        let other = context.fixture_b.user_data;
        let mut impact = 0.0;
        if context.contact.physical {
            let (a, b) = (collider.material(), other.material());
            let mut surface_speed = a.speed + b.speed;
            for (direction, owner, panel) in [
                (1.0, collider.owner(), a.gate_panel),
                (-1.0, other.owner(), b.gate_panel),
            ] {
                if let Some(panel) = panel
                    && let Some(&(rotation, speed)) = self.gates.get(&owner)
                {
                    surface_speed += direction
                        * 1.0_f64.copysign(panel.local_x)
                        * speed
                        * (rotation.cos * normal.x + rotation.sin * normal.y);
                }
            }
            let va = context.body_a.linear_velocity_from_world_point(point);
            let vb = context.body_b.linear_velocity_from_world_point(point);
            impact = surface_speed - (vb - va).dot(normal);
            context.contact.surface_speed = surface_speed;
            context.contact.friction = (a.friction * b.friction).sqrt();
            context.contact.restitution = if impact >= self.contact_speed_threshold {
                ((a.bounciness + b.bounciness) / 2.0).max(0.0)
            } else {
                0.0
            };
        }
        let depth = manifold.separations[..manifold.point_count]
            .iter()
            .map(|separation| -*separation)
            .fold(0.0_f64, f64::max);
        let contact = GameplayContact {
            collider,
            other,
            depth,
            physical: context.contact.physical,
            normal,
            point,
        };
        self.contacts.push(contact);
        if context.contact.physical && impact > 0.0 {
            let key = (context.contact.fixture_a, context.contact.fixture_b);
            let entry = Impact { contact, impact };
            let index = *self.impact_indices.entry(key).or_insert_with(|| {
                self.impacts.push(entry);
                self.impacts.len() - 1
            });
            if impact > self.impacts[index].impact {
                self.impacts[index] = entry;
            }
        }
    }
}

pub fn impact_damage(impact: f64, mass_a: f64, mass_b: f64, rules: Physics) -> f64 {
    let inverse_mass = 1.0 / mass_a + 1.0 / mass_b;
    round_ties_up((impact / inverse_mass - rules.damage_base) / rules.damage_scale).max(0.0)
}

#[cfg(test)]
mod tests {
    use crate::specs::Catalog;

    use super::*;

    fn collider<'a>(position: Vector, user_data: i32) -> ColliderGeometry<'a, i32> {
        ColliderGeometry {
            pose: Pose {
                position,
                rotation: 0.0,
            },
            radius: 2.0,
            collision_margin: None,
            outline: None,
            collides: true,
            physical: true,
            pickup_point: false,
            catches: false,
            user_data,
        }
    }

    #[test]
    fn synchronizing_geometry_preserves_unchanged_fixture_ids() {
        let catalog = Catalog::load().unwrap();
        let mut world = World::new(&catalog.simulation);
        let body = world.create_body();
        let mut geometry = CollisionGeometry::new(body);
        let mut pose = GeometryPose {
            pose: Pose::default(),
            angular_inertia_scale: 0.8,
            mass: 10.0,
            force_mass: 10.0,
            source: Some(1),
        };
        let outline = [[-2.0, -3.0], [2.0, -3.0], [2.0, 3.0], [-2.0, 3.0]];
        let mut colliders = [
            ColliderGeometry {
                outline: Some(&outline),
                collision_margin: Some(0.0),
                ..collider(Vector::new(-12.0, 0.0), 1)
            },
            collider(Vector::new(7.0, 0.0), 2),
        ];
        geometry.synchronize(&mut world, pose, &colliders);
        let original = geometry.fixtures.clone();
        assert!((geometry.radius - 205.0_f64.sqrt()).abs() <= 1e-12);
        let inertia = inertia_per_mass(original.iter().map(|&id| world.fixture(id).unwrap()));
        let expected_inertia =
            (24.0 * ((4.0 + 9.0) / 3.0 + 144.0) + 4.0 * PI * 51.0) / (24.0 + 4.0 * PI);
        assert!((inertia - expected_inertia).abs() <= 1e-12);
        pose.source = Some(2);
        pose.pose = Pose {
            position: Vector::new(1234.0, -5678.0),
            rotation: 0.71,
        };
        let (sin, cos) = pose.pose.rotation.sin_cos();
        let rotation = RotValue { sin, cos };
        for collider in &mut colliders {
            collider.pose.position = pose.pose.position + rotation.rotate(collider.pose.position);
            collider.pose.rotation = pose.pose.rotation;
        }
        colliders[1].user_data = 3;
        geometry.synchronize(&mut world, pose, &colliders);
        assert_eq!(geometry.fixtures, original);
        assert_eq!(world.fixture(original[1]).unwrap().user_data, 3);
        pose.source = Some(3);
        colliders[0].pose.position += rotation.rotate(Vector::new(1.0, 0.0));
        geometry.synchronize(&mut world, pose, &colliders);
        assert_ne!(geometry.fixtures[0], original[0]);
        assert_eq!(geometry.fixtures[1], original[1]);
        assert!(world.fixture(original[0]).is_none());
    }

    #[test]
    fn inactive_colliders_keep_a_stable_source_until_activation() {
        let catalog = Catalog::load().unwrap();
        let mut world = World::new(&catalog.simulation);
        let mut geometry = CollisionGeometry::new(world.create_body());
        let mut pose = GeometryPose {
            pose: Pose::default(),
            mass: 10.0,
            force_mass: 10.0,
            angular_inertia_scale: 0.8,
            source: Some(1),
        };
        let mut colliders = [
            collider(Vector::ZERO, 1),
            ColliderGeometry {
                collides: false,
                ..collider(Vector::new(7.0, 0.0), 2)
            },
        ];
        geometry.synchronize(&mut world, pose, &colliders);
        assert!(geometry.matches_source(pose));
        assert_eq!(geometry.fixtures.len(), 1);
        let original = geometry.fixtures[0];

        pose.source = Some(2);
        colliders[1].collides = true;
        assert!(!geometry.matches_source(pose));
        geometry.synchronize(&mut world, pose, &colliders);
        assert!(geometry.matches_source(pose));
        assert_eq!(geometry.fixtures.len(), 2);
        assert_eq!(geometry.fixtures[0], original);
    }

    #[test]
    fn wake_search_matches_pairwise_bounds_with_changing_body_counts() {
        let mut search = FreeMotion::default();
        let mut state = 63_u64;
        let mut sample = |maximum: u64| {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
            (state >> 32) % maximum
        };
        let catalog = Catalog::load().unwrap();
        let margin = catalog.simulation.physics.wake_margin;
        for _ in 0..300 {
            let motions: Vec<_> = (0..sample(120))
                .map(|index| {
                    let start = Vector::new((sample(40) * 40) as f64, (sample(40) * 40) as f64);
                    let position =
                        start + Vector::new(sample(11) as f64 - 5.0, sample(11) as f64 - 5.0);
                    BodyMotion {
                        position,
                        start,
                        radius: sample(60) as f64,
                        collides: index % 5 != 0,
                    }
                })
                .collect();
            let free = search.find(&motions, margin);
            for (i, a) in motions.iter().enumerate() {
                let expected = !a.collides
                    || !motions.iter().enumerate().any(|(j, b)| {
                        let centers = ((a.start + a.position) * 0.5, (b.start + b.position) * 0.5);
                        let radii = a.radius
                            + a.start.distance(a.position)
                            + margin
                            + b.radius
                            + b.start.distance(b.position)
                            + margin;
                        i != j && b.collides && centers.0.distance(centers.1) <= radii
                    });
                assert_eq!(free[i], expected);
            }
        }
    }

    #[test]
    fn parked_motion_agrees_with_the_solver_limits() {
        let catalog = Catalog::load().unwrap();
        let rules = catalog.simulation.physics;
        let mut world = World::<()>::new(&catalog.simulation);
        let id = world.create_body();
        let dt = catalog.simulation.simulation_step;
        for theta in [-12.0, 0.71, 6.5] {
            let start = Pose {
                position: Vector::new(1234.0, -5678.0),
                rotation: theta,
            };
            let velocity = Vector::new(15000.0, -11000.0);
            let spin = -1000.0;
            world.set_transform(id, start.position, start.rotation);
            let body = world.body_mut(id).unwrap();
            body.linear_velocity = velocity;
            body.angular_velocity = spin;
            world.step(dt, rules.velocity_iterations, rules.position_iterations);
            let body = world.body(id).unwrap();
            let parked = integrate_parked(start, velocity, spin, dt, rules);
            assert!(parked.pose.position.distance(body.position()) <= 1e-12);
            assert!((parked.pose.rotation - body.angle()).abs() <= 1e-12);
            assert_eq!(parked.velocity_delta, body.linear_velocity - velocity);
            assert_eq!(parked.spin_delta, body.angular_velocity - spin);
        }
    }
}
