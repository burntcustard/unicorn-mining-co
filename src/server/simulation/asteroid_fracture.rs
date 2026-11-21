//! Mechanical fracture effects. The world applies removals and allocates IDs.

use crate::specs::{Catalog, Point};
use crate::utilities::seeded_random::SeededRandom;
use crate::utilities::vector::Vector;

use super::asteroid_geometry::{
    AsteroidSegment, center_of, item_fits, round_point, shape_outlines_from_marked, split_triangle,
};
use super::geometry::rotate_point;
use super::polygon::{ShapeOutline, outer_edges, radius_of};

#[derive(Clone, Copy, Debug, Default)]
pub struct AsteroidMotion {
    pub position: Vector,
    pub velocity: Vector,
    pub rotation: f64,
    pub spin: f64,
}

impl AsteroidMotion {
    fn at_local_point(self, center: Vector) -> Self {
        let offset = rotate_point(center, self.rotation);
        Self {
            position: self.position + offset,
            velocity: self
                .velocity
                .add_scaled(Vector::new(-offset.y, offset.x), self.spin),
            ..self
        }
    }
}

pub struct FractureInput<'a> {
    pub id: i64,
    pub motion: AsteroidMotion,
    pub mass: f64,
    pub health: f64,
    pub decay: f64,
    pub dead: bool,
    pub resource: Option<i32>,
    pub outline: &'a ShapeOutline,
    pub contents: &'a [i32],
    pub segments: Option<&'a mut [AsteroidSegment]>,
    pub damaged_segment: Option<usize>,
}

#[derive(Debug)]
pub struct AsteroidFragment {
    pub motion: AsteroidMotion,
    pub radius: f64,
    pub mass: f64,
    pub health: f64,
    pub decay: f64,
    pub outline: ShapeOutline,
    pub contents: Vec<i32>,
    pub resource: Option<i32>,
    pub segments: Option<Vec<AsteroidSegment>>,
}

#[derive(Debug)]
pub struct MinedItem {
    pub motion: AsteroidMotion,
    pub resource: i32,
}

#[derive(Debug)]
pub enum FractureEffect {
    Split(Vec<AsteroidFragment>),
    Destroyed {
        drops: Vec<MinedItem>,
        debris: Vec<AsteroidFragment>,
    },
}

pub fn fracture(mut input: FractureInput<'_>, catalog: &Catalog) -> Option<FractureEffect> {
    if input.dead {
        return None;
    }

    if input.health < 1.0 {
        return Some(destroyed(input, catalog));
    }

    let segments = input.segments.take()?;
    let damaged_segment = input.damaged_segment?;
    if segments.get(damaged_segment)?.health < 1.0 {
        return Some(FractureEffect::Split(detach(
            &input,
            damaged_segment,
            segments,
        )));
    }

    None
}

fn recentered(outline: &ShapeOutline, center: Vector) -> ShapeOutline {
    ShapeOutline {
        points: outline
            .points
            .iter()
            .map(|&[x, y]| round_point([x - center.x, y - center.y]))
            .collect(),
        edges: None,
    }
}

fn detach(
    input: &FractureInput<'_>,
    damaged: usize,
    segments: &mut [AsteroidSegment],
) -> Vec<AsteroidFragment> {
    let mut groups = vec![vec![damaged]];
    {
        let mut remaining = Vec::new();
        for (index, segment) in segments.iter_mut().enumerate() {
            if index == damaged {
                continue;
            }
            if segment.health < 1.0 {
                groups.push(vec![index]);
            } else {
                remaining.push((index, &mut segment.outline));
            }
        }

        let mut outlines: Vec<_> = remaining
            .iter_mut()
            .map(|(_, outline)| &mut **outline)
            .collect();
        groups.extend(
            outer_edges(&mut outlines)
                .into_iter()
                .map(|group| group.into_iter().map(|index| remaining[index].0).collect()),
        );
    }

    let mut children = Vec::with_capacity(groups.len());
    for group in &groups {
        let initial = &segments[group[0]].outline;
        let outlines;
        let outline = if group.len() == 1 {
            initial
        } else {
            outlines = shape_outlines_from_marked(group.iter().map(|&index| &segments[index]));
            let mut largest = &outlines[0];
            for candidate in &outlines[1..] {
                if radius_of(&candidate.points, [0.0, 0.0]) > radius_of(&largest.points, [0.0, 0.0])
                {
                    largest = candidate;
                }
            }
            largest
        };

        let center = center_of(outline);
        let outline = recentered(outline, center);
        let mut contents = Vec::new();
        let mut mass = 0.0;
        let mut child_segments = (group.len() > 1).then(|| Vec::with_capacity(group.len()));
        for &index in group {
            let segment = &segments[index];
            contents.extend_from_slice(&segment.contents);
            mass += segment.mass;
            if let Some(children) = &mut child_segments {
                children.push(AsteroidSegment {
                    contents: segment.contents.clone(),
                    health: segment.health,
                    mass: segment.mass,
                    max_health: segment.max_health,
                    outline: recentered(&segment.outline, center),
                });
            }
        }

        let radius = radius_of(&outline.points, [0.0, 0.0]);
        children.push(AsteroidFragment {
            motion: input.motion.at_local_point(center),
            radius,
            mass,
            health: radius,
            decay: 0.0,
            outline,
            contents,
            resource: input.resource,
            segments: child_segments,
        });
    }

    let inverse_mass: f64 = children.iter().map(|child| 1.0 / child.mass).sum();
    let force = 3.0 / inverse_mass;
    let spin = (SeededRandom::new(input.id as f64).next_float() - 0.5) * force / 3.0;
    for (index, child) in children.iter_mut().enumerate() {
        let outward = (child.motion.position - input.motion.position).normalized();
        child.motion.velocity = child
            .motion
            .velocity
            .add_scaled(outward, force / child.mass);
        if groups[index].len() == 1 {
            child.motion.spin += spin / child.mass;
        }
    }

    children
}

fn destroyed(input: FractureInput<'_>, catalog: &Catalog) -> FractureEffect {
    let triangles = match (
        input.decay,
        &input.segments,
        input.outline.points.as_slice(),
    ) {
        (0.0, None, [a, b, c]) => Some(split_triangle([*a, *b, *c])),
        _ => None,
    };

    let keep_contents =
        triangles.is_some_and(|triangles| {
            let center_outline = ShapeOutline {
                points: triangles[2].to_vec(),
                edges: None,
            };
            let center_outline = recentered(&center_outline, center_of(&center_outline));
            input.contents.iter().enumerate().all(|(index, &resource)| {
                item_fits(&center_outline, resource as usize, index, catalog)
            })
        });

    let mut drops = Vec::new();
    let mut random = SeededRandom::new(input.id as f64);
    let mut release = |outline: &ShapeOutline, contents: &[i32]| {
        let mut motion = input.motion.at_local_point(center_of(outline));
        let points = &outline.points;
        let rotation = (points[1][1] - points[0][1]).atan2(points[1][0] - points[0][0]);
        for (index, &resource) in contents.iter().enumerate() {
            motion.rotation = input.motion.rotation + rotation + index as f64;
            motion.spin = input.motion.spin + (random.next_float() - 0.5) * 0.5;
            drops.push(MinedItem { motion, resource });
        }
    };

    if !keep_contents {
        if let Some(segments) = input.segments {
            for segment in segments {
                release(&segment.outline, &segment.contents);
            }
        } else {
            release(input.outline, input.contents);
        }
    }

    let mut debris = Vec::new();
    if let Some(triangles) = triangles {
        let mut random = SeededRandom::new(input.id.wrapping_add(1) as f64);
        let rules = catalog.simulation.asteroid_debris;
        for (index, triangle) in triangles.into_iter().enumerate() {
            if index == 2 && !input.contents.is_empty() && !keep_contents {
                continue;
            }

            let outline = ShapeOutline {
                points: triangle.to_vec(),
                edges: None,
            };
            let center = center_of(&outline);
            let outline = recentered(&outline, center);
            let mut motion = input.motion.at_local_point(center);
            let outward = rotate_point(center, input.motion.rotation).normalized();
            motion.velocity = motion.velocity.add_scaled(outward, rules.separation_speed);
            let lifetime = rules.min_lifetime
                + random.next_float() * (rules.max_lifetime - rules.min_lifetime);
            debris.push(AsteroidFragment {
                motion,
                radius: radius_of(&outline.points, [0.0, 0.0]),
                mass: input.mass / 8.0,
                health: rules.decay * lifetime,
                decay: rules.decay,
                outline,
                contents: if index == 2 && keep_contents {
                    input.contents.to_vec()
                } else {
                    Vec::new()
                },
                resource: input.resource,
                segments: None,
            });
        }
    }

    FractureEffect::Destroyed { drops, debris }
}

/// The single-body collider sits slightly inside the drawing outline.
pub fn fragment_collision_outline(outline: &ShapeOutline) -> Vec<Point> {
    let center = center_of(outline);
    outline
        .points
        .iter()
        .map(|&[x, y]| {
            let offset = Vector::new(x, y) - center;
            let length = offset.length();
            let length = if length == 0.0 { 1.0 } else { length };
            let point = center.add_scaled(offset, (1.0 - 0.1 / length).max(0.5));
            [point.x, point.y]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::simulation::asteroid_geometry::{
        AsteroidOutlineOptions, AsteroidSegmentOptions, generate_outline, subdivide_outline,
    };

    fn assert_record(actual: &Value, expected: &Value, path: &str) {
        match actual {
            Value::Object(fields) => {
                for (name, field) in fields {
                    assert_record(field, &expected[name], &format!("{path}.{name}"));
                }
            }
            Value::Array(values) => {
                let expected = expected.as_array().expect("expected a fixture array");
                assert_eq!(values.len(), expected.len(), "{path}");
                for (index, (value, expected)) in values.iter().zip(expected).enumerate() {
                    assert_record(value, expected, &format!("{path}[{index}]"));
                }
            }
            Value::Number(number) if number.is_f64() => {
                let actual = number.as_f64().expect("expected a numeric observation");
                let expected = expected.as_f64().expect("expected a numeric fixture");
                assert!(
                    (actual - expected).abs() <= 2e-8,
                    "{path}: {actual} != {expected}"
                );
            }
            _ => assert_eq!(actual, expected, "{path}"),
        }
    }

    fn fragment_record(id: i64, fragment: &AsteroidFragment) -> Value {
        let segments: Vec<_> = fragment
            .segments
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|segment| {
                json!({
                    "contents": segment.contents,
                    "mass": segment.mass,
                    "health": segment.health,
                    "maxHealth": segment.max_health,
                    "shapeOutline": segment.outline.points,
                })
            })
            .collect();

        json!({
            "id": id,
            "position": fragment.motion.position,
            "velocity": fragment.motion.velocity,
            "rotation": fragment.motion.rotation,
            "spin": fragment.motion.spin,
            "radius": fragment.radius,
            "mass": fragment.mass,
            "health": fragment.health,
            "maxHealth": fragment.health,
            "decay": fragment.decay,
            "contents": fragment.contents,
            "outline": fragment.outline.points,
            "segments": segments,
        })
    }

    fn apply(
        body: &mut AsteroidFragment,
        id: i64,
        damaged_segment: Option<usize>,
        catalog: &Catalog,
    ) -> Option<FractureEffect> {
        fracture(
            FractureInput {
                id,
                motion: body.motion,
                mass: body.mass,
                health: body.health,
                decay: body.decay,
                dead: false,
                resource: body.resource,
                outline: &body.outline,
                contents: &body.contents,
                segments: body.segments.as_deref_mut(),
                damaged_segment,
            },
            catalog,
        )
    }

    #[test]
    fn split_and_destroy_match_recorded_asteroid_fragments()
    -> Result<(), Box<dyn std::error::Error>> {
        let catalog = Catalog::load()?;
        let samples: Vec<Value> = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/asteroids.json"
        )))?;

        for (sample_index, sample) in samples.iter().enumerate() {
            let props = &sample["properties"];
            let initial = &sample["initial"];
            let id = props["id"].as_i64().expect("fixture has initial ID");
            let radius = props["radius"].as_f64().expect("fixture has radius");
            let radius_even = props["radiusEven"].as_f64();
            let health = radius * 2.0;
            let mass = 0.4 * (radius * radius);
            let contents: Vec<i32> = serde_json::from_value(props["contents"].clone())?;
            let (outline, segments) = if props["shapeOutline"].is_null() {
                let outline = generate_outline(
                    AsteroidOutlineOptions {
                        id,
                        point_count: props["pointCount"].as_u64().unwrap_or(0) as usize,
                        radius,
                        radius_even,
                    },
                    &catalog.region_generation,
                );
                let mut random = SeededRandom::new((id + 1) as f64);
                let segments = subdivide_outline(
                    &outline,
                    AsteroidSegmentOptions {
                        contents: &contents,
                        health,
                        mass,
                        radius_even,
                    },
                    || random.next_float(),
                );
                (outline, Some(segments))
            } else {
                (
                    ShapeOutline {
                        points: serde_json::from_value(props["shapeOutline"]["points"].clone())?,
                        edges: None,
                    },
                    None,
                )
            };

            let asteroid = AsteroidFragment {
                motion: AsteroidMotion {
                    position: serde_json::from_value(props["position"].clone())?,
                    velocity: serde_json::from_value(props["velocity"].clone())?,
                    rotation: props["rotation"].as_f64().expect("fixture has rotation"),
                    spin: props["spin"].as_f64().expect("fixture has spin"),
                },
                radius,
                mass,
                health,
                decay: 0.0,
                outline,
                contents,
                resource: None,
                segments,
            };

            assert_record(
                &fragment_record(id, &asteroid),
                initial,
                &format!("sample {sample_index} initial"),
            );
            let mut world = vec![(id, asteroid)];
            let mut next_id = id + 1;

            for (step_index, step) in step_array(sample, "steps").iter().enumerate() {
                let target = step["id"].as_i64().expect("fixture has target ID");
                let slot = world
                    .iter()
                    .position(|(id, _)| *id == target)
                    .expect("target exists");
                let body = &mut world[slot].1;
                let segment = step["segmentIndex"]
                    .as_u64()
                    .expect("fixture has segment index") as usize;
                body.segments.as_mut().expect("target has segments")[segment].health = 0.0;
                let result = apply(body, target, Some(segment), &catalog);
                assert_eq!(
                    result.is_some(),
                    step["changed"].as_bool().expect("fixture marks change")
                );
                if let Some(FractureEffect::Split(children)) = result {
                    world.remove(slot);
                    let child_ids: Vec<_> = children
                        .into_iter()
                        .map(|fragment| {
                            let id = next_id;
                            next_id += 1;
                            world.push((id, fragment));
                            id
                        })
                        .collect();
                    assert_record(
                        &json!([{"type": "asteroidSplit", "asteroidId": target, "childIds": child_ids}]),
                        &step["events"],
                        &format!("sample {sample_index} step {step_index} events"),
                    );
                }
                let records: Vec<_> = world
                    .iter()
                    .map(|(id, asteroid)| fragment_record(*id, asteroid))
                    .collect();
                assert_record(
                    &Value::Array(records),
                    &step["entities"],
                    &format!("sample {sample_index} step {step_index} entities"),
                );
            }

            let mut item_records = Vec::new();
            let mut debris_records = Vec::new();
            for (id, mut asteroid) in world {
                asteroid.health = 0.0;
                let Some(FractureEffect::Destroyed { drops, debris }) =
                    apply(&mut asteroid, id, None, &catalog)
                else {
                    panic!("an asteroid with depleted health must break apart");
                };
                for item in drops {
                    item_records.push(json!({
                        "id": next_id,
                        "position": item.motion.position,
                        "velocity": item.motion.velocity,
                        "rotation": item.motion.rotation,
                        "spin": item.motion.spin,
                        "resource": item.resource,
                    }));
                    next_id += 1;
                }
                for fragment in debris {
                    debris_records.push(fragment_record(next_id, &fragment));
                    next_id += 1;
                }
            }

            assert_record(
                &Value::Array(item_records),
                &sample["drops"],
                &format!("sample {sample_index} drops"),
            );
            assert_record(
                &Value::Array(debris_records),
                &sample["debris"],
                &format!("sample {sample_index} debris"),
            );
        }

        Ok(())
    }

    fn step_array<'a>(sample: &'a Value, name: &str) -> &'a Vec<Value> {
        sample[name].as_array().expect("expected a fixture array")
    }
}
