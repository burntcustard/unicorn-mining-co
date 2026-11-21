//! Cached local outlines and swept clearance used by NPC navigation.

use std::sync::Arc;

use crate::specs::Point;
use crate::utilities::vector::Vector;
use crate::utilities::vector_math::RotValue;

#[derive(Clone, Debug)]
pub struct Obstacle {
    pub entity_id: i64,
    pub station: bool,
    pub asteroid: bool,
    pub position: Vector,
    pub velocity: Vector,
    pub acceleration: Vector,
    pub radius: f64,
    pub physical_radius: f64,
    pub spin: f64,
    pub inverse_rotation: Option<RotValue>,
    pub polygon: Option<Arc<ObstacleGeometry>>,
}

impl Obstacle {
    pub fn circle(position: Vector, radius: f64) -> Self {
        Self {
            entity_id: 0,
            station: false,
            asteroid: false,
            position,
            velocity: Vector::ZERO,
            acceleration: Vector::ZERO,
            radius,
            physical_radius: 0.0,
            spin: 0.0,
            inverse_rotation: None,
            polygon: None,
        }
    }

    /// Extrapolate observed tangential acceleration and turning without reversing after a stop.
    pub fn position_at(&self, mut seconds: f64) -> Vector {
        let speed = self.velocity.length();
        if speed < 1.0 {
            return self.position;
        }
        if self.acceleration.length_squared() == 0.0 {
            return self.position.add_scaled(self.velocity, seconds);
        }
        let direction = self.velocity * (1.0 / speed);
        let tangent = self.acceleration.dot(direction);
        let turn = self.velocity.cross(self.acceleration) / (speed * speed);
        if tangent < 0.0 {
            seconds = seconds.min(-speed / tangent);
        }
        if turn.abs() < 0.001 {
            return self.position.add_scaled(
                direction,
                speed * seconds + tangent * seconds * seconds * 0.5,
            );
        }
        let (sine, cosine) = (turn * seconds).sin_cos();
        let x = speed * sine / turn
            + tangent * (seconds * sine / turn + (cosine - 1.0) / (turn * turn));
        let y = speed * (1.0 - cosine) / turn
            + tangent * (-seconds * cosine / turn + sine / (turn * turn));
        self.position + (direction * x + Vector::new(-direction.y, direction.x) * y)
    }

    fn local(&self, point: Vector) -> Vector {
        let local = point - self.position;
        self.inverse_rotation
            .map_or(local, |rotation| rotation.rotate(local))
    }

    pub fn distance(&self, point: Vector) -> f64 {
        let local = self.local(point);
        self.polygon.as_ref().map_or_else(
            || local.length() - self.radius,
            |polygon| polygon.distance(local),
        )
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MotionObservation {
    pub velocity: Vector,
    pub acceleration: Vector,
    pub tick: u64,
}

impl MotionObservation {
    pub fn acceleration_at(
        self,
        velocity: Vector,
        tick: u64,
        simulation_step: f64,
        decision_interval: f64,
    ) -> Vector {
        let dt = tick.wrapping_sub(self.tick) as f64 * simulation_step;
        if dt > 0.0 && dt <= decision_interval * 2.0 {
            (velocity - self.velocity) * (1.0 / dt)
        } else if dt == 0.0 {
            self.acceleration
        } else {
            Vector::ZERO
        }
    }
}

pub fn clear_segment<'a>(
    from: Vector,
    to: Vector,
    radius: f64,
    obstacles: impl IntoIterator<Item = &'a Obstacle>,
    escape: bool,
) -> bool {
    let left = from.x.min(to.x);
    let right = from.x.max(to.x);
    let top = from.y.min(to.y);
    let bottom = from.y.max(to.y);
    let direction = to - from;
    for object in obstacles {
        let reach = object.radius + radius;
        if object.position.x < left - reach
            || object.position.x > right + reach
            || object.position.y < top - reach
            || object.position.y > bottom + reach
            || point_segment_distance_squared(object.position, from, to) >= reach * reach
        {
            continue;
        }
        if object
            .polygon
            .as_ref()
            .is_some_and(|polygon| polygon.clear(object.local(from), object.local(to), radius))
        {
            continue;
        }
        if !escape {
            return false;
        }
        if object.polygon.is_none() {
            let offset = from - object.position;
            let initial = offset.length();
            if initial >= reach
                || offset.dot(direction) < 0.0
                || to.distance_squared(object.position) <= (initial + 0.01) * (initial + 0.01)
            {
                return false;
            }
            continue;
        }
        let initial = object.distance(from);
        if initial >= radius {
            return false;
        }
        let mut previous = initial;
        let steps = 2.max((direction.length() / 10.0_f64.max(radius * 0.25)).ceil() as usize);
        for step in 1..=steps {
            let distance = object.distance(from.add_scaled(direction, step as f64 / steps as f64));
            if distance < previous - 0.01 {
                return false;
            }
            previous = distance;
        }
        if previous <= initial + 0.01 {
            return false;
        }
    }
    true
}

pub(super) fn point_segment_distance_squared(point: Vector, from: Vector, to: Vector) -> f64 {
    let direction = to - from;
    let length = direction.length_squared();
    if length == 0.0 {
        return point.distance_squared(from);
    }
    let along = ((point - from).dot(direction) / length).clamp(0.0, 1.0);
    point.distance_squared(from.add_scaled(direction, along))
}

fn crosses_ray(point: Vector, from: Vector, to: Vector) -> bool {
    (from.y > point.y) != (to.y > point.y)
        && point.x < (to.x - from.x) * (point.y - from.y) / (to.y - from.y) + from.x
}

fn segments_intersect(a: Vector, b: Vector, c: Vector, d: Vector, tolerance: f64) -> bool {
    let (ab, cd) = (b - a, d - c);
    let denominator = ab.cross(cd);
    if denominator.abs() <= tolerance {
        return false;
    }
    let offset = c - a;
    let (u, v) = (
        offset.cross(cd) / denominator,
        offset.cross(ab) / denominator,
    );
    (0.0..=1.0).contains(&u) && (0.0..=1.0).contains(&v)
}

fn segment_distance_squared(a: Vector, b: Vector, c: Vector, d: Vector) -> f64 {
    if segments_intersect(a, b, c, d, 0.0) {
        return 0.0;
    }
    point_segment_distance_squared(a, c, d)
        .min(point_segment_distance_squared(b, c, d))
        .min(point_segment_distance_squared(c, a, b))
        .min(point_segment_distance_squared(d, a, b))
}

#[derive(Debug)]
pub struct ObstacleGeometry {
    points: Vec<Vector>,
    minimum: Vector,
    maximum: Vector,
    radius: f64,
    inner_radius: f64,
    padding: f64,
}

impl ObstacleGeometry {
    pub fn new(points: &[Point], padding: f64) -> Option<Self> {
        if points.len() < 3 {
            return None;
        }
        let points: Vec<_> = points.iter().map(|&[x, y]| Vector::new(x, y)).collect();
        let mut shape = Self {
            points,
            minimum: Vector::new(f64::INFINITY, f64::INFINITY),
            maximum: Vector::new(f64::NEG_INFINITY, f64::NEG_INFINITY),
            radius: 0.0,
            inner_radius: f64::INFINITY,
            padding: 0.0,
        };
        let mut area = 0.0;
        let mut previous = shape.points[shape.points.len() - 1];
        for &point in &shape.points {
            area += previous.x * point.y - previous.y * point.x;
            shape.minimum.x = shape.minimum.x.min(point.x);
            shape.minimum.y = shape.minimum.y.min(point.y);
            shape.maximum.x = shape.maximum.x.max(point.x);
            shape.maximum.y = shape.maximum.y.max(point.y);
            shape.radius = shape.radius.max(point.length_squared());
            shape.inner_radius = shape.inner_radius.min(point_segment_distance_squared(
                Vector::ZERO,
                previous,
                point,
            ));
            previous = point;
        }
        if area == 0.0 {
            return None;
        }
        shape.radius = shape.radius.sqrt();
        shape.inner_radius = if shape.distance(Vector::ZERO) >= 0.0 {
            0.0
        } else {
            shape.inner_radius.sqrt()
        };
        shape.padding = padding;
        shape.radius += padding;
        Some(shape)
    }

    pub fn radius(&self) -> f64 {
        self.radius
    }

    pub fn distance(&self, point: Vector) -> f64 {
        let mut nearest = f64::INFINITY;
        let mut inside = false;
        let mut from = self.points[self.points.len() - 1];
        for &to in &self.points {
            nearest = nearest.min(point_segment_distance_squared(point, from, to));
            if crosses_ray(point, from, to) {
                inside = !inside;
            }
            from = to;
        }
        let distance = nearest.sqrt();
        (if inside { -distance } else { distance }) - self.padding
    }

    pub fn clear(&self, from: Vector, to: Vector, mut radius: f64) -> bool {
        radius += self.padding;
        if from.x.min(to.x) > self.maximum.x + radius
            || from.x.max(to.x) < self.minimum.x - radius
            || from.y.min(to.y) > self.maximum.y + radius
            || from.y.max(to.y) < self.minimum.y - radius
        {
            return true;
        }
        let inner = self.inner_radius + radius;
        if self.inner_radius > 0.0
            && point_segment_distance_squared(Vector::ZERO, from, to) < inner * inner
        {
            return false;
        }
        let mut inside = false;
        let mut a = self.points[self.points.len() - 1];
        for &b in &self.points {
            if segment_distance_squared(from, to, a, b) < radius * radius {
                return false;
            }
            if crosses_ray(from, a, b) {
                inside = !inside;
            }
            a = b;
        }
        !inside
    }
}

use std::collections::HashMap;
use std::f64::consts::{PI, SQRT_2};

use crate::collision::PolygonShape;
use crate::gameplay::collision_world::{ColliderPart, CollisionEntity, ObjectCollider};
use crate::gameplay::game_collisions::ColliderGeometry;
use crate::objects::ship::Ship;

#[derive(Clone, Copy, Debug, Default)]
pub struct CaptureOptions {
    pub ship_id: i64,
    pub ignore_id: i64,
    pub target_id: i64,
    pub can_collect: bool,
    pub collecting: bool,
    pub following: bool,
    pub tick: u64,
    pub entity_count: usize,
    pub simulation_step: f64,
    pub decision_interval: f64,
    pub minimum_speed_squared: f64,
    pub linear_slop: f64,
}

#[derive(Default)]
pub struct ObstacleSnapshot {
    objects: Vec<Obstacle>,
    geometry: HashMap<(i64, u64), Arc<ObstacleGeometry>>,
    motion: HashMap<i64, MotionObservation>,
}

impl ObstacleSnapshot {
    pub fn capture<'a, E: CollisionEntity<Collider = ObjectCollider> + 'a>(
        &mut self,
        options: CaptureOptions,
        entities: impl IntoIterator<Item = &'a E>,
        asteroid_outline: impl Fn(&'a E) -> Option<(&'a [Point], Option<u64>)>,
    ) -> &[Obstacle] {
        self.objects.clear();
        let limit = options.entity_count * 2 + 32;
        if self.geometry.len() > limit {
            self.geometry.clear();
        }
        if self.motion.len() > limit {
            self.motion.clear();
        }
        for entity in entities {
            let object = entity.object();
            if object.id == options.ship_id
                || object.id == options.ignore_id
                || object.dead
                || object.buried
                || object.item && options.can_collect
            {
                continue;
            }
            let station = object.kind == "station";
            let asteroid = object.kind == "asteroid";
            let mut obstacle = Obstacle {
                entity_id: object.id,
                station,
                asteroid,
                velocity: object.velocity,
                spin: object.spin,
                ..Obstacle::circle(object.position, object.radius)
            };
            if asteroid {
                if !object.physics {
                    continue;
                }
                let (outline, revision) = asteroid_outline(entity).unwrap_or((&[], None));
                let token = revision.map(|source| (object.id, source));
                obstacle.polygon = token.and_then(|token| self.geometry.get(&token).cloned());
                if obstacle.polygon.is_none() {
                    obstacle.polygon = ObstacleGeometry::new(outline, 0.0).map(Arc::new);
                    if let (Some(token), Some(geometry)) = (token, &obstacle.polygon) {
                        self.geometry.insert(token, Arc::clone(geometry));
                    }
                }
            } else {
                let precise = station
                    && (options.collecting || object.id == options.target_id && options.following);
                let (radius, polygon) = physical_bounds(entity, precise, options.linear_slop);
                if radius == 0.0 {
                    continue;
                }
                obstacle.radius = if station && !precise {
                    radius.max(object.radius)
                } else {
                    radius
                };
                obstacle.physical_radius = if station { radius } else { 0.0 };
                obstacle.polygon = polygon.map(Arc::new);
            }
            if let Some(polygon) = &obstacle.polygon {
                obstacle.radius = obstacle.radius.max(polygon.radius());
                let (sin, cos) = (-object.rotation).sin_cos();
                obstacle.inverse_rotation = Some(RotValue { sin, cos });
            }
            let previous = self.motion.get(&object.id).copied();
            if previous.is_some()
                || object.velocity.length_squared() >= options.minimum_speed_squared
            {
                obstacle.acceleration = previous.map_or(Vector::ZERO, |previous| {
                    previous.acceleration_at(
                        object.velocity,
                        options.tick,
                        options.simulation_step,
                        options.decision_interval,
                    )
                });
                self.motion.insert(
                    object.id,
                    MotionObservation {
                        velocity: object.velocity,
                        acceleration: obstacle.acceleration,
                        tick: options.tick,
                    },
                );
            }
            self.objects.push(obstacle);
        }
        &self.objects
    }
}

pub fn physical_bounds<E: CollisionEntity>(
    entity: &E,
    outline: bool,
    linear_slop: f64,
) -> (f64, Option<ObstacleGeometry>) {
    let object = entity.object();
    let (sin, cos) = (-object.rotation).sin_cos();
    let inverse = RotValue { sin, cos };
    let mut vertices = Vec::new();
    let mut radius = 0.0_f64;
    let mut padding = 0.0_f64;
    entity.with_colliders(|colliders| {
        for collider in colliders
            .iter()
            .filter(|collider| collider.collides && collider.physical)
        {
            let center = inverse.rotate(collider.pose.position - object.position);
            if let Some(points) = collider.outline.filter(|outline| !outline.is_empty()) {
                let margin = collider.collision_margin.unwrap_or(2.0 * linear_slop);
                padding = padding.max(SQRT_2 * margin);
                let angle = collider.pose.rotation - object.rotation;
                let (sin, cos) = angle.sin_cos();
                let rotation = RotValue { sin, cos };
                for &[x, y] in points {
                    let point = Vector::new(x, y);
                    let local = if angle == 0.0 {
                        point
                    } else {
                        rotation.rotate(point)
                    } + center;
                    radius = radius.max(local.length() + margin);
                    if outline {
                        vertices.push(local);
                    }
                }
            } else {
                radius = radius.max(center.length() + collider.radius);
                if outline {
                    let outer = collider.radius / (PI / 8.0).cos();
                    for index in 0..8 {
                        let angle = (f64::from(index) + 0.5) * PI / 4.0;
                        let (sin, cos) = angle.sin_cos();
                        vertices.push(center.add_scaled(Vector::new(cos, sin), outer));
                    }
                }
            }
        }
    });
    if !outline || vertices.len() < 3 {
        return (radius, None);
    }
    let hull = PolygonShape::new(&vertices, Some(0.0), linear_slop);
    let points: Vec<_> = hull
        .base
        .vertices()
        .iter()
        .map(|point| [point.x, point.y])
        .collect();
    (radius, ObstacleGeometry::new(&points, padding))
}

pub const SIGHT_RANGE: f64 = 1500.0;

pub fn can_see<'a, E: CollisionEntity<Collider = ObjectCollider> + 'a>(
    ship: &Ship,
    other: &Ship,
    same_world_and_resident: bool,
    entities: impl IntoIterator<Item = &'a E>,
) -> bool {
    let origin = &ship.craft.object;
    let target = &other.craft.object;
    if origin.id == target.id
        || !same_world_and_resident
        || target.dead
        || other.craft.docked_to.is_some()
        || other.craft.transit_time != 0.0
    {
        return false;
    }
    let distance = origin.position.distance_squared(target.position);
    if distance <= 1000.0 * 1000.0 {
        return true;
    }
    if distance > SIGHT_RANGE * SIGHT_RANGE {
        return false;
    }
    for entity in entities {
        let object = entity.object();
        let station = object.kind == "station";
        if object.dead
            || object.buried
            || !station && object.kind != "asteroid" && object.kind != "jumpGate"
            || point_segment_distance_squared(object.position, origin.position, target.position)
                > object.radius * object.radius
        {
            continue;
        }
        let mut blocked = false;
        entity.with_colliders(|colliders| {
            blocked = colliders.iter().any(|collider| {
                !collider.pickup_point
                    && (collider.physical
                        || station && matches!(collider.user_data.part, ColliderPart::Hull(_)))
                    && blocks_sight(origin.position, target.position, collider)
            });
        });
        if blocked {
            return false;
        }
    }
    true
}

fn blocks_sight(from: Vector, to: Vector, collider: &ColliderGeometry<'_, ObjectCollider>) -> bool {
    let (sin, cos) = (-collider.pose.rotation).sin_cos();
    let rotation = RotValue { sin, cos };
    let from = rotation.rotate(from - collider.pose.position);
    let to = rotation.rotate(to - collider.pose.position);
    let Some(outline) = collider.outline.filter(|outline| !outline.is_empty()) else {
        return point_segment_distance_squared(Vector::ZERO, from, to)
            <= collider.radius * collider.radius;
    };
    let mut inside = false;
    for (index, &[x, y]) in outline.iter().enumerate() {
        let [next_x, next_y] = outline[(index + 1) % outline.len()];
        let start = Vector::new(x, y);
        let end = Vector::new(next_x, next_y);
        if segments_intersect(from, to, start, end, 1e-9) {
            return true;
        }
        if crosses_ray(from, start, end) {
            inside = !inside;
        }
    }
    inside
}
