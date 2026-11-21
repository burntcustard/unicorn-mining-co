use crate::specs::Point;

use super::geometry::point_distance;

const TURN_TOLERANCE: f64 = 1e-9;

fn turn(a: Point, b: Point, c: Point) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

fn quantized_triangle(points: [Point; 3]) -> Vec<Point> {
    // Keep the same precision as the replicated geometry.
    points
        .map(|point| point.map(|value| f64::from(value as f32)))
        .to_vec()
}

/// Triangulate a concave outline while keeping the original drawing geometry.
pub fn convex_parts(points: &[Point]) -> Option<Vec<Vec<Point>>> {
    let mut positive = false;
    let mut negative = false;
    for (index, &a) in points.iter().enumerate() {
        let cross = turn(
            a,
            points[(index + 1) % points.len()],
            points[(index + 2) % points.len()],
        );
        positive |= cross > TURN_TOLERANCE;
        negative |= cross < -TURN_TOLERANCE;
    }

    if !positive || !negative {
        return None;
    }

    let mut indices: Vec<_> = (0..points.len()).collect();
    if point_distance(points[0], points[points.len() - 1]) < 1e-7 {
        indices.pop();
    }

    let mut area = 0.0;
    for (index, &current) in indices.iter().enumerate() {
        let next = points[indices[(index + 1) % indices.len()]];
        area += points[current][0] * next[1] - points[current][1] * next[0];
    }
    if area < 0.0 {
        indices.reverse();
    }

    let mut parts = Vec::with_capacity(indices.len().saturating_sub(2));
    while indices.len() > 3 {
        let (index, triangle) = indices.iter().enumerate().find_map(|(index, &middle)| {
            let a = points[indices[(index + indices.len() - 1) % indices.len()]];
            let b = points[middle];
            let c = points[indices[(index + 1) % indices.len()]];
            if turn(a, b, c) <= TURN_TOLERANCE {
                return None;
            }

            let encloses_point = indices.iter().any(|&point_index| {
                let point = points[point_index];
                let coincident = [a, b, c]
                    .iter()
                    .any(|&corner| point_distance(point, corner) < 1e-8);

                !coincident
                    && turn(a, b, point) >= -TURN_TOLERANCE
                    && turn(b, c, point) >= -TURN_TOLERANCE
                    && turn(c, a, point) >= -TURN_TOLERANCE
            });
            (!encloses_point).then_some((index, [a, b, c]))
        })?;

        parts.push(quantized_triangle(triangle));
        indices.remove(index);
    }

    if let [a, b, c] = indices[..] {
        parts.push(quantized_triangle([points[a], points[b], points[c]]));
    }

    Some(parts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clips_concave_polygons_in_the_same_order_for_either_winding() {
        let outline = [[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [2.0, 2.0], [0.0, 4.0]];
        let expected = Some(vec![
            vec![outline[1], outline[2], outline[3]],
            vec![outline[0], outline[1], outline[3]],
            vec![outline[0], outline[3], outline[4]],
        ]);

        assert_eq!(convex_parts(&outline), expected);
        let mut clockwise = outline;
        clockwise.reverse();
        assert_eq!(convex_parts(&clockwise), expected);
        assert_eq!(convex_parts(&outline[..3]), None);
    }
}
