use std::{error::Error, io, sync::Arc};

use serde_json::json;
use unicorn_mining_server::gameplay::collision_world::ColliderPart;
use unicorn_mining_server::objects::craft::{CargoObject, InstalledModule};
use unicorn_mining_server::objects::ship::Ship;
use unicorn_mining_server::simulation::game_object::ObjectProperties;
use unicorn_mining_server::simulation::running_world::RunningWorld;
use unicorn_mining_server::simulation::update_tier::{MovementHandle, MovementWorld};
use unicorn_mining_server::simulation::world::EntityKind;
use unicorn_mining_server::specs::Catalog;
use unicorn_mining_server::test_fixtures::FixtureReplication;

fn main() -> Result<(), Box<dyn Error>> {
    let catalog = Arc::new(Catalog::load()?);
    let mut ship_types: Vec<_> = catalog.ship_specs.keys().collect();
    ship_types.sort_unstable();
    let mut cases = Vec::new();
    for ship_type in ship_types {
        for hull in 0..catalog.ship_specs[ship_type].hull_segments.len() {
            let mut running = RunningWorld::new(25.0, Arc::clone(&catalog));
            let world = &mut running.world;
            let id = world.ids.entity();
            let mut ship =
                Ship::new_player(id, ship_type, ObjectProperties::default(), &catalog, || {
                    world.ids.object()
                })
                .expect("catalog includes the stock ship");
            ship.craft
                .cargo_contents
                .push(CargoObject::Module(InstalledModule::new(
                    world.ids.object(),
                    "searchLight".into(),
                    Arc::clone(&catalog.module_specs["searchLight"]),
                )));
            world.add_entity(EntityKind::Ship(Box::new(ship)), false);

            let mut replica = FixtureReplication::new();
            let before = replica.packet(world, id, true)?;
            let EntityKind::Ship(ship) = &mut world.entity_mut(id).expect("added ship").model
            else {
                panic!("fixture entity is not a ship");
            };
            ship.craft.damage_part(ColliderPart::Hull(hull), 10_000.0);
            world.tick += 1;
            let damaged = replica.packet(world, id, true)?;

            running.update_entity(MovementHandle::by_id(id), 0.0, &[]);
            let world = &mut running.world;
            if world
                .entity(id)
                .is_some_and(|entity| entity.model.object().dead)
            {
                running.remove(id);
            }
            running.world.tick += 1;
            let settled = replica.packet(&mut running.world, id, true)?;
            cases.push(json!({
                "shipType": ship_type, "hull": hull,
                "before": before, "damaged": damaged, "settled": settled,
            }));
        }
    }
    serde_json::to_writer(io::stdout().lock(), &cases)?;
    Ok(())
}
