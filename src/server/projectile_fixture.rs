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

pub fn cases(group: &str) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    if !matches!(
        group,
        "all" | "autogun" | "plasma" | "repeated" | "triangles"
    ) {
        return Err(format!("unknown projectile fixture group: {group}").into());
    }
    let catalog = Arc::new(load_example_catalog()?);
    SCENARIOS
        .into_iter()
        .filter(|case| case.selected(group))
        .map(|case| run(group, case, Arc::clone(&catalog)))
        .collect()
}

#[derive(Clone, Copy)]
struct Scenario {
    weapon: &'static str,
    moving: bool,
    reserves_ids: bool,
    repeated: bool,
    triangle: bool,
    drifting: bool,
}

impl Scenario {
    fn selected(self, group: &str) -> bool {
        match group {
            "all" => true,
            "autogun" => self.weapon == AUTOGUN.weapon && !self.repeated,
            "plasma" => self.weapon == PLASMA.weapon && !self.repeated,
            "triangles" => self.weapon == AUTOGUN.weapon && self.triangle,
            "repeated" => self.repeated,
            _ => false,
        }
    }
}

const AUTOGUN: Scenario = Scenario {
    weapon: "autogun",
    moving: false,
    triangle: false,
    drifting: false,
    reserves_ids: false,
    repeated: false,
};
const PLASMA: Scenario = Scenario {
    weapon: "plasmaAccelerator",
    ..AUTOGUN
};
const SCENARIOS: [Scenario; 12] = [
    AUTOGUN,
    Scenario {
        moving: true,
        ..AUTOGUN
    },
    PLASMA,
    Scenario {
        reserves_ids: true,
        ..PLASMA
    },
    Scenario {
        moving: true,
        ..PLASMA
    },
    Scenario {
        moving: true,
        reserves_ids: true,
        repeated: true,
        ..PLASMA
    },
    Scenario {
        triangle: true,
        ..AUTOGUN
    },
    Scenario {
        moving: true,
        triangle: true,
        ..AUTOGUN
    },
    Scenario {
        drifting: true,
        triangle: true,
        ..AUTOGUN
    },
    Scenario {
        drifting: true,
        triangle: true,
        reserves_ids: true,
        ..AUTOGUN
    },
    Scenario {
        triangle: true,
        ..PLASMA
    },
    Scenario {
        moving: true,
        triangle: true,
        ..PLASMA
    },
];

fn run(
    group: &str,
    case: Scenario,
    catalog: Arc<Catalog>,
) -> Result<Value, Box<dyn std::error::Error>> {
    let mut runtime = RunningWorld::new(25.0, Arc::clone(&catalog));
    let world = &mut runtime.world;
    let ship_id = world
        .spawn_player_ship(1, "mustang", ObjectProperties::default())
        .unwrap();
    let spec = &catalog.module_specs[case.weapon];
    let gun = InstalledModule::new(world.ids.object(), case.weapon.into(), Arc::clone(spec));
    let ammo_id = world.ids.entity();
    let EntityKind::Ship(ship) = &mut world.entity_mut(ship_id).unwrap().model else {
        unreachable!()
    };
    let mount = ship
        .craft
        .mounts
        .iter()
        .position(|mount| mount.accepts(case.weapon))
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

    let (id, radius, position, spin, rotation, contents, ticks) = if case.repeated {
        (
            3_324_057_349,
            70.0,
            Vector::new(160.0, -25.0),
            0.1,
            0.0,
            vec![1, 1, 1],
            640,
        )
    } else {
        let radius = if case.triangle { 51.25 } else { 50.0 };
        let x = if case.drifting { 650.0 } else { 150.0 };
        let (spin, rotation) = if case.drifting {
            (0.04132459, 2.87398488)
        } else {
            (
                if case.moving { 0.01 } else { 0.0 },
                if case.triangle { 0.71 } else { 0.0 },
            )
        };
        let ticks = match group {
            "autogun" => 272,
            "triangles" => 160,
            _ => 320,
        };
        (
            100,
            radius,
            Vector::new(x, -25.0),
            spin,
            rotation,
            Vec::new(),
            ticks,
        )
    };
    let mut rock = Asteroid::new(
        id,
        AsteroidProperties {
            object: ObjectProperties {
                position,
                radius: Some(radius),
                rotation,
                spin,
                velocity: Vector::new(0.0, if case.moving { 1.0 } else { 0.0 }),
                ..Default::default()
            },
            contents,
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
        if case.reserves_ids && tick % 5 == 0 {
            runtime.world.ids.entity();
        }
        let input = Input {
            plasma_active: true,
            autogun_active: true,
            fire: case.repeated || tick < 304,
            turn: if case.repeated {
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
        let packet = if case.reserves_ids || world.tick.is_multiple_of(4) {
            replication.packet(world, ship_id, false)?
        } else {
            String::new()
        };
        let reload = if case.repeated && tick == 240 {
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
        "weapon": case.weapon, "drifting": case.drifting, "triangle": case.triangle,
        "reservesIDs": case.reserves_ids, "repeated": case.repeated, "moving": case.moving,
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
