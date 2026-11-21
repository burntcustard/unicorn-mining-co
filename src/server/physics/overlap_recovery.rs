//! Escape deep overlaps through the union of fixture obstacles.

use std::f64::consts::PI;

use crate::collision::{Manifold, Shape, WorldManifold};
use crate::utilities::vector::Vector;
use crate::utilities::vector_math::TransformValue;

use super::contact::evaluate;
use super::{Body, BodyId, ContactId, ContactListener, Fixture, FixtureId, World};

const RECOVERY_TOLERANCE: f64 = 1e-8;

#[derive(Clone, Copy)]
struct Slab {
    normal: Vector,
    lower: f64,
    upper: f64,
}

impl Slab {
    fn contains_origin(self) -> bool {
        self.lower < -RECOVERY_TOLERANCE && self.upper > RECOVERY_TOLERANCE
    }

    fn clip(self, direction: Vector, entry: f64, exit: f64) -> (f64, f64) {
        let speed = self.normal.dot(direction);
        if speed.abs() < 1e-10 {
            if self.lower >= -RECOVERY_TOLERANCE || self.upper <= RECOVERY_TOLERANCE {
                return (0.0, 0.0);
            }
            return (entry, exit);
        }
        let first = self.lower / speed;
        let second = self.upper / speed;
        (entry.max(first.min(second)), exit.min(first.max(second)))
    }
}

impl<T> Fixture<T> {
    fn recovery_bound(&mut self, body: &Body, slop: f64) -> (Vector, f64) {
        if self.recovery.radius == 0.0 || self.recovery.slop != slop {
            self.recovery.radius = self.recovery_radius(slop);
            self.recovery.slop = slop;
            self.recovery.pose = !body.pose_version;
        }
        if self.recovery.pose != body.pose_version {
            let bound = self.shape.base().bound();
            self.recovery.center = body.xf.transform(Vector::new(bound.x, bound.y));
            // Avoid relying on absolute positions when subtracting large coordinates
            // can lose local detail.
            if self.recovery.center.x.abs() > 1e9 || self.recovery.center.y.abs() > 1e9 {
                self.recovery.radius = f64::INFINITY;
            }
            self.recovery.pose = body.pose_version;
        }
        (self.recovery.center, self.recovery.radius)
    }

    fn recovery_radius(&self, slop: f64) -> f64 {
        let shape = self.shape.base();
        if shape.count() == 0 {
            return f64::INFINITY;
        }
        // Bound the offset polygon including the acute corner miters.
        let mut padding = 1.02_f64;
        if let Shape::Polygon(polygon) = &self.shape {
            for (index, &normal) in polygon.normals().iter().enumerate() {
                let previous = polygon.normals()
                    [(index + polygon.normals().len() - 1) % polygon.normals().len()];
                padding = padding.max(2.0 / previous.cross(normal).abs());
            }
        }
        (shape.bound().radius + (shape.radius + slop).max(0.0) * padding) * (1.0 + 1e-10)
            + RECOVERY_TOLERANCE
    }
}

fn intersects(delta: Vector, radius: f64, direction: Vector, limit: f64) -> bool {
    if limit == f64::INFINITY {
        delta.cross(direction).abs() <= radius && delta.dot(direction) >= -radius
    } else {
        let extent = radius + limit;
        delta.dot(delta) <= extent * extent
    }
}

fn project(shape: &Shape, transform: TransformValue, normal: Vector, origin: Vector) -> (f64, f64) {
    let axis = transform.q.unrotate(normal);
    let offset = (transform.p - origin).dot(normal);
    let (mut lower, mut upper) = (f64::INFINITY, f64::NEG_INFINITY);
    let geometry = shape.base();
    for &vertex in geometry.vertices() {
        let value = vertex.dot(axis) + offset;
        lower = lower.min(value);
        upper = upper.max(value);
    }
    (lower - geometry.radius, upper + geometry.radius)
}

fn interval(slabs: &[Slab], direction: Vector) -> (f64, f64) {
    let (mut entry, mut exit) = (f64::NEG_INFINITY, f64::INFINITY);
    for slab in slabs {
        (entry, exit) = slab.clip(direction, entry, exit);
        if entry >= exit || exit <= 0.0 {
            return (0.0, 0.0);
        }
    }
    (entry, exit)
}

fn contained_exit(slabs: &[Slab], direction: Vector) -> f64 {
    let mut exit = f64::INFINITY;
    for slab in slabs {
        let speed = slab.normal.dot(direction);
        let boundary = if speed >= 1e-10 {
            slab.upper
        } else if speed <= -1e-10 {
            slab.lower
        } else {
            continue;
        };
        let candidate = boundary / speed;
        if candidate < exit {
            exit = candidate;
        }
    }
    exit
}

fn escape_distance(intervals: &mut [(f64, f64)]) -> f64 {
    intervals.sort_unstable_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut distance = 0.0_f64;
    for &(entry, exit) in intervals.iter() {
        if entry > distance + RECOVERY_TOLERANCE {
            break;
        }
        distance = distance.max(exit);
    }
    distance
}

fn axis_length(axis: Vector) -> f64 {
    let squared = axis.dot(axis);
    if (f64::MIN_POSITIVE..=f64::MAX).contains(&squared) {
        squared.sqrt() * (1.0 + 1e-12)
    } else {
        axis.distance(Vector::ZERO)
    }
}

struct RecoverySearch {
    slop: f64,
    origin: Vector,
    body: BodyId,
    reach: f64,
    rays: [Vector; 16],
    axes: Vec<Vector>,
    temporary: Vec<Slab>,
}

impl RecoverySearch {
    fn new(slop: f64, id: BodyId, body: &Body, reach: f64) -> Self {
        let rays = std::array::from_fn(|index| {
            let angle = body.angle() + index as f64 * PI / 8.0;
            Vector::new(angle.cos(), angle.sin())
        });
        Self {
            slop,
            origin: body.xf.p,
            body: id,
            reach,
            rays,
            axes: Vec::new(),
            temporary: Vec::new(),
        }
    }

    fn pair_slabs<T>(
        &mut self,
        world: &mut World<T>,
        first: FixtureId,
        second: FixtureId,
        limit: f64,
    ) -> Option<(f64, f64)> {
        let [Some(a), Some(b)] = world.fixtures.get_disjoint_mut([&first, &second]) else {
            unreachable!("two live fixtures per recovery pair");
        };
        let (body_a, body_b) = (&world.bodies[&a.body], &world.bodies[&b.body]);
        let (center_a, radius_a) = a.recovery_bound(body_a, self.slop);
        let (center_b, radius_b) = b.recovery_bound(body_b, self.slop);
        if !intersects(
            center_b - center_a,
            radius_a + radius_b,
            self.rays[0],
            limit,
        ) {
            return None;
        }
        self.axes.clear();
        for (shape, transform) in [(&a.shape, body_a.xf), (&b.shape, body_b.xf)] {
            if let Shape::Polygon(polygon) = shape {
                self.axes.extend(
                    polygon
                        .normals()
                        .iter()
                        .map(|&normal| transform.q.rotate(normal)),
                );
            }
        }
        if matches!(a.shape, Shape::Circle(_)) || matches!(b.shape, Shape::Circle(_)) {
            self.axes.extend(self.rays);
        }
        self.temporary.clear();
        let (mut entry, mut exit) = (f64::NEG_INFINITY, f64::INFINITY);
        for &normal in &self.axes {
            let (a0, a1) = project(&a.shape, body_a.xf, normal, self.origin);
            let (b0, b1) = project(&b.shape, body_b.xf, normal, self.origin);
            let slab = Slab {
                normal,
                lower: b0 - a1 - self.slop,
                upper: b1 - a0 + self.slop,
            };
            if limit == f64::INFINITY {
                (entry, exit) = slab.clip(self.rays[0], entry, exit);
                if entry >= exit || exit <= 0.0 {
                    return None;
                }
            } else {
                // A separating slab beyond the bounding disk cannot affect a better escape.
                let extent = limit * axis_length(normal);
                if slab.lower > extent || slab.upper < -extent {
                    return None;
                }
            }
            self.temporary.push(slab);
        }
        (!self.temporary.is_empty()).then_some((entry, exit))
    }
}

impl<T> World<T> {
    fn recovery_reach(&mut self, id: BodyId) -> f64 {
        let mut radius = -1.0_f64;
        let body = &self.bodies[&id];
        for fixture in body.fixtures.iter().rev() {
            let fixture = self
                .fixtures
                .get_mut(fixture)
                .expect("body fixture is live");
            if fixture.physical {
                let offset_radius = fixture.shape.base().bound().offset_radius;
                let (_, bound_radius) = fixture.recovery_bound(body, self.rules.linear_slop);
                radius = radius.max((offset_radius + bound_radius) * (1.0 + 1e-10));
            }
        }
        radius
    }

    fn deeply_embedded(&mut self, id: ContactId, listener: &mut impl ContactListener<T>) -> bool {
        let contact = self
            .contacts
            .get_mut(&id)
            .expect("recovery contact is live");
        let (a, b) = (&self.bodies[&contact.body_a], &self.bodies[&contact.body_b]);
        let (fixture_a, fixture_b) = (
            &self.fixtures[&contact.fixture_a],
            &self.fixtures[&contact.fixture_b],
        );
        if !contact.enabled
            || !fixture_a.physical
            || !fixture_b.physical
            || a.inv_mass == 0.0 && b.inv_mass == 0.0
            || !listener.can_contact(fixture_a, fixture_b)
        {
            return false;
        }
        let mut manifold = Manifold::default();
        let slop = self.rules.linear_slop;
        evaluate(
            &mut manifold,
            &fixture_a.shape,
            a.xf,
            &fixture_b.shape,
            b.xf,
            slop,
            &mut contact.separation_cache,
        );
        if manifold.point_count == 0 {
            return false;
        }
        let mut result = WorldManifold::default();
        manifold.world_manifold(
            &mut result,
            a.xf,
            fixture_a.shape.base().radius,
            b.xf,
            fixture_b.shape.base().radius,
        );
        result.separations[..result.point_count]
            .iter()
            .any(|&separation| separation < -3.0 * slop - RECOVERY_TOLERANCE)
    }

    pub(super) fn recover_overlaps(&mut self, listener: &mut impl ContactListener<T>) {
        let mut candidates = Vec::new();
        for index in (0..self.contact_order.len()).rev() {
            let Some(id) = self.contact_order[index] else {
                continue;
            };
            if !self.deeply_embedded(id, listener) {
                continue;
            }
            let contact = &self.contacts[&id];
            let (a, b) = (contact.body_a, contact.body_b);
            let body = if self.bodies[&b].inv_mass > self.bodies[&a].inv_mass {
                b
            } else {
                a
            };
            if self.bodies[&body].inv_mass > 0.0 && !candidates.contains(&body) {
                candidates.push(body);
            }
        }
        if candidates.is_empty() {
            return;
        }
        let mut obstacles = Vec::new();
        for index in (0..self.body_order.len()).rev() {
            let body = self.body_order[index];
            let radius = self.recovery_reach(body);
            if radius >= 0.0 {
                obstacles.push((body, radius));
            }
        }
        for body in candidates {
            let mut trapped = false;
            for index in (0..self.bodies[&body].contacts.len()).rev() {
                let id = self.bodies[&body].contacts[index];
                if self.deeply_embedded(id, listener) {
                    trapped = true;
                    break;
                }
            }
            if trapped {
                self.recover_body(body, &obstacles, listener);
            }
        }
        self.find_new_contacts(listener);
    }

    fn recover_body(
        &mut self,
        body: BodyId,
        obstacles: &[(BodyId, f64)],
        listener: &mut impl ContactListener<T>,
    ) {
        let reach = self.recovery_reach(body);
        let mut search =
            RecoverySearch::new(self.rules.linear_slop, body, &self.bodies[&body], reach);
        let mut directions = search.rays.to_vec();
        let mut intervals = Vec::new();
        // The first ray establishes an escape bound, including obstacles beyond current contacts.
        self.visit_recovery_pairs(
            obstacles,
            f64::INFINITY,
            &mut search,
            listener,
            |pair, entry, exit| {
                if pair.iter().all(|slab| slab.contains_origin()) {
                    for slab in pair {
                        for direction in [slab.normal, slab.normal * -1.0] {
                            if !directions.contains(&direction) {
                                directions.push(direction);
                            }
                        }
                    }
                }
                if exit > 0.0 && entry < exit {
                    intervals.push((entry, exit));
                }
            },
        );
        let mut best = escape_distance(&mut intervals);
        let mut escape = if best.is_infinite() {
            Vector::ZERO
        } else {
            directions[0] * best
        };
        let max_direction_length = directions
            .iter()
            .copied()
            .map(axis_length)
            .fold(0.0_f64, f64::max);
        let limit = (best + RECOVERY_TOLERANCE) * max_direction_length + RECOVERY_TOLERANCE;
        let mut slabs = Vec::new();
        let mut ends = Vec::new();
        self.visit_recovery_pairs(obstacles, limit, &mut search, listener, |pair, _, _| {
            slabs.extend_from_slice(pair);
            ends.push((slabs.len(), pair.iter().all(|slab| slab.contains_origin())));
        });
        'search: for &direction in &directions[1..] {
            intervals.clear();
            let mut start = 0;
            let mut reachable = 0.0;
            for &(end, inside) in &ends {
                let (entry, exit) = if inside {
                    (0.0, contained_exit(&slabs[start..end], direction))
                } else {
                    interval(&slabs[start..end], direction)
                };
                start = end;
                if exit > 0.0 && entry < exit {
                    if entry <= reachable + RECOVERY_TOLERANCE && exit > reachable {
                        reachable = exit;
                    }
                    if reachable >= best - RECOVERY_TOLERANCE {
                        continue 'search;
                    }
                    intervals.push((entry, exit));
                }
            }
            let distance = escape_distance(&mut intervals);
            if distance < best - RECOVERY_TOLERANCE {
                best = distance;
                escape = direction * distance;
            }
        }
        if best > 0.0 && !best.is_infinite() {
            self.set_transform(body, search.origin + escape, self.bodies[&body].angle());
        }
    }

    fn visit_recovery_pairs(
        &mut self,
        obstacles: &[(BodyId, f64)],
        limit: f64,
        search: &mut RecoverySearch,
        listener: &mut impl ContactListener<T>,
        mut visit: impl FnMut(&[Slab], f64, f64),
    ) {
        let body = search.body;
        for &(other, radius) in obstacles {
            if other == body
                || !intersects(
                    self.bodies[&other].xf.p - search.origin,
                    search.reach + radius,
                    search.rays[0],
                    limit,
                )
            {
                continue;
            }
            for index_a in (0..self.bodies[&body].fixtures.len()).rev() {
                let a = self.bodies[&body].fixtures[index_a];
                if !self.fixtures[&a].physical {
                    continue;
                }
                for index_b in (0..self.bodies[&other].fixtures.len()).rev() {
                    let b = self.bodies[&other].fixtures[index_b];
                    if !self.fixtures[&b].physical
                        || !listener.can_contact(&self.fixtures[&a], &self.fixtures[&b])
                    {
                        continue;
                    }
                    if let Some((entry, exit)) = search.pair_slabs(self, a, b, limit) {
                        visit(&search.temporary, entry, exit);
                    }
                }
            }
        }
    }
}
