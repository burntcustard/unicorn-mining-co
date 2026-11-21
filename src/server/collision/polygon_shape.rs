use super::BaseShape;
use crate::utilities::vector::Vector;

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
