//! Asteroid outlines, subdivisions, and closest contacts.

use std::collections::HashMap;
use std::f64::consts::TAU;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::specs::{Catalog, Point, RegionGeneration};
use crate::utilities::seeded_random::SeededRandom;
use crate::utilities::vector::Vector;
use crate::utilities::{round, round_ties_up};

use super::geometry::rotate_point;
use super::polygon::{PolygonOptions, ShapeOutline, create_polygon, outer_edges};

#[derive(Clone, Copy, Debug)]
pub struct AsteroidOutlineOptions {
    pub id: i64,
    pub point_count: usize,
    pub radius: f64,
    pub radius_even: Option<f64>,
}

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
struct OutlineKey {
    id: i64,
    point_count: usize,
    radius: u64,
    radius_even: Option<u64>,
}

#[derive(Default)]
pub struct AsteroidOutlines {
    outlines: HashMap<OutlineKey, Arc<ShapeOutline>>,
}

impl AsteroidOutlines {
    pub fn get(
        &mut self,
        options: AsteroidOutlineOptions,
        rules: &RegionGeneration,
    ) -> Arc<ShapeOutline> {
        let coordinate_key = |radius: f64| if radius == 0.0 { 0 } else { radius.to_bits() };
        let key = OutlineKey {
            id: options.id,
            point_count: options.point_count,
            radius: coordinate_key(options.radius),
            radius_even: options.radius_even.map(coordinate_key),
        };
        let is_cacheable =
            !options.radius.is_nan() && !options.radius_even.is_some_and(f64::is_nan);
        if is_cacheable && let Some(outline) = self.outlines.get(&key) {
            return Arc::clone(outline);
        }

        let outline = Arc::new(generate_outline(options, rules));
        if is_cacheable {
            if self.outlines.len() > 5000 {
                self.outlines.clear();
            }
            self.outlines.insert(key, Arc::clone(&outline));
        }

        outline
    }
}

pub fn point_count_for(radius: f64, scale: f64) -> usize {
    (round_ties_up(radius.sqrt() * scale) as usize)
        .saturating_mul(2)
        .saturating_sub(1)
}

pub fn round_point([x, y]: Point) -> Point {
    [round(x), round(y)]
}

fn without_collinear_points(points: &[Point]) -> Vec<Point> {
    let mut boundary = Vec::with_capacity(points.len());
    for (index, &point) in points.iter().enumerate() {
        let before = points[(index + points.len() - 1) % points.len()];
        let next = points[(index + 1) % points.len()];
        if (point[0] - before[0]) * (next[1] - point[1])
            != (point[1] - before[1]) * (next[0] - point[0])
        {
            boundary.push(point);
        }
    }
    boundary
}

pub fn generate_outline(options: AsteroidOutlineOptions, rules: &RegionGeneration) -> ShapeOutline {
    let mut random = SeededRandom::new(options.id as f64);
    let point_count = if options.point_count == 0 {
        point_count_for(options.radius, rules.asteroid_point_count_scale)
    } else {
        options.point_count
    };
    let mut outline = create_polygon(
        PolygonOptions {
            point_count,
            radius: options.radius,
            radius_even: options.radius_even,
            variance: rules.asteroid_variance,
        },
        || random.next_float(),
    );
    for point in &mut outline.points {
        *point = round_point(*point);
    }
    outline.points = without_collinear_points(&outline.points);
    outline
}

pub fn split_triangle([center, from, to]: [Point; 3]) -> [[Point; 3]; 4] {
    let midpoint = |a: Point, b: Point| [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
    let left = midpoint(center, from);
    let outer = midpoint(from, to);
    let right = midpoint(to, center);
    [
        [center, left, right],
        [left, from, outer],
        [left, outer, right],
        [outer, to, right],
    ]
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct AsteroidSegment {
    pub contents: Vec<i32>,
    pub health: f64,
    pub mass: f64,
    pub max_health: f64,
    pub outline: ShapeOutline,
}

#[derive(Clone, Copy, Debug)]
pub struct AsteroidSegmentOptions<'a> {
    pub contents: &'a [i32],
    pub health: f64,
    pub mass: f64,
    pub radius_even: Option<f64>,
}

pub fn subdivide_outline(
    outline: &ShapeOutline,
    options: AsteroidSegmentOptions<'_>,
    mut random: impl FnMut() -> f64,
) -> Vec<AsteroidSegment> {
    let points = &outline.points;
    let mut segments = Vec::new();
    let mut append_segment = |points: &[Point], count: usize| {
        let health = options.health * 2.0 / count as f64;
        let mass = options.mass / count as f64;
        segments.push(AsteroidSegment {
            contents: Vec::new(),
            health,
            mass,
            max_health: health,
            outline: ShapeOutline {
                points: points.iter().copied().map(round_point).collect(),
                edges: None,
            },
        });
    };

    if options.radius_even.is_some_and(|radius| radius != 0.0) {
        let inset: Vec<_> = points.iter().step_by(2).copied().collect();
        let count = 1 + inset.len();
        append_segment(&inset, count);
        for (index, &point) in inset.iter().enumerate() {
            append_segment(
                &[
                    point,
                    points[index * 2 + 1],
                    inset[(index + 1) % inset.len()],
                ],
                count,
            );
        }
    } else {
        let faces: Vec<_> = match points.as_slice() {
            &[a, b, c] => vec![split_triangle([a, b, c])],
            _ => points
                .iter()
                .enumerate()
                .map(|(index, &point)| {
                    split_triangle([[0.0, 0.0], point, points[(index + 1) % points.len()]])
                })
                .collect(),
        };
        let count = faces.len() * 4;
        for corner in 0..4 {
            for face in &faces {
                append_segment(&face[corner], count);
            }
        }
    }

    let mut empty: Vec<_> = (0..segments.len()).collect();
    for &resource in options.contents {
        let value = random();
        let slot = (value * value * empty.len() as f64).floor() as usize;
        let target = if empty.is_empty() {
            0
        } else {
            empty.remove(slot)
        };
        segments[target].contents.push(resource);
    }

    segments
}

pub fn mark_segment_edges(segments: &mut [AsteroidSegment]) -> Vec<Vec<usize>> {
    let mut outlines: Vec<_> = segments
        .iter_mut()
        .map(|segment| &mut segment.outline)
        .collect();
    outer_edges(&mut outlines)
}

pub fn shape_outlines_from_marked<'a>(
    segments: impl IntoIterator<Item = &'a AsteroidSegment>,
) -> Vec<ShapeOutline> {
    let mut outer = Vec::new();
    for segment in segments {
        let outline = &segment.outline;
        let edges = outline.edges.as_deref().unwrap_or_default();
        for (index, &from) in outline.points.iter().enumerate() {
            if edges.get(index) == Some(&true) {
                let to = outline.points[(index + 1) % outline.points.len()];
                outer.push((from, to));
            }
        }
    }

    let mut outlines = Vec::new();
    while !outer.is_empty() {
        let mut current = outer.remove(0);
        let first = current.0;
        let mut points = vec![first];
        while current.1 != first {
            let at = current.1;
            let reverse = (current.0[1] - at[1]).atan2(current.0[0] - at[0]);
            let mut smallest_turn = f64::INFINITY;
            let mut next = None;
            for (index, &(from, to)) in outer.iter().enumerate() {
                if from != at {
                    continue;
                }

                let direction = (to[1] - at[1]).atan2(to[0] - at[0]);
                let clockwise = (reverse - direction + TAU) % TAU;
                if clockwise < smallest_turn {
                    smallest_turn = clockwise;
                    next = Some(index);
                }
            }

            let Some(index) = next else { break };
            points.push(at);
            current = outer.remove(index);
        }

        outlines.push(ShapeOutline {
            points: without_collinear_points(&points),
            edges: None,
        });
    }

    outlines
}

pub fn center_of(outline: &ShapeOutline) -> Vector {
    let (mut area, mut x, mut y) = (0.0, 0.0, 0.0);
    for (index, &point) in outline.points.iter().enumerate() {
        let next = outline.points[(index + 1) % outline.points.len()];
        let cross = point[0] * next[1] - next[0] * point[1];
        area += cross;
        x += (point[0] + next[0]) * cross;
        y += (point[1] + next[1]) * cross;
    }
    Vector::new(x / (area * 3.0), y / (area * 3.0))
}

pub fn item_fits(outline: &ShapeOutline, resource: usize, index: usize, catalog: &Catalog) -> bool {
    let item = &catalog.item_specs[&catalog.item_ids[resource]];
    let center = center_of(outline);
    let points = &outline.points;
    let rotation = (points[1][1] - points[0][1]).atan2(points[1][0] - points[0][0]) + index as f64;
    let item_points: Vec<_> = item
        .points
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(|&[x, y]| center + rotate_point(Vector::new(x, y), rotation))
        .collect();
    let radius = if item.radius == 0.0 {
        catalog.item_defaults["radius"]
    } else {
        item.radius
    };

    for (index, &[x, y]) in points.iter().enumerate() {
        let [next_x, next_y] = points[(index + 1) % points.len()];
        let start = Vector::new(x, y);
        let edge = Vector::new(next_x - x, next_y - y);
        let center_side = edge.cross(center - start);
        if center_side == 0.0 {
            return false;
        }

        let side = 1.0_f64.copysign(center_side);
        let edge_length = edge.distance(Vector::ZERO);
        let clearance = catalog.simulation.asteroid_debris.item_clearance * edge_length;
        let distance = |point: Vector| side * edge.cross(point - start);

        if item_points.is_empty() {
            if distance(center) < radius * edge_length + clearance {
                return false;
            }
        } else if item_points.iter().any(|&point| distance(point) < clearance) {
            return false;
        }
    }

    true
}

fn inside_shape_outline(points: &[Point], local: Vector) -> bool {
    let turn = local.y.atan2(local.x) / TAU;
    let index = (((turn % 1.0 + 1.0) % 1.0) * points.len() as f64).floor() as usize;
    let point = points[index];
    let next = points[(index + 1) % points.len()];
    let across = local.x * (next[1] - point[1]) - local.y * (next[0] - point[0]);
    across == 0.0 || (point[0] * next[1] - point[1] * next[0]) / across > 1.0
}

#[derive(Clone, Copy, Debug)]
pub struct AsteroidContact {
    pub normal: Vector,
    pub overlap: f64,
}

pub fn asteroid_contact(
    outline: &ShapeOutline,
    position: Vector,
    rotation: f64,
    probe_position: Vector,
    probe_radius: f64,
) -> Option<AsteroidContact> {
    if outline.points.is_empty() {
        return None;
    }

    let offset = probe_position - position;
    let (sine, cosine) = rotation.sin_cos();
    let local = Vector::new(
        offset.x * cosine + offset.y * sine,
        offset.y * cosine - offset.x * sine,
    );
    let (mut closest, mut nearest) = (local, f64::INFINITY);
    for (index, &[x, y]) in outline.points.iter().enumerate() {
        let [next_x, next_y] = outline.points[(index + 1) % outline.points.len()];
        let edge = Vector::new(next_x - x, next_y - y);
        let start = Vector::new(x, y);
        let edge_squared = edge.dot(edge);
        let denominator = if edge_squared == 0.0 {
            1.0
        } else {
            edge_squared
        };
        let along = ((local - start).dot(edge) / denominator).clamp(0.0, 1.0);
        let point = start.add_scaled(edge, along);
        let distance = point.distance(local);
        if distance < nearest {
            nearest = distance;
            closest = point;
        }
    }

    let inside = inside_shape_outline(&outline.points, local);
    let overlap = if inside {
        probe_radius + nearest
    } else {
        probe_radius - nearest
    };
    if overlap <= 0.0 {
        return None;
    }

    let away = if inside {
        closest - local
    } else {
        local - closest
    };
    let normal = if away.length() == 0.0 {
        Vector::new(1.0, 0.0)
    } else {
        away.normalized()
    };
    let normal = Vector::new(
        normal.x * cosine - normal.y * sine,
        normal.x * sine + normal.y * cosine,
    );

    Some(AsteroidContact { normal, overlap })
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Properties {
        id: i64,
        radius: f64,
        radius_even: Option<f64>,
        #[serde(default)]
        point_count: usize,
        contents: Vec<i32>,
        position: Vector,
        rotation: f64,
        shape_outline: Option<Outline>,
    }

    #[derive(Deserialize)]
    struct Outline {
        points: Vec<Point>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ExpectedSegment {
        contents: Vec<i32>,
        health: f64,
        mass: f64,
        max_health: f64,
        shape_outline: Vec<Point>,
    }

    #[derive(Deserialize)]
    struct InitialState {
        health: f64,
        mass: f64,
        outline: Vec<Point>,
        segments: Vec<ExpectedSegment>,
        boundaries: Vec<Vec<Point>>,
    }

    #[derive(Deserialize)]
    struct Probe {
        position: Vector,
        radius: f64,
        contact: Option<Contact>,
    }

    #[derive(Deserialize)]
    struct Contact {
        normal: Vector,
        overlap: f64,
    }

    #[derive(Deserialize)]
    struct Sample {
        properties: Properties,
        initial: InitialState,
        contacts: Vec<Probe>,
    }

    fn assert_nearly_equal(actual: f64, expected: f64) {
        assert!((actual - expected).abs() <= 2e-8, "{actual} != {expected}");
    }

    fn assert_equal_outline(actual: &[Point], expected: &[Point]) {
        assert_eq!(actual.len(), expected.len());
        for (actual, expected) in actual.iter().zip(expected) {
            assert_nearly_equal(actual[0], expected[0]);
            assert_nearly_equal(actual[1], expected[1]);
        }
    }

    #[test]
    fn outlines_subdivisions_and_contacts_match_typescript_fixtures()
    -> Result<(), Box<dyn std::error::Error>> {
        let catalog = Catalog::load()?;
        let samples: Vec<Sample> = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/asteroids.json"
        )))?;

        for sample in samples {
            let properties = sample.properties;
            let initial = sample.initial;
            let uncut = properties.shape_outline.is_none();
            let outline = match properties.shape_outline {
                Some(outline) => ShapeOutline {
                    points: outline.points,
                    edges: None,
                },
                None => generate_outline(
                    AsteroidOutlineOptions {
                        id: properties.id,
                        point_count: properties.point_count,
                        radius: properties.radius,
                        radius_even: properties.radius_even,
                    },
                    &catalog.region_generation,
                ),
            };

            assert_equal_outline(&outline.points, &initial.outline);

            if uncut {
                let mut random = SeededRandom::new((properties.id + 1) as f64);
                let mut segments = subdivide_outline(
                    &outline,
                    AsteroidSegmentOptions {
                        contents: &properties.contents,
                        health: initial.health,
                        mass: initial.mass,
                        radius_even: properties.radius_even,
                    },
                    || random.next_float(),
                );
                assert_eq!(segments.len(), initial.segments.len());
                for (actual, expected) in segments.iter().zip(initial.segments) {
                    assert_eq!(actual.contents, expected.contents);
                    assert_nearly_equal(actual.health, expected.health);
                    assert_nearly_equal(actual.max_health, expected.max_health);
                    assert_nearly_equal(actual.mass, expected.mass);
                    assert_equal_outline(&actual.outline.points, &expected.shape_outline);
                }

                mark_segment_edges(&mut segments);
                let boundaries = shape_outlines_from_marked(&segments);
                assert_eq!(boundaries.len(), initial.boundaries.len());
                for (actual, expected) in boundaries.iter().zip(initial.boundaries) {
                    assert_equal_outline(&actual.points, &expected);
                }
            }

            for probe in sample.contacts {
                let actual = asteroid_contact(
                    &outline,
                    properties.position,
                    properties.rotation,
                    probe.position,
                    probe.radius,
                );
                assert_eq!(actual.is_some(), probe.contact.is_some());
                if let (Some(actual), Some(expected)) = (actual, probe.contact) {
                    assert_nearly_equal(actual.normal.x, expected.normal.x);
                    assert_nearly_equal(actual.normal.y, expected.normal.y);
                    assert_nearly_equal(actual.overlap, expected.overlap);
                }
            }
        }

        Ok(())
    }
}
