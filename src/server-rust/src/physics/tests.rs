use std::f64::consts::PI;

use serde::Deserialize;

use crate::collision::{ManifoldType, Shape};
use crate::specs::Catalog;
use crate::vector::Vector;

use super::{Body, ContactContext, ContactListener, FixtureOptions, World};

#[derive(Clone, Copy, Debug, Deserialize)]
struct RecordedBody {
    position: Vector,
    rotation: f64,
    velocity: Vector,
    spin: f64,
}

impl From<&Body> for RecordedBody {
    fn from(body: &Body) -> Self {
        Self {
            position: body.position(),
            rotation: body.angle(),
            velocity: body.linear_velocity,
            spin: body.angular_velocity,
        }
    }
}

#[derive(Debug, Deserialize)]
struct RecordedContact {
    a: usize,
    b: usize,
    #[serde(rename = "type")]
    kind: String,
    count: usize,
    normal: Vector,
    points: [Vector; 2],
    separations: [f64; 2],
}

#[derive(Deserialize)]
struct RecordedPose {
    bodies: Vec<RecordedBody>,
    contacts: Vec<[usize; 2]>,
    events: Vec<RecordedContact>,
}

#[derive(Deserialize)]
struct RecordedScenario {
    count: usize,
    poses: Vec<RecordedPose>,
}

#[derive(Default)]
struct RecordEvents(Vec<RecordedContact>);

impl ContactListener<usize> for RecordEvents {
    fn pre_solve(&mut self, context: ContactContext<'_, usize>) {
        let a = context.fixture_a.user_data;
        context.contact.friction = 0.2;
        context.contact.restitution = 0.15;
        context.contact.surface_speed = if a == 2 { 0.3 } else { 0.0 };
        let manifold = context.world_manifold();
        let kind = match context.contact.manifold.kind {
            ManifoldType::Circles => "circles",
            ManifoldType::FaceA => "faceA",
            ManifoldType::FaceB => "faceB",
            ManifoldType::None => "",
        };
        self.0.push(RecordedContact {
            a,
            b: context.fixture_b.user_data,
            kind: kind.into(),
            count: manifold.point_count,
            normal: manifold.normal,
            points: manifold.points,
            separations: manifold.separations,
        });
    }
}

fn close(actual: f64, expected: f64) -> bool {
    (actual - expected).abs() <= 2e-8
}

fn close_vector(actual: Vector, expected: Vector) -> bool {
    close(actual.x, expected.x) && close(actual.y, expected.y)
}

#[test]
fn physics_world_replays_typescript_poses_and_contact_order() {
    let scenarios: Vec<RecordedScenario> = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/physics-world.json"
    ))
    .unwrap();
    let catalog = Catalog::load().unwrap();
    let rules = &catalog.simulation;
    for scenario in scenarios {
        let count = scenario.count;
        let mut world = World::<usize>::new(rules);
        let mut bodies = Vec::with_capacity(count);
        let mut fixtures = Vec::with_capacity(count);
        let mut destroyed = None;
        let make_shape = |index| {
            if index % 3 == 0 {
                Shape::circle(Vector::new(1.0, -1.0), 8.0)
            } else {
                Shape::polygon(
                    &[
                        Vector::new(-8.0, -6.0),
                        Vector::new(8.0, -6.0),
                        Vector::new(8.0, 6.0),
                        Vector::new(-8.0, 6.0),
                    ],
                    None,
                    rules.linear_slop,
                )
            }
        };
        for index in 0..count {
            let id = world.create_body();
            world.set_mass(id, (10 + index) as f64, (300 + index * 30) as f64);
            bodies.push(id);
        }
        for (index, &id) in bodies.iter().enumerate() {
            fixtures.push(
                world
                    .create_fixture(
                        id,
                        make_shape(index),
                        FixtureOptions {
                            user_data: index + 1,
                            physical: index % 7 != 6,
                        },
                    )
                    .unwrap(),
            );
        }
        let mut events = RecordEvents::default();
        for (tick, expected) in scenario.poses.into_iter().enumerate() {
            if tick % 40 == 0 {
                for (index, &id) in bodies.iter().enumerate() {
                    if world.body(id).is_none() {
                        continue;
                    }
                    let angle = index as f64 / count as f64 * PI * 2.0;
                    let radius = if tick % 80 == 0 { 12.0 } else { 60.0 };
                    world.set_transform(
                        id,
                        Vector::new(angle.cos() * radius, angle.sin() * radius),
                        angle * 0.1,
                    );
                    let body = world.body_mut(id).unwrap();
                    body.linear_velocity = Vector::new(-angle.cos() * 180.0, -angle.sin() * 180.0);
                    body.angular_velocity = if index % 2 == 0 { -0.3 } else { 0.2 };
                }
            }
            if tick == 75 {
                assert!(world.destroy_fixture(fixtures[2]));
                fixtures[2] = world
                    .create_fixture(
                        bodies[2],
                        make_shape(2),
                        FixtureOptions {
                            user_data: 103,
                            physical: true,
                        },
                    )
                    .unwrap();
            }
            if tick == 200 {
                let id = bodies[count - 1];
                destroyed = world.body(id).map(RecordedBody::from);
                assert!(world.destroy_body(id));
            }
            events.0.clear();
            world.step_with(rules.simulation_step, 8, 3, &mut events);
            let contacts: Vec<_> = world
                .contacts()
                .map(|contact| {
                    [
                        world.fixture(contact.fixture_a).unwrap().user_data,
                        world.fixture(contact.fixture_b).unwrap().user_data,
                    ]
                })
                .collect();
            assert_eq!(
                contacts, expected.contacts,
                "{count} bodies, tick {tick} contacts"
            );
            assert_eq!(
                events.0.len(),
                expected.events.len(),
                "{count} bodies, tick {tick} event count"
            );
            for (index, (actual, expected)) in events.0.iter().zip(expected.events).enumerate() {
                let label = || {
                    format!(
                        "{count} bodies, tick {tick}, event {index}: {actual:?} expected {expected:?}"
                    )
                };
                assert_eq!(
                    (actual.a, actual.b, &actual.kind, actual.count),
                    (expected.a, expected.b, &expected.kind, expected.count),
                    "{}",
                    label()
                );
                assert!(close_vector(actual.normal, expected.normal), "{}", label());
                for point in 0..2 {
                    assert!(
                        close_vector(actual.points[point], expected.points[point])
                            && close(actual.separations[point], expected.separations[point]),
                        "{}",
                        label()
                    );
                }
            }
            for (index, (&id, expected)) in bodies.iter().zip(expected.bodies).enumerate() {
                let actual = world
                    .body(id)
                    .map(RecordedBody::from)
                    .or(destroyed)
                    .unwrap();
                assert!(
                    close_vector(actual.position, expected.position)
                        && close(actual.rotation, expected.rotation)
                        && close_vector(actual.velocity, expected.velocity)
                        && close(actual.spin, expected.spin),
                    "{count} bodies, tick {tick}, body {index}: {actual:?} expected {expected:?}"
                );
            }
        }
    }
}

#[test]
fn nearest_collision_neighbors_count_bodies_and_reconsider_exclusions() {
    let catalog = Catalog::load().unwrap();
    let mut world = World::<()>::new(&catalog.simulation);
    world.limit_collision_neighbors = true;
    let options = FixtureOptions {
        user_data: (),
        physical: false,
    };
    let center = world.create_body();
    world.create_fixture(center, Shape::circle(Vector::ZERO, 20.0), options);
    let neighbors: [_; 9] = std::array::from_fn(|index| {
        let body = world.create_body();
        world.set_transform(body, Vector::new((index + 1) as f64, 0.0), 0.0);
        if index < 8 {
            for radius in [0.5, 0.6] {
                world.create_fixture(body, Shape::circle(Vector::ZERO, radius), options);
            }
        }
        body
    });
    world.step(0.0, 8, 3);
    assert!(world.body(center).unwrap().neighborhood.is_none());
    world.create_fixture(neighbors[8], Shape::circle(Vector::ZERO, 0.5), options);
    world.step(0.0, 8, 3);
    assert!(!world.body(center).unwrap().allows_collision(neighbors[8]));
    world.set_transform(neighbors[0], Vector::new(100.0, 0.0), 0.0);
    world.step(0.0, 8, 3);
    assert!(world.body(center).unwrap().allows_collision(neighbors[8]));
}

#[test]
fn cached_polygon_separation_never_discards_a_continuous_impact() {
    use super::solver::separated_throughout;
    use crate::collision::{ToiInput, find_time_of_impact};

    let catalog = Catalog::load().unwrap();
    let mut state = 31_u64;
    let mut sample = || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        ((state >> 32) as f64) * (1.0 / 4294967296.0)
    };
    let polygon = Shape::polygon(
        &[
            Vector::new(-10.0, -7.0),
            Vector::new(13.0, -5.0),
            Vector::new(2.0, 15.0),
        ],
        None,
        0.5,
    );
    let (mut cached, mut relative) = (0, 0);
    for trial in 0..10000 {
        let mut world = World::<()>::new(&catalog.simulation);
        let a = world.create_body();
        let b = world.create_body();
        let fa = world
            .create_fixture(a, polygon.clone(), FixtureOptions::default())
            .unwrap();
        let fb = world
            .create_fixture(b, polygon.clone(), FixtureOptions::default())
            .unwrap();
        world.set_proxy_radius(a, 30.0);
        world.set_proxy_radius(b, 30.0);
        let origin = f64::from(trial % 3) * 1e7;
        world.set_transform(a, Vector::new(origin, origin), sample() * 6.0);
        world.set_transform(
            b,
            Vector::new(
                origin + sample() * 160.0 - 80.0,
                origin + sample() * 160.0 - 80.0,
            ),
            sample() * 6.0,
        );
        world.create_contact(fa, fb, &mut ());
        let id = world.contact_order[0].unwrap();
        world.update_contact(id, &mut ());
        for body in [a, b] {
            let body = world.body_mut(body).unwrap();
            body.sweep.c += Vector::new(sample() * 30.0 - 15.0, sample() * 30.0 - 15.0);
            body.sweep.a += sample() - 0.5;
            body.synchronize_transform();
        }
        let c = &world.contacts[&id];
        let pair = world.pairs.get_mut(&c.pair).unwrap();
        let (body_a, body_b) = (&world.bodies[&pair.a], &world.bodies[&pair.b]);
        let radius = polygon.base().radius * 2.0;
        let reject_cached = c.separation_until > 0.0
            && c.separation_until + radius
                > pair.motion(body_a, body_b)
                    + pair.sweep_motion(body_a, body_b, 1)
                    + 0.5_f64.max(radius - 1.5)
                    + 1.25 * 0.5;
        let (mut sweep_a, mut sweep_b) = (body_a.sweep, body_b.sweep);
        let reject_relative = separated_throughout(
            polygon.base(),
            &mut sweep_a,
            polygon.base(),
            &mut sweep_b,
            0.5,
        );
        cached += usize::from(reject_cached);
        relative += usize::from(reject_relative);
        if reject_cached || reject_relative {
            let result = find_time_of_impact(
                ToiInput {
                    proxy_a: polygon.base(),
                    proxy_b: polygon.base(),
                    sweep_a: &mut sweep_a,
                    sweep_b: &mut sweep_b,
                    t_max: 1.0,
                },
                0.5,
            );
            assert!(
                !result.touching,
                "trial {trial}: rejected a continuous impact"
            );
        }
    }
    assert!(cached >= 100 && relative >= 100);
}
