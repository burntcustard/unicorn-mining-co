use std::error::Error;
use std::f64::consts::{FRAC_1_SQRT_2, FRAC_PI_2};
use std::io;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use unicorn_mining_server::collision::query::{ShapeData, contact_between};
use unicorn_mining_server::gameplay::collision_world::{CollisionEntity, ObjectCollider};
use unicorn_mining_server::gameplay::game_collisions::ColliderGeometry;
use unicorn_mining_server::objects::craft_damage::CraftSpawn;
use unicorn_mining_server::objects::portal::{Portal, PortalOptions};
use unicorn_mining_server::objects::ship::Ship;
use unicorn_mining_server::simulation::game_object::ObjectProperties;
use unicorn_mining_server::simulation::geometry::rotate_point;
use unicorn_mining_server::simulation::running_world::RunningWorld;
use unicorn_mining_server::simulation::update_world::SteppedWorld;
use unicorn_mining_server::simulation::world::EntityKind;
use unicorn_mining_server::specs::Catalog;
use unicorn_mining_server::utilities::vector::Vector;

const GATE_ID: i64 = 100;
const SHIP_ID: i64 = 1;
const FACES: [[f64; 4]; 5] = [
    [378.0, 0.0, 1.0, 0.0],
    [319.5, 144.0, FRAC_1_SQRT_2, FRAC_1_SQRT_2],
    [225.0, 202.5, 0.0, 1.0],
    [319.5, -144.0, FRAC_1_SQRT_2, -FRAC_1_SQRT_2],
    [225.0, -202.5, 0.0, -1.0],
];

#[derive(Serialize)]
struct Frame {
    position: Vector,
    velocity: Vector,
    rotation: f64,
    spin: f64,
    health: Vec<f64>,
    contacts: usize,
    opening: f64,
    depth: f64,
}

fn collider_shape(collider: &ColliderGeometry<'_, ObjectCollider>) -> ShapeData {
    ShapeData {
        position: collider.pose.position,
        rotation: collider.pose.rotation,
        radius: collider.radius,
        outline: collider.outline.map(<[_]>::to_vec),
        collision_margin: collider.collision_margin,
    }
}

fn case(values: Vec<f64>, catalog: &Arc<Catalog>) -> Vec<Frame> {
    // Short arrays omit trailing settings, which default to zero.
    let mut state = [0.0; 9];
    for (target, value) in state.iter_mut().zip(values) {
        *target = value;
    }
    let [
        opening,
        opening_target,
        transit_time,
        rotation,
        jaw_y,
        jaw_x,
        tip_depth,
        detached,
        frame_case,
    ] = state;
    let mut running = RunningWorld::new(1.0, Arc::clone(catalog));
    let world = &mut running.world;
    let mut gate = Portal::new(
        PortalOptions {
            id: GATE_ID,
            position: Vector::ZERO,
            destination_sector: "other".into(),
            destination_name: "Other".into(),
            wormhole: false,
        },
        catalog,
    );
    gate.opening = opening;
    gate.opening_target = opening_target;
    gate.object.rotation = rotation;
    gate.request_opening(opening_target);
    let mut ship = Ship::new_player(
        SHIP_ID,
        "",
        ObjectProperties {
            position: Vector::new(-600.0, 50.0),
            velocity: Vector::new(200.0, 0.0),
            ..ObjectProperties::default()
        },
        catalog,
        || world.ids.object(),
    )
    .expect("fixture ship exists");

    let offset = Vector::new(1234.0, -5678.0);
    let object = &mut ship.craft.object;
    if jaw_y != 0.0 {
        gate.object.position = offset;
        object.position = offset + rotate_point(Vector::new(jaw_x, jaw_y), rotation);
        object.velocity = Vector::ZERO;
        object.rotation = rotation + 0.4;
    }
    if tip_depth != 0.0 {
        gate.object.position = offset;
        let side = 1.0_f64.copysign(tip_depth);
        let y = -side * (329.0 - tip_depth.abs());
        object.position = offset + rotate_point(Vector::new(0.0, y), rotation);
        object.velocity = Vector::ZERO;
        object.rotation = rotation + side * FRAC_PI_2;
    }
    if frame_case != 0.0 {
        let index = frame_case.abs() as usize - 1;
        let [mut x, y, mut nx, ny] = FACES[index % FACES.len()];
        if index < FACES.len() {
            x = -x;
            nx = -nx;
        }
        let direction = 1.0_f64.copysign(frame_case);
        let distance = if direction > 0.0 { -91.0 } else { 150.0 };
        gate.object.position = offset;
        let position = Vector::new(x + nx * distance, y + ny * distance);
        object.position = offset + rotate_point(position, rotation);
        let velocity = Vector::new(nx * direction * 200.0, ny * direction * 200.0);
        object.velocity = rotate_point(velocity, rotation);
        object.rotation = rotation + (ny * direction).atan2(nx * direction);
    }

    world.add_entity(EntityKind::Ship(Box::new(ship)), false);
    world.add_entity(EntityKind::Portal(Box::new(gate)), false);
    let body_id = if detached == 0.0 {
        SHIP_ID
    } else {
        let entity = world.remove_entity(SHIP_ID).expect("fixture ship exists");
        let EntityKind::Ship(mut ship) = entity.model else {
            unreachable!("fixture entity is a ship");
        };
        let mount = ship
            .craft
            .mounts
            .iter_mut()
            .find(|mount| {
                mount
                    .module
                    .as_ref()
                    .is_some_and(|module| module.spec.grinds)
            })
            .expect("fixture ship has a grinding module");
        mount.health = 0.0;
        let mut damage = ship.resolve_damage(catalog, &mut world.random, || world.ids.entity());
        let Some(CraftSpawn::Wreckage(mut wreckage)) = damage.spawns.pop() else {
            panic!("detached fixture produces module wreckage");
        };
        assert!(damage.spawns.is_empty());
        wreckage.object.velocity = Vector::ZERO;
        wreckage.object.spin = 0.0;
        let id = wreckage.object.id;
        world.add_entity(EntityKind::Craft(wreckage), false);
        id
    };

    let ticks = if frame_case != 0.0 {
        45
    } else if jaw_y != 0.0 || tip_depth != 0.0 {
        180
    } else {
        90
    };
    let dt = catalog.simulation.simulation_step;
    let slop = catalog.simulation.linear_slop;
    let mut frames = Vec::with_capacity(ticks);
    let mut contacts = Vec::new();
    let mut events = Vec::new();
    for tick in 0..ticks {
        if transit_time != 0.0 && (tick == 1 || tick == 4) {
            let craft = running
                .world
                .entity_mut(SHIP_ID)
                .and_then(|entity| entity.model.craft_mut())
                .expect("transit fixture uses a ship");
            craft.transit_time = if tick == 1 { transit_time } else { 0.0 };
            if tick == 1 {
                craft.object.position = Vector::new(-260.0, 50.0);
                craft.object.velocity = Vector::ZERO;
            }
        }
        running.capture_collision_poses();
        let object = running
            .world
            .entity_mut(body_id)
            .unwrap()
            .model
            .object_mut();
        object.position = object.position.add_scaled(object.velocity, dt);
        object.rotation += object.spin * dt;
        let EntityKind::Portal(gate) = &mut running.world.entity_mut(GATE_ID).unwrap().model else {
            unreachable!("gate remains in the fixture");
        };
        gate.advance(dt);
        contacts.clear();
        events.clear();
        running.collide(dt, &mut events, &mut contacts);

        let body = running.world.entity(body_id).unwrap();
        let craft = body.model.craft().expect("fixture has a craft");
        let object = &craft.object;
        let mut depth = 0.0_f64;
        let EntityKind::Portal(gate) = &running.world.entity(GATE_ID).unwrap().model else {
            unreachable!("gate remains in the fixture");
        };
        if jaw_y != 0.0 || tip_depth != 0.0 || frame_case != 0.0 {
            gate.with_colliders(|gate| {
                body.with_colliders(|body| {
                    for collider in body.iter().filter(|shape| shape.collides && shape.physical) {
                        let moving = collider_shape(collider);
                        for stationary in gate {
                            if let Some(contact) =
                                contact_between(&moving, &collider_shape(stationary), slop)
                            {
                                depth = depth.max(contact.depth);
                            }
                        }
                    }
                });
            });
        }

        frames.push(Frame {
            position: object.position,
            velocity: object.velocity,
            rotation: object.rotation,
            spin: object.spin,
            health: craft
                .hulls
                .iter()
                .map(|hull| {
                    if hull.plan.health.is_none() {
                        -1.0
                    } else if !hull.present || hull.health.is_nan() {
                        0.0
                    } else {
                        hull.health
                    }
                })
                .collect(),
            contacts: contacts.len(),
            opening: gate.opening,
            depth,
        });
    }
    frames
}

fn main() -> Result<(), Box<dyn Error>> {
    let catalog = Arc::new(Catalog::load()?);
    let mut input = serde_json::Deserializer::from_reader(io::stdin().lock());
    let states = Vec::<Vec<f64>>::deserialize(&mut input)?;
    let frames: Vec<_> = states
        .into_iter()
        .map(|state| case(state, &catalog))
        .collect();
    serde_json::to_writer(io::stdout().lock(), &frames)?;
    Ok(())
}
