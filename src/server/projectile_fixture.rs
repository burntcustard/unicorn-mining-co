//! Projectile prediction cases exercised by the TypeScript client tests.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{Value, json};

use crate::objects::craft::{CargoObject, InstalledModule};
use crate::objects::item::Item;
use crate::protocol::{Input, InputFrame, SimulationEvent};
use crate::simulation::asteroid::{Asteroid, AsteroidProperties};
use crate::simulation::asteroid_geometry::{AsteroidOutlines, center_of};
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::geometry::rotate_point;
use crate::simulation::running_world::RunningWorld;
use crate::simulation::update_world::WorldStepOptions;
use crate::simulation::world::{EntityKind, World};
use crate::specs::Catalog;
use crate::test_fixtures::{FixtureReplication, load_example_catalog};
use crate::utilities::vector::Vector;

pub fn cases() -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let catalog = Arc::new(load_example_catalog()?);
    [Scenario::Impact, Scenario::Drifting, Scenario::Reload]
        .into_iter()
        .map(|case| run(case, Arc::clone(&catalog)))
        .collect()
}

#[derive(Clone, Copy, PartialEq)]
enum Scenario {
    Impact,
    Drifting,
    Reload,
}

fn run(case: Scenario, catalog: Arc<Catalog>) -> Result<Value, Box<dyn std::error::Error>> {
    let weapon = if case == Scenario::Drifting {
        "autogun"
    } else {
        "plasmaAccelerator"
    };
    let repeated = case == Scenario::Reload;
    let reserves_ids = case != Scenario::Impact;
    let mut runtime = RunningWorld::new(25.0, Arc::clone(&catalog));
    let world = &mut runtime.world;
    let ship_id = world
        .spawn_player_ship(1, "mustang", ObjectProperties::default())
        .unwrap();
    let spec = &catalog.module_specs[weapon];
    let gun = InstalledModule::new(world.ids.object(), weapon.into(), Arc::clone(spec));
    let ammo_id = world.ids.entity();
    let EntityKind::Ship(ship) = &mut world.entity_mut(ship_id).unwrap().model else {
        unreachable!()
    };
    let mount = ship
        .craft
        .mounts
        .iter()
        .position(|mount| mount.accepts(weapon))
        .unwrap();
    ship.fit(mount, Some(gun));
    ship.craft.set_module_active("weapon", true);
    let deploy = spec.activation_duration + spec.charge_duration;
    ship.update_boosters(deploy);
    ship.craft.update_modules(deploy, ship.systems_power, None);
    let ammo = Item::new(
        ammo_id,
        "autogunAmmo",
        ObjectProperties::default(),
        &catalog,
    )
    .unwrap();
    ship.craft
        .cargo_contents
        .push(CargoObject::Item(Box::new(ammo)));

    let (id, radius, x, velocity, spin, rotation, ticks) = match case {
        Scenario::Impact => (100, 50.0, 150.0, 1.0, 0.01, 0.0, 320),
        Scenario::Drifting => (100, 51.25, 650.0, 0.0, 0.04132459, 2.87398488, 160),
        Scenario::Reload => (3_324_057_349, 70.0, 160.0, 1.0, 0.1, 0.0, 640),
    };
    let mut rock = Asteroid::new(
        id,
        AsteroidProperties {
            object: ObjectProperties {
                position: Vector::new(x, -25.0),
                radius: Some(radius),
                rotation,
                spin,
                velocity: Vector::new(0.0, velocity),
                ..Default::default()
            },
            contents: if repeated { vec![1, 1, 1] } else { Vec::new() },
            ..Default::default()
        },
        &catalog,
        &mut AsteroidOutlines::default(),
    );
    rock.lock_geometry();
    world.add_entity(EntityKind::Asteroid(Box::new(rock)), false);

    let mut replication = FixtureReplication::new();
    let initial = replication.packet(world, ship_id, true)?;
    let mut frames = Vec::with_capacity(ticks);
    let mut inputs = HashMap::new();
    let mut events = Vec::new();
    for tick in 0..ticks {
        if reserves_ids && tick % 5 == 0 {
            runtime.world.ids.entity();
        }
        let input = Input {
            plasma_active: true,
            autogun_active: true,
            fire: repeated || tick < 304,
            turn: if repeated {
                steer_to_asteroid(&runtime.world, ship_id, id)
            } else {
                0.0
            },
            ..Default::default()
        };
        inputs.insert(
            1,
            InputFrame {
                input,
                changes: Vec::new(),
            },
        );
        runtime.update(
            WorldStepOptions {
                inputs: Some(&inputs),
                ..Default::default()
            },
            &mut events,
        );

        let world = &mut runtime.world;
        let packet = if reserves_ids || world.tick.is_multiple_of(4) {
            replication.packet(world, ship_id, false)?
        } else {
            String::new()
        };
        let reload = if repeated && tick == 240 {
            FixtureReplication::new().packet(world, ship_id, true)?
        } else {
            String::new()
        };
        let mut asteroids = Vec::new();
        let mut poses = serde_json::Map::new();
        for entity in world.entities() {
            if let EntityKind::Asteroid(asteroid) = &entity.model {
                let object = &asteroid.object;
                asteroids.push(object.id);
                poses.insert(
                    object.id.to_string(),
                    json!({ "Position": object.position, "Rotation": object.rotation }),
                );
            }
        }
        let mut hits = Vec::new();
        let mut splits = Vec::new();
        for event in &events {
            match event {
                SimulationEvent::CollisionEvent {
                    a,
                    b,
                    damage,
                    colors,
                    position,
                    ..
                } => {
                    hits.push(json!({ "a": a, "b": b, "damage": damage, "colors": colors, "position": position }));
                }
                SimulationEvent::AsteroidSplit { asteroid_id, .. } => splits.push(*asteroid_id),
                _ => {}
            }
        }
        frames.push(json!({
            "input": {"fire": input.fire, "plasmaActive": input.plasma_active, "autogunActive": input.autogun_active, "turn": input.turn},
            "packet": packet, "reload": reload, "asteroids": asteroids, "poses": poses, "hits": hits, "splits": splits
        }));
    }
    Ok(json!({
        "initial": initial, "frames": frames
    }))
}

fn steer_to_asteroid(world: &World, ship_id: i64, rock_id: i64) -> f64 {
    let ship = world.entity(ship_id).unwrap().model.object();
    let start = world
        .entity(rock_id)
        .and_then(|entity| match &entity.model {
            EntityKind::Asteroid(rock) => Some(&**rock),
            _ => None,
        });
    let largest = world
        .entities()
        .filter_map(|entity| match &entity.model {
            EntityKind::Asteroid(rock) => Some(&**rock),
            _ => None,
        })
        .fold(start, |largest, candidate| {
            if largest.is_none_or(|rock| candidate.object.mass > rock.object.mass) {
                Some(candidate)
            } else {
                largest
            }
        });
    let Some(largest) = largest else { return 0.0 };
    let object = &largest.object;
    let target = largest
        .segments()
        .and_then(|segments| segments.iter().find(|segment| segment.health > 1.0))
        .map_or(object.position, |segment| {
            object.position + rotate_point(center_of(&segment.outline), object.rotation)
        });
    let delta = target - ship.position;
    let angle = (delta.y + 25.0).atan2(delta.x) - ship.rotation;
    let adjustment = angle.sin().atan2(angle.cos()) - ship.spin * 0.15;
    if adjustment.abs() > 0.005 {
        1.0_f64.copysign(adjustment)
    } else {
        0.0
    }
}
