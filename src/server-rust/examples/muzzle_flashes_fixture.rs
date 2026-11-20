//! Authoritative weapon snapshots for the TypeScript muzzle flash test.

use std::collections::HashMap;
use std::error::Error;
use std::io;
use std::sync::Arc;

use serde::Serialize;
use unicorn_mining_server::objects::craft::{CargoObject, InstalledModule};
use unicorn_mining_server::objects::item::Item;
use unicorn_mining_server::objects::ship::Ship;
use unicorn_mining_server::protocol::{Input, InputChange, InputFrame};
use unicorn_mining_server::simulation::game_object::ObjectProperties;
use unicorn_mining_server::simulation::running_world::RunningWorld;
use unicorn_mining_server::simulation::world::{EntityKind, Player};
use unicorn_mining_server::simulation::world_step::WorldStepOptions;
use unicorn_mining_server::specs::Catalog;
use unicorn_mining_server::test_fixtures::{FixtureReplication, load_example_catalog};

#[derive(Serialize)]
struct Case {
    weapon: &'static str,
    initial: String,
    frames: Vec<Frame>,
}

#[derive(Serialize)]
struct Frame {
    edges: Vec<(f64, bool)>,
    shots: i64,
    packet: String,
}

fn firing_case(weapon: &'static str, catalog: Arc<Catalog>) -> Result<Case, Box<dyn Error>> {
    let mut running = RunningWorld::new(25.0, Arc::clone(&catalog));
    let world = &mut running.world;
    let player_id = 1;
    let ship_id = world.ids.entity();
    let mut ship = Ship::new_player(
        ship_id,
        "mustang",
        ObjectProperties {
            player_id: Some(player_id),
            ..ObjectProperties::default()
        },
        &catalog,
        || world.ids.object(),
    )
    .ok_or("Mustang missing from test catalog")?;
    let gun = InstalledModule::new(
        world.ids.object(),
        weapon.to_owned(),
        Arc::clone(&catalog.module_specs[weapon]),
    );
    let mount = ship
        .craft
        .mounts
        .iter()
        .position(|mount| mount.accepts(weapon))
        .ok_or("fixture ship has no compatible mount")?;
    ship.fit(mount, Some(gun));
    let ammunition = Item::new(
        world.ids.entity(),
        "autogunAmmo",
        ObjectProperties::default(),
        &catalog,
    )
    .ok_or("autogun ammunition missing from fixture catalog")?;
    ship.craft
        .cargo_contents
        .push(CargoObject::Item(Box::new(ammunition)));
    world.add_entity(EntityKind::Ship(Box::new(ship)), false);
    world.set_player(Player {
        id: player_id,
        ship_id,
        observer_range: 0.0,
    });

    let mut replication = FixtureReplication::new();
    let initial = replication.packet(world, ship_id, true)?;
    let mut frames = Vec::with_capacity(180);
    let active = Input {
        plasma_active: true,
        autogun_active: true,
        ..Input::default()
    };
    let mut inputs = HashMap::from([(
        player_id,
        InputFrame {
            input: active,
            changes: Vec::with_capacity(2),
        },
    )]);
    let mut previous = active;
    let mut events = Vec::new();

    for tick in 0..180 {
        let phase = tick % 90;
        let frame = inputs.get_mut(&player_id).expect("fixture player input");
        frame.input = previous;
        frame.changes.clear();
        if phase < 30 {
            if phase % 10 == 0 {
                frame.changes.push(InputChange {
                    input: Input {
                        fire: true,
                        ..active
                    },
                    offset: 0.004,
                });
            }
            frame.changes.push(InputChange {
                input: active,
                offset: 0.015,
            });
        } else {
            frame.changes.push(InputChange {
                input: Input {
                    fire: phase < 80,
                    ..active
                },
                offset: 0.012,
            });
        }
        previous = frame.changes.last().expect("fixture input edge").input;
        let edges = frame
            .changes
            .iter()
            .map(|change| (change.offset, change.input.fire))
            .collect();
        let before = running.world.ids.next_entity;
        running.update(
            WorldStepOptions {
                inputs: Some(&inputs),
                ..WorldStepOptions::default()
            },
            &mut events,
        );
        frames.push(Frame {
            edges,
            shots: running.world.ids.next_entity - before,
            packet: replication.packet(&mut running.world, ship_id, false)?,
        });
    }
    Ok(Case {
        weapon,
        initial,
        frames,
    })
}

fn main() -> Result<(), Box<dyn Error>> {
    let catalog = Arc::new(load_example_catalog()?);
    let cases = [
        firing_case("autogun", Arc::clone(&catalog))?,
        firing_case("plasmaAccelerator", catalog)?,
    ];
    serde_json::to_writer(io::stdout().lock(), &cases)?;
    Ok(())
}
