//! Contact material properties and position and velocity constraints.

use crate::collision::{Manifold, ManifoldType, Shape, WorldManifold};
use crate::collision::{
    circle_circle_contact::collide_circles, polygon_circle_contact::collide_polygon_circle,
    polygon_polygon_contact::collide_polygons_cached,
};
use crate::utilities::vector::Vector;
use crate::utilities::vector_math::TransformValue;

use super::body::{Position, Velocity};
use super::{Body, BodyId, Fixture, FixtureId, PairKey, PhysicsRules};

const VELOCITY_IMPULSE_TOLERANCE: f64 = 1e-7;

#[derive(Clone, Copy, Debug, Default)]
struct Mat22 {
    x: Vector,
    y: Vector,
}

impl Mat22 {
    fn multiply(self, value: Vector) -> Vector {
        Vector::new(
            self.x.x * value.x + self.y.x * value.y,
            self.x.y * value.x + self.y.y * value.y,
        )
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct VelocityPoint {
    ra: Vector,
    rb: Vector,
    normal_impulse: f64,
    tangent_impulse: f64,
    normal_mass: f64,
    tangent_mass: f64,
    velocity_bias: f64,
}

#[derive(Debug, Default)]
struct Constraint {
    normal: Vector,
    normal_mass: Mat22,
    k: Mat22,
    inv_mass_a: f64,
    inv_mass_b: f64,
    inv_inertia_a: f64,
    inv_inertia_b: f64,
    radius_a: f64,
    radius_b: f64,
    points: [VelocityPoint; 2],
    velocity_count: usize,
}

#[derive(Debug)]
pub struct Contact {
    pub fixture_a: FixtureId,
    pub fixture_b: FixtureId,
    pub body_a: BodyId,
    pub body_b: BodyId,
    pub manifold: Manifold,
    pub friction: f64,
    pub restitution: f64,
    pub surface_speed: f64,
    pub enabled: bool,
    pub touching: bool,
    pub physical: bool,
    pub(super) list_index: usize,
    pub(super) separation_until: f64,
    pub(super) pair: PairKey,
    pub(super) separation_cache: [u8; 2],
    pub(super) island: bool,
    pub(super) toi: f64,
    pub(super) toi_valid: bool,
    pub(super) toi_count: u8,
    pub(super) toi_queue: ToiQueue,
    pub(super) toi_index: usize,
    constraint: Option<Box<Constraint>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ToiQueue {
    None,
    Pending,
    Ready,
}

impl Contact {
    pub(super) fn new<T>(
        first: (FixtureId, &Fixture<T>),
        second: (FixtureId, &Fixture<T>),
        list_index: usize,
    ) -> Self {
        let (a, b) = if matches!(
            (&first.1.shape, &second.1.shape),
            (Shape::Circle(_), Shape::Polygon(_))
        ) {
            (second, first)
        } else {
            (first, second)
        };
        Self {
            fixture_a: a.0,
            fixture_b: b.0,
            body_a: a.1.body,
            body_b: b.1.body,
            manifold: Manifold::default(),
            friction: 0.0,
            restitution: 0.0,
            surface_speed: 0.0,
            enabled: true,
            touching: false,
            physical: a.1.physical && b.1.physical,
            list_index,
            separation_until: 0.0,
            pair: PairKey::new(a.1.body, b.1.body),
            separation_cache: [0; 2],
            island: false,
            toi: 1.0,
            toi_valid: false,
            toi_count: 0,
            toi_queue: ToiQueue::None,
            toi_index: 0,
            constraint: None,
        }
    }

    pub(super) fn reuse_constraint(&mut self, mut previous: Self) {
        self.constraint = previous.constraint.take();
    }

    pub(super) fn other(&self, body: BodyId) -> BodyId {
        if self.body_a == body {
            self.body_b
        } else {
            self.body_a
        }
    }

    pub fn world_manifold<T>(
        &self,
        fixture_a: &Fixture<T>,
        body_a: &Body,
        fixture_b: &Fixture<T>,
        body_b: &Body,
    ) -> WorldManifold {
        let mut result = WorldManifold::default();
        self.manifold.world_manifold(
            &mut result,
            body_a.xf,
            fixture_a.shape.base().radius,
            body_b.xf,
            fixture_b.shape.base().radius,
        );
        result
    }

    pub(super) fn init_constraint<T>(
        &mut self,
        fixture_a: &Fixture<T>,
        body_a: &Body,
        fixture_b: &Fixture<T>,
        body_b: &Body,
    ) {
        let constraint = self.constraint.get_or_insert_with(Box::default);
        constraint.inv_mass_a = body_a.inv_mass;
        constraint.inv_mass_b = body_b.inv_mass;
        constraint.inv_inertia_a = body_a.inv_inertia;
        constraint.inv_inertia_b = body_b.inv_inertia;
        constraint.radius_a = fixture_a.shape.base().radius;
        constraint.radius_b = fixture_b.shape.base().radius;
        constraint.velocity_count = self.manifold.point_count;
        for point in &mut constraint.points[..self.manifold.point_count] {
            point.normal_impulse = 0.0;
            point.tangent_impulse = 0.0;
        }
    }

    pub(super) fn solve_position(
        &self,
        a: &mut Body,
        b: &mut Body,
        rules: PhysicsRules,
        toi: Option<[BodyId; 2]>,
    ) -> f64 {
        let Some(constraint) = &self.constraint else {
            return 0.0;
        };
        let (mass_a, inertia_a) = if toi.is_none_or(|bodies| bodies.contains(&self.body_a)) {
            (constraint.inv_mass_a, constraint.inv_inertia_a)
        } else {
            (0.0, 0.0)
        };
        let (mass_b, inertia_b) = if toi.is_none_or(|bodies| bodies.contains(&self.body_b)) {
            (constraint.inv_mass_b, constraint.inv_inertia_b)
        } else {
            (0.0, 0.0)
        };
        let (mut pos_a, mut pos_b) = (a.solver_position, b.solver_position);
        let baumgarte = if toi.is_none() {
            rules.physics.position_baumgarte
        } else {
            rules.physics.toi_baumgarte
        };
        let mut min_separation = 0.0_f64;
        for &local_contact in &self.manifold.points[..self.manifold.point_count] {
            let xf_a = TransformValue::new(pos_a.c, pos_a.a);
            let xf_b = TransformValue::new(pos_b.c, pos_b.a);
            let local_point = self.manifold.local_point;
            let local_normal = self.manifold.local_normal;
            let (normal, point, separation) = match self.manifold.kind {
                ManifoldType::None => return min_separation,
                ManifoldType::Circles => {
                    let point_a = xf_a.transform(local_point);
                    let point_b = xf_b.transform(self.manifold.points[0]);
                    let normal = (point_b - point_a).normalized();
                    (
                        normal,
                        Vector::combine2(0.5, point_a, 0.5, point_b),
                        point_b.dot(normal) - point_a.dot(normal),
                    )
                }
                ManifoldType::FaceA => {
                    let normal = xf_a.q.rotate(local_normal);
                    let plane_point = xf_a.transform(local_point);
                    let clip_point = xf_b.transform(local_contact);
                    (
                        normal,
                        clip_point,
                        clip_point.dot(normal) - plane_point.dot(normal),
                    )
                }
                ManifoldType::FaceB => {
                    let normal = xf_b.q.rotate(local_normal);
                    let plane_point = xf_b.transform(local_point);
                    let clip_point = xf_a.transform(local_contact);
                    (
                        normal * -1.0,
                        clip_point,
                        clip_point.dot(normal) - plane_point.dot(normal),
                    )
                }
            };
            let separation = separation - constraint.radius_a - constraint.radius_b;
            let (ra, rb) = (point - pos_a.c, point - pos_b.c);
            min_separation = min_separation.min(separation);
            let correction = (baumgarte * (separation + rules.linear_slop))
                .min(0.0)
                .max(-rules.physics.max_linear_correction);
            let (rna, rnb) = (ra.cross(normal), rb.cross(normal));
            let k = mass_a + mass_b + inertia_a * rna * rna + inertia_b * rnb * rnb;
            let impulse = if k > 0.0 { -correction / k } else { 0.0 };
            let push = normal * impulse;
            pos_a.c = pos_a.c.add_scaled(push, -mass_a);
            pos_a.a -= inertia_a * ra.cross(push);
            pos_b.c = pos_b.c.add_scaled(push, mass_b);
            pos_b.a += inertia_b * rb.cross(push);
        }
        a.solver_position = pos_a;
        b.solver_position = pos_b;
        min_separation
    }

    pub(super) fn init_velocity(&mut self, a: &Body, b: &Body, speed_threshold: f64) {
        let Some(constraint) = &mut self.constraint else {
            return;
        };
        let (Position { c: ca, a: aa }, Position { c: cb, a: ab }) =
            (a.solver_position, b.solver_position);
        let (Velocity { v: va, w: wa }, Velocity { v: vb, w: wb }) =
            (a.solver_velocity, b.solver_velocity);
        let (ma, mb, ia, ib) = (
            constraint.inv_mass_a,
            constraint.inv_mass_b,
            constraint.inv_inertia_a,
            constraint.inv_inertia_b,
        );
        let xf_a = TransformValue::new(ca, aa);
        let xf_b = TransformValue::new(cb, ab);
        let mut world = WorldManifold::default();
        self.manifold.world_manifold(
            &mut world,
            xf_a,
            constraint.radius_a,
            xf_b,
            constraint.radius_b,
        );
        constraint.normal = world.normal;
        let normal = world.normal;
        let tangent = normal.cross_scalar(1.0);
        for (point, world_point) in constraint
            .points
            .iter_mut()
            .zip(world.points)
            .take(constraint.velocity_count)
        {
            point.ra = world_point - ca;
            point.rb = world_point - cb;
            let (rna, rnb) = (point.ra.cross(normal), point.rb.cross(normal));
            point.normal_mass = 1.0 / (ma + mb + ia * rna * rna + ib * rnb * rnb);
            let (rta, rtb) = (point.ra.cross(tangent), point.rb.cross(tangent));
            point.tangent_mass = 1.0 / (ma + mb + ia * rta * rta + ib * rtb * rtb);
            point.velocity_bias = 0.0;
            let mut relative = 0.0;
            relative += normal.dot(vb);
            relative += normal.dot(point.rb.cross_scalar(-wb));
            relative -= normal.dot(va);
            relative -= normal.dot(point.ra.cross_scalar(-wa));
            if self.surface_speed != 0.0 {
                relative -= self.surface_speed;
                point.velocity_bias = self.surface_speed;
            }
            if relative < -speed_threshold {
                point.velocity_bias -= self.restitution * relative;
            }
        }
        if constraint.velocity_count == 2 {
            let [one, two] = constraint.points;
            let (rn1a, rn1b) = (one.ra.cross(normal), one.rb.cross(normal));
            let (rn2a, rn2b) = (two.ra.cross(normal), two.rb.cross(normal));
            let k11 = ma + mb + ia * rn1a * rn1a + ib * rn1b * rn1b;
            let k22 = ma + mb + ia * rn2a * rn2a + ib * rn2b * rn2b;
            let k12 = ma + mb + ia * rn1a * rn2a + ib * rn1b * rn2b;
            let determinant = k11 * k22 - k12 * k12;
            if k11 * k11 < 1000.0 * determinant {
                constraint.k = Mat22 {
                    x: Vector::new(k11, k12),
                    y: Vector::new(k12, k22),
                };
                let inverse = 1.0 / determinant;
                constraint.normal_mass = Mat22 {
                    x: Vector::new(inverse * k22, -inverse * k12),
                    y: Vector::new(-inverse * k12, inverse * k11),
                };
            } else {
                constraint.velocity_count = 1;
            }
        }
    }

    pub(super) fn solve_velocity(&mut self, a: &mut Body, b: &mut Body) -> bool {
        let Some(constraint) = &mut self.constraint else {
            return true;
        };
        let (mut va, mut vb) = (a.solver_velocity, b.solver_velocity);
        let (ma, mb, ia, ib) = (
            constraint.inv_mass_a,
            constraint.inv_mass_b,
            constraint.inv_inertia_a,
            constraint.inv_inertia_b,
        );
        let normal = constraint.normal;
        let tangent = normal.cross_scalar(1.0);
        let mut converged = true;
        let mut impulse = |va: &mut Velocity,
                           vb: &mut Velocity,
                           contact: &VelocityPoint,
                           direction: Vector,
                           old: f64,
                           new: f64| {
            let delta = new - old;
            converged = converged && impulse_converged(delta, new);
            let push = direction * delta;
            va.v = va.v.add_scaled(push, -ma);
            va.w -= ia * contact.ra.cross(push);
            vb.v = vb.v.add_scaled(push, mb);
            vb.w += ib * contact.rb.cross(push);
        };
        for contact in &mut constraint.points[..constraint.velocity_count] {
            let relative = relative_velocity(va, vb, contact);
            let lambda = contact.tangent_mass * -relative.dot(tangent);
            let max_friction = self.friction * contact.normal_impulse;
            let new = (contact.tangent_impulse + lambda)
                .min(max_friction)
                .max(-max_friction);
            impulse(
                &mut va,
                &mut vb,
                contact,
                tangent,
                contact.tangent_impulse,
                new,
            );
            contact.tangent_impulse = new;
        }
        if constraint.velocity_count == 1 {
            let contact = &mut constraint.points[0];
            let relative = relative_velocity(va, vb, contact);
            let lambda = -contact.normal_mass * (relative.dot(normal) - contact.velocity_bias);
            let new = (contact.normal_impulse + lambda).max(0.0);
            impulse(
                &mut va,
                &mut vb,
                contact,
                normal,
                contact.normal_impulse,
                new,
            );
            contact.normal_impulse = new;
        } else {
            let [one, two] = &mut constraint.points;
            let old = Vector::new(one.normal_impulse, two.normal_impulse);
            let dv1 = relative_velocity(va, vb, one);
            let dv2 = relative_velocity(va, vb, two);
            let bias = Vector::new(
                dv1.dot(normal) - one.velocity_bias,
                dv2.dot(normal) - two.velocity_bias,
            ) - constraint.k.multiply(old);
            let full = -constraint.normal_mass.multiply(bias);
            let first = -one.normal_mass * bias.x;
            let second = -two.normal_mass * bias.y;
            let new = if full.x >= 0.0 && full.y >= 0.0 {
                Some(full)
            } else if first >= 0.0 && constraint.k.x.y * first + bias.y >= 0.0 {
                Some(Vector::new(first, 0.0))
            } else if second >= 0.0 && constraint.k.y.x * second + bias.x >= 0.0 {
                Some(Vector::new(0.0, second))
            } else if bias.x >= 0.0 && bias.y >= 0.0 {
                Some(Vector::ZERO)
            } else {
                None
            };
            if let Some(new) = new {
                let delta = new - old;
                converged = converged
                    && impulse_converged(delta.x, new.x)
                    && impulse_converged(delta.y, new.y);
                let (p1, p2) = (normal * delta.x, normal * delta.y);
                va.v = Vector::combine3(-ma, p1, -ma, p2, 1.0, va.v);
                va.w -= ia * (one.ra.cross(p1) + two.ra.cross(p2));
                vb.v = Vector::combine3(mb, p1, mb, p2, 1.0, vb.v);
                vb.w += ib * (one.rb.cross(p1) + two.rb.cross(p2));
                one.normal_impulse = new.x;
                two.normal_impulse = new.y;
            }
        }
        a.solver_velocity = va;
        b.solver_velocity = vb;
        converged
    }
}

pub(super) fn evaluate(
    manifold: &mut Manifold,
    a: &Shape,
    xf_a: TransformValue,
    b: &Shape,
    xf_b: TransformValue,
    slop: f64,
    cache: &mut [u8; 2],
) -> f64 {
    match (a, b) {
        (Shape::Circle(a), Shape::Circle(b)) => collide_circles(manifold, a, xf_a, b, xf_b),
        (Shape::Polygon(a), Shape::Circle(b)) => collide_polygon_circle(manifold, a, xf_a, b, xf_b),
        (Shape::Polygon(a), Shape::Polygon(b)) => {
            return collide_polygons_cached(manifold, a, xf_a, b, xf_b, slop, cache);
        }
        (Shape::Circle(_), Shape::Polygon(_)) => {
            unreachable!("contact construction puts polygon first")
        }
    }
    0.0
}

fn relative_velocity(a: Velocity, b: Velocity, point: &VelocityPoint) -> Vector {
    Vector::ZERO + b.v + point.rb.cross_scalar(-b.w) - a.v - point.ra.cross_scalar(-a.w)
}

fn impulse_converged(change: f64, new: f64) -> bool {
    change.abs() <= VELOCITY_IMPULSE_TOLERANCE * (1.0 + new.abs())
}
