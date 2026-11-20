//! Reusable local shapes and their contact manifolds.

use std::sync::{Arc, OnceLock};

use crate::vector::{TransformValue, Vector};

use super::{Aabb, Manifold, ManifoldType, clip_segment_to_line};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bound {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub offset_radius: f64,
}

#[derive(Clone, Debug)]
pub struct BaseShape {
    pub radius: f64,
    data: Arc<[Vector]>,
    count: usize,
    bound: OnceLock<Bound>,
}

impl BaseShape {
    fn new(radius: f64, data: Vec<Vector>, count: usize) -> Self {
        Self {
            radius,
            data: data.into(),
            count,
            bound: OnceLock::new(),
        }
    }

    pub fn segment(vertices: [Vector; 2]) -> Self {
        Self::new(0.0, vertices.to_vec(), 2)
    }

    pub fn vertices(&self) -> &[Vector] {
        &self.data[..self.count]
    }

    pub fn vertex(&self, index: usize) -> Vector {
        self.vertices()[index]
    }

    pub fn count(&self) -> usize {
        self.count
    }

    pub fn bound(&self) -> &Bound {
        self.bound.get_or_init(|| {
            let mut center = Vector::ZERO;
            for &vertex in self.vertices() {
                center += vertex;
            }
            center.x /= self.count() as f64;
            center.y /= self.count() as f64;
            let mut radius = 0.0_f64;
            for &vertex in self.vertices() {
                radius = radius.max(vertex.distance(center));
            }
            Bound {
                x: center.x,
                y: center.y,
                radius,
                offset_radius: center.length(),
            }
        })
    }

    pub fn support(&self, direction: Vector) -> usize {
        let mut best_index = usize::MAX;
        let mut best_value = f64::NEG_INFINITY;
        for (index, &vertex) in self.vertices().iter().enumerate() {
            let value = vertex.dot(direction);
            if value > best_value {
                best_index = index;
                best_value = value;
            }
        }
        best_index
    }

    pub fn compute_aabb(&self, transform: TransformValue) -> Aabb {
        let mut aabb = Aabb::EMPTY;
        if self.count == 1 {
            let point = transform.transform(self.vertex(0));
            aabb.lower_bound = point;
            aabb.upper_bound = point;
        } else {
            for &vertex in self.vertices() {
                let point = transform.transform(vertex);
                aabb.lower_bound.x = aabb.lower_bound.x.min(point.x);
                aabb.lower_bound.y = aabb.lower_bound.y.min(point.y);
                aabb.upper_bound.x = aabb.upper_bound.x.max(point.x);
                aabb.upper_bound.y = aabb.upper_bound.y.max(point.y);
            }
        }
        aabb.extend(self.radius);
        aabb
    }
}

#[derive(Clone, Debug)]
pub struct CircleShape {
    pub base: BaseShape,
}

impl CircleShape {
    pub fn new(position: Vector, radius: f64) -> Self {
        Self {
            base: BaseShape::new(radius, vec![position], 1),
        }
    }

    pub fn position(&self) -> Vector {
        self.base.vertex(0)
    }
}

#[derive(Clone, Debug)]
pub struct PolygonShape {
    pub base: BaseShape,
    pub centroid: Vector,
}

impl PolygonShape {
    pub fn new(vertices: &[Vector], collision_margin: Option<f64>, linear_slop: f64) -> Self {
        let radius = collision_margin.unwrap_or(2.0 * linear_slop);
        if vertices.is_empty() {
            return Self {
                base: BaseShape::new(radius, Vec::new(), 0),
                centroid: Vector::ZERO,
            };
        }
        let threshold = 0.25 * (linear_slop * linear_slop);
        // Game outlines usually fit in the same sixteen stack slots as the original.
        let mut stack = [Vector::ZERO; 16];
        let mut heap;
        let points = if vertices.len() <= stack.len() {
            &mut stack[..]
        } else {
            heap = vec![Vector::ZERO; vertices.len()];
            &mut heap
        };
        let mut point_count = 0;
        for &vertex in vertices {
            if !points[..point_count]
                .iter()
                .any(|&previous| vertex.distance_squared(previous) < threshold)
            {
                points[point_count] = vertex;
                point_count += 1;
            }
        }
        let points = &points[..point_count];
        if points.len() < 3 {
            return Self::as_box(100.0, 100.0, radius);
        }
        let mut first = 0;
        for (index, point) in points.iter().enumerate().skip(1) {
            if point.x > points[first].x || point.x == points[first].x && point.y < points[first].y
            {
                first = index;
            }
        }
        let mut stack = [0; 16];
        let mut heap;
        let hull = if point_count <= stack.len() {
            &mut stack[..]
        } else {
            heap = vec![0; point_count];
            &mut heap
        };
        let mut count = 0;
        let mut current = first;
        loop {
            hull[count] = current;
            count += 1;
            let mut edge = 0;
            for candidate in 1..points.len() {
                if edge == current {
                    edge = candidate;
                    continue;
                }
                let selected = points[edge] - points[current];
                let alternative = points[candidate] - points[current];
                let cross = selected.cross(alternative);
                let distance = selected.length_squared();
                let candidate_distance = alternative.length_squared();
                let tolerance = 1e-12 * (distance + candidate_distance);
                // Retain the farthest endpoint of rotated collinear model points.
                if cross < -tolerance || cross.abs() <= tolerance && candidate_distance > distance {
                    edge = candidate;
                }
            }
            current = edge;
            if edge == first {
                break;
            }
            if count == point_count {
                return Self::as_box(100.0, 100.0, radius);
            }
        }
        if count < 3 {
            return Self::as_box(100.0, 100.0, radius);
        }
        let mut data = Vec::with_capacity(count * 2);
        data.extend(hull[..count].iter().map(|&index| points[index]));
        let centroid = compute_centroid(&data);
        for index in 0..count {
            let vertex = data[index];
            let next = data[(index + 1) % count];
            data.push(Vector::new(next.y - vertex.y, vertex.x - next.x).normalized());
        }
        Self {
            base: BaseShape::new(radius, data, count),
            centroid,
        }
    }

    pub fn normals(&self) -> &[Vector] {
        &self.base.data[self.base.count..]
    }

    pub fn as_box(hx: f64, hy: f64, radius: f64) -> Self {
        let data = vec![
            Vector::new(hx, -hy),
            Vector::new(hx, hy),
            Vector::new(-hx, hy),
            Vector::new(-hx, -hy),
            Vector::new(1.0, 0.0),
            Vector::new(0.0, 1.0),
            Vector::new(-1.0, 0.0),
            Vector::new(0.0, -1.0),
        ];
        Self {
            base: BaseShape::new(radius, data, 4),
            centroid: Vector::ZERO,
        }
    }
}

fn compute_centroid(vertices: &[Vector]) -> Vector {
    let mut centroid = Vector::ZERO;
    let mut area = 0.0;
    for (index, &first) in vertices.iter().enumerate() {
        let second = vertices[(index + 1) % vertices.len()];
        let triangle_area = 0.5 * first.cross(second);
        area += triangle_area;
        let sum = Vector::combine3(1.0, Vector::ZERO, 1.0, first, 1.0, second);
        centroid = centroid.add_scaled(sum, triangle_area * (1.0 / 3.0));
    }
    centroid * (1.0 / area)
}

#[derive(Clone, Debug)]
pub enum Shape {
    Circle(CircleShape),
    Polygon(PolygonShape),
}

impl Shape {
    pub fn circle(position: Vector, radius: f64) -> Self {
        Self::Circle(CircleShape::new(position, radius))
    }

    pub fn polygon(vertices: &[Vector], collision_margin: Option<f64>, linear_slop: f64) -> Self {
        Self::Polygon(PolygonShape::new(vertices, collision_margin, linear_slop))
    }

    pub fn base(&self) -> &BaseShape {
        match self {
            Self::Circle(shape) => &shape.base,
            Self::Polygon(shape) => &shape.base,
        }
    }
}

pub fn collide_circles(
    manifold: &mut Manifold,
    a: &CircleShape,
    xf_a: TransformValue,
    b: &CircleShape,
    xf_b: TransformValue,
) {
    manifold.point_count = 0;
    let point_a = xf_a.transform(a.position());
    let point_b = xf_b.transform(b.position());
    let distance_squared = point_b.distance_squared(point_a);
    let radius = a.base.radius + b.base.radius;
    if distance_squared > radius * radius {
        return;
    }
    manifold.kind = ManifoldType::Circles;
    manifold.local_point = a.position();
    manifold.local_normal = Vector::ZERO;
    manifold.point_count = 1;
    manifold.points[0] = b.position();
}

pub fn collide_polygon_circle(
    manifold: &mut Manifold,
    a: &PolygonShape,
    xf_a: TransformValue,
    b: &CircleShape,
    xf_b: TransformValue,
) {
    manifold.point_count = 0;
    let circle_local = xf_b.change_transform(xf_a, b.position());
    let mut normal_index = 0;
    let mut separation = f64::NEG_INFINITY;
    let radius = a.base.radius + b.base.radius;
    for (index, &normal) in a.normals().iter().enumerate() {
        let candidate = normal.dot(circle_local) - normal.dot(a.base.vertex(index));
        if candidate > radius {
            return;
        }
        if candidate > separation {
            separation = candidate;
            normal_index = index;
        }
    }
    let first = a.base.vertex(normal_index);
    let second = a.base.vertex((normal_index + 1) % a.base.count());
    let face_center = Vector::combine2(0.5, first, 0.5, second);
    let face_normal = a.normals()[normal_index];
    if separation <= 0.0 {
        manifold.local_normal = face_normal;
        manifold.local_point = face_center;
    } else {
        let u1 = circle_local.dot(second) - circle_local.dot(first) - first.dot(second)
            + first.dot(first);
        let u2 = circle_local.dot(first) - circle_local.dot(second) - second.dot(first)
            + second.dot(second);
        if u1 <= 0.0 {
            if circle_local.distance_squared(first) > radius * radius {
                return;
            }
            manifold.local_normal = (circle_local - first).normalized();
            manifold.local_point = first;
        } else if u2 <= 0.0 {
            if circle_local.distance_squared(second) > radius * radius {
                return;
            }
            manifold.local_normal = (circle_local - second).normalized();
            manifold.local_point = second;
        } else {
            let separation = circle_local.dot(face_normal) - face_center.dot(face_normal);
            if separation > radius {
                return;
            }
            manifold.local_normal = face_normal;
            manifold.local_point = face_center;
        }
    }
    manifold.point_count = 1;
    manifold.kind = ManifoldType::FaceA;
    manifold.points[0] = b.position();
}

fn find_max_separation(
    a: &PolygonShape,
    xf_a: TransformValue,
    b: &PolygonShape,
    xf_b: TransformValue,
    limit: f64,
    start: usize,
) -> (usize, f64) {
    let transform = xf_b.detransform(xf_a);
    let mut best_index = 0;
    let mut max_separation = f64::NEG_INFINITY;
    let count = a.base.count();
    for index in 0..count {
        let mut i = start + index;
        if i >= count {
            i -= count;
        }
        let normal = transform.q.rotate(a.normals()[i]);
        let point = transform.transform(a.base.vertex(i));
        let offset = normal.dot(point);
        let mut separation = f64::INFINITY;
        if offset.is_finite() {
            // Subtracting the same finite offset preserves projection order.
            for &vertex in b.base.vertices() {
                let candidate = normal.dot(vertex);
                if candidate < separation {
                    separation = candidate;
                }
            }
            separation -= offset;
        } else {
            for &vertex in b.base.vertices() {
                let candidate = normal.dot(vertex) - offset;
                if candidate < separation {
                    separation = candidate;
                }
            }
        }
        if separation > limit {
            return (i, separation);
        }
        if separation > max_separation || separation == max_separation && i < best_index {
            max_separation = separation;
            best_index = i;
        }
    }
    (best_index, max_separation)
}

fn find_incident_edge(
    a: &PolygonShape,
    xf_a: TransformValue,
    edge: usize,
    b: &PolygonShape,
    xf_b: TransformValue,
) -> [Vector; 2] {
    let normal_a = xf_b.q.rerotate(xf_a.q, a.normals()[edge]);
    let mut index = 0;
    let mut min_dot = f64::INFINITY;
    for (candidate, &normal) in b.normals().iter().enumerate() {
        let dot = normal_a.dot(normal);
        if dot < min_dot {
            min_dot = dot;
            index = candidate;
        }
    }
    [
        xf_b.transform(b.base.vertex(index)),
        xf_b.transform(b.base.vertex((index + 1) % b.base.count())),
    ]
}

pub fn collide_polygons_cached(
    manifold: &mut Manifold,
    a: &PolygonShape,
    xf_a: TransformValue,
    b: &PolygonShape,
    xf_b: TransformValue,
    linear_slop: f64,
    cache: &mut [u8; 2],
) -> f64 {
    manifold.point_count = 0;
    let total_radius = a.base.radius + b.base.radius;
    let (edge_a, separation_a) =
        find_max_separation(a, xf_a, b, xf_b, total_radius, usize::from(cache[0]));
    cache[0] = edge_a as u8;
    if separation_a > total_radius {
        return separation_a - total_radius;
    }
    let (edge_b, separation_b) =
        find_max_separation(b, xf_b, a, xf_a, total_radius, usize::from(cache[1]));
    cache[1] = edge_b as u8;
    if separation_b > total_radius {
        return separation_b - total_radius;
    }
    let (first, second, xf_first, xf_second, edge) =
        if separation_b > separation_a + 0.1 * linear_slop {
            manifold.kind = ManifoldType::FaceB;
            (b, a, xf_b, xf_a, edge_b)
        } else {
            manifold.kind = ManifoldType::FaceA;
            (a, b, xf_a, xf_b, edge_a)
        };
    let incident_edge = find_incident_edge(first, xf_first, edge, second, xf_second);
    let local_first = first.base.vertex(edge);
    let local_second = first.base.vertex((edge + 1) % first.base.count());
    let local_tangent = (local_second - local_first).normalized();
    let local_normal = local_tangent.cross_scalar(1.0);
    let plane_point = Vector::combine2(0.5, local_first, 0.5, local_second);
    let tangent = xf_first.q.rotate(local_tangent);
    let normal = tangent.cross_scalar(1.0);
    let first_point = xf_first.transform(local_first);
    let second_point = xf_first.transform(local_second);
    let front_offset = normal.dot(first_point);
    let side_offset1 = -tangent.dot(first_point) + total_radius;
    let side_offset2 = tangent.dot(second_point) + total_radius;
    let mut clip_points1 = [Vector::ZERO; 2];
    if clip_segment_to_line(&mut clip_points1, incident_edge, -tangent, side_offset1) < 2 {
        return 0.0;
    }
    let mut clip_points2 = [Vector::ZERO; 2];
    if clip_segment_to_line(&mut clip_points2, clip_points1, tangent, side_offset2) < 2 {
        return 0.0;
    }
    manifold.local_normal = local_normal;
    manifold.local_point = plane_point;
    for point in clip_points2 {
        if normal.dot(point) - front_offset <= total_radius {
            manifold.points[manifold.point_count] = xf_second.inverse_transform(point);
            manifold.point_count += 1;
        }
    }
    0.0
}
