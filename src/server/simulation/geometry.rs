use crate::specs::Point;
use crate::utilities::vector::Vector;

use super::polygon::radius_of;

pub fn rotate_point(point: Vector, angle: f64) -> Vector {
    let (sin, cos) = angle.sin_cos();
    Vector::new(point.x * cos - point.y * sin, point.x * sin + point.y * cos)
}

pub fn direction_of(angle: f64) -> Vector {
    let (sin, cos) = angle.sin_cos();
    Vector::new(cos, sin)
}

pub fn move_point(point: Vector, angle: f64, distance: f64) -> Vector {
    point.add_scaled(direction_of(angle), distance)
}

pub fn shape_outline_extent(points: &[Point]) -> (Point, f64) {
    let mut middle = [0.0, 0.0];
    for point in points {
        middle[0] += point[0];
        middle[1] += point[1];
    }

    middle[0] /= points.len() as f64;
    middle[1] /= points.len() as f64;
    (middle, radius_of(points, middle))
}

pub(super) fn point_distance([x1, y1]: Point, [x2, y2]: Point) -> f64 {
    Vector::new(x1, y1).distance(Vector::new(x2, y2))
}
