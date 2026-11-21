use crate::utilities::{vector::Vector, vector_math::TransformValue};

use super::{Manifold, ManifoldType, PolygonShape, clip_segment_to_line};

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
