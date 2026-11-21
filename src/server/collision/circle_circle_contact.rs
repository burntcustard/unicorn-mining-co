use crate::utilities::{vector::Vector, vector_math::TransformValue};

use super::{CircleShape, Manifold, ManifoldType};

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
