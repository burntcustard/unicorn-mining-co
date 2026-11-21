use crate::utilities::{vector::Vector, vector_math::TransformValue};

use super::{CircleShape, Manifold, ManifoldType, PolygonShape};

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
