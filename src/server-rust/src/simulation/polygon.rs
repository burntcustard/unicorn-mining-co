use std::collections::HashMap;
use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

use crate::specs::Point;

use super::geometry::point_distance;

/// Outline coordinates and visibility of edges after a fracture.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct ShapeOutline {
    pub points: Vec<Point>,
    pub edges: Option<Vec<bool>>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct PolygonOptions {
    pub point_count: usize,
    pub radius: f64,
    pub radius_even: Option<f64>,
    pub variance: f64,
}

pub fn create_polygon(options: PolygonOptions, mut random: impl FnMut() -> f64) -> ShapeOutline {
    let even = options.radius_even.unwrap_or(options.radius);
    let points = (0..options.point_count)
        .map(|index| {
            let angle = index as f64 / options.point_count as f64 * PI * 2.0;
            let wander = 1.0 - random() * options.variance;
            let radius = if index % 2 == 0 { even } else { options.radius };
            let reach = radius * wander;
            let (sin, cos) = angle.sin_cos();
            [cos * reach, sin * reach]
        })
        .collect();
    ShapeOutline {
        points,
        edges: None,
    }
}

pub fn radius_of(points: &[Point], center: Point) -> f64 {
    let mut radius = f64::NEG_INFINITY;
    for &point in points {
        let distance = point_distance(point, center);
        if distance.is_nan() {
            return distance;
        }
        radius = radius.max(distance);
    }
    radius
}

fn vertex_id(point: Point, vertices: &mut HashMap<[u64; 2], usize>, next_id: &mut usize) -> usize {
    let mut new_id = || {
        let id = *next_id;
        *next_id += 1;
        id
    };

    if point.into_iter().any(f64::is_nan) {
        // A point with a NaN coordinate never compares equal in the Go map.
        return new_id();
    }

    let key = point.map(|coordinate| {
        if coordinate == 0.0 {
            0
        } else {
            coordinate.to_bits()
        }
    });
    *vertices.entry(key).or_insert_with(new_id)
}

type Side = (usize, usize);

/// Marks outside edges and returns shared-edge groups in fracture order.
pub fn outer_edges(outlines: &mut [&mut ShapeOutline]) -> Vec<Vec<usize>> {
    let mut vertices = HashMap::new();
    let mut next_id = 0;
    let mut outlines_by_side: HashMap<Side, Vec<usize>> = HashMap::new();
    let mut sides = Vec::with_capacity(outlines.len());

    for (index, outline) in outlines.iter().enumerate() {
        let points = &outline.points;
        let sides_of_outline = (0..points.len())
            .map(|index_of_point| {
                let a = vertex_id(points[index_of_point], &mut vertices, &mut next_id);
                let b = vertex_id(
                    points[(index_of_point + 1) % points.len()],
                    &mut vertices,
                    &mut next_id,
                );
                let side = (a.min(b), a.max(b));
                outlines_by_side.entry(side).or_default().push(index);
                side
            })
            .collect::<Vec<_>>();

        sides.push(sides_of_outline);
    }

    let mut neighbors = Vec::with_capacity(outlines.len());
    for (index, (outline, sides)) in outlines.iter_mut().zip(sides).enumerate() {
        let edges = outline.edges.get_or_insert_with(Vec::new);
        edges.clear();
        edges.reserve(sides.len());
        let mut adjacent = Vec::new();
        for side in sides {
            let sharing = &outlines_by_side[&side];
            edges.push(sharing.len() == 1);
            adjacent.extend(sharing.iter().copied().filter(|&other| other != index));
        }
        adjacent.sort_unstable_by(|left, right| right.cmp(left));
        adjacent.dedup();
        neighbors.push(adjacent);
    }

    // Descending neighbors preserve fragment IDs and cargo placement while
    // visiting only outlines that actually share an edge.
    let mut unvisited = vec![true; outlines.len()];
    let mut groups = Vec::new();
    for seed in (0..outlines.len()).rev() {
        if !unvisited[seed] {
            continue;
        }
        unvisited[seed] = false;
        let mut group = vec![seed];
        let mut index = 0;
        while index < group.len() {
            for &other in &neighbors[group[index]] {
                if unvisited[other] {
                    unvisited[other] = false;
                    group.push(other);
                }
            }
            index += 1;
        }
        groups.push(group);
    }

    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_edges_use_exact_coordinates_and_preserve_group_order() {
        let points = [
            [[-0.0, 0.0], [2.0, 0.0], [0.0, 2.0]],
            [[2.0, 0.0], [0.0, -0.0], [1.0, -1.0]],
            [[0.0, 2.0], [0.0, 0.0], [-1.0, 1.0]],
            [[2.0, 0.0], [0.0, 2.0], [2.0, 2.0]],
            [[4.0, 0.0], [6.0, 0.0], [6.0, 2.0]],
        ];
        let mut outlines = points.map(|points| ShapeOutline {
            points: points.to_vec(),
            edges: None,
        });
        let mut references: Vec<_> = outlines.iter_mut().collect();

        assert_eq!(outer_edges(&mut references), [vec![4], vec![3, 0, 2, 1]]);
        assert_eq!(
            outlines[0].edges.as_deref(),
            Some([false, false, false].as_slice())
        );
        assert_eq!(
            outlines[1].edges.as_deref(),
            Some([false, true, true].as_slice())
        );
        assert_eq!(
            outlines[4].edges.as_deref(),
            Some([true, true, true].as_slice())
        );
    }
}
