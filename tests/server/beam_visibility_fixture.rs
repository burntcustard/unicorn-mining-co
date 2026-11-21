use std::{error::Error, io, sync::Arc};

use serde_json::json;
use unicorn_mining_server::objects::craft::{CargoObject, InstalledModule};
use unicorn_mining_server::objects::ship::Ship;
use unicorn_mining_server::simulation::game_object::ObjectProperties;
use unicorn_mining_server::simulation::world::{EntityKind, World};
use unicorn_mining_server::test_fixtures::{
    FixtureReplication, load_example_catalog, update_ship_modules,
};
use unicorn_mining_server::utilities::vector::Vector;

fn ship(world: &mut World, id: i64) -> &mut Ship {
    let EntityKind::Ship(ship) = &mut world.entity_mut(id).expect("spawned ship").model else {
        panic!("fixture entity is not a ship");
    };
    ship
}

fn main() -> Result<(), Box<dyn Error>> {
    let catalog = Arc::new(load_example_catalog()?);
    let mut world = World::new(25.0, Arc::clone(&catalog));
    let observer = world
        .spawn_player_ship(1, "mustang", ObjectProperties::default())
        .expect("stock observer ship");
    let remote_id = world
        .spawn_player_ship(
            2,
            "mustang",
            ObjectProperties {
                position: Vector::new(100.0, 100.0),
                ..ObjectProperties::default()
            },
        )
        .expect("stock remote ship");
    let spec = &catalog.module_specs["laser"];
    let beam = InstalledModule::new(world.ids.object(), "laser".into(), Arc::clone(spec));
    let remote = ship(&mut world, remote_id);
    let mount = remote
        .craft
        .mounts
        .iter()
        .position(|mount| mount.accepts("laser"))
        .expect("stock Mustang has a laser mount");
    if let Some(displaced) = remote.fit(mount, Some(beam)) {
        remote
            .craft
            .cargo_contents
            .push(CargoObject::Module(displaced));
    }
    remote.craft.set_module_active("laser", true);
    update_ship_modules(remote, spec.activation_duration);

    let mut replica = FixtureReplication::new();
    let mut packets = vec![replica.packet(&mut world, observer, true)?];
    for firing in [true, false, true] {
        ship(&mut world, remote_id).firing = firing;
        world.tick += 1;
        packets.push(replica.packet(&mut world, observer, false)?);
    }
    let join = FixtureReplication::new().packet(&mut world, observer, true)?;
    ship(&mut world, remote_id)
        .craft
        .set_module_active("laser", false);
    world.tick += 1;
    packets.push(replica.packet(&mut world, observer, false)?);

    serde_json::to_writer(
        io::stdout().lock(),
        &json!({
            "packets": packets, "join": join, "observerId": observer, "remoteId": remote_id,
        }),
    )?;
    Ok(())
}
