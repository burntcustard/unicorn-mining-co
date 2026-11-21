use std::collections::HashMap;
use std::sync::Arc;

use unicorn_mining_server::objects::craft::CargoObject;
use unicorn_mining_server::objects::item::Item;
use unicorn_mining_server::objects::projectile::Projectile;
use unicorn_mining_server::objects::saved_ship::SavedShip;
use unicorn_mining_server::objects::ship::Ship;
use unicorn_mining_server::protocol::{Input, InputFrame, SimulationEvent};
use unicorn_mining_server::simulation::game_object::{GameObject, ObjectProperties};
use unicorn_mining_server::simulation::running_world::RunningWorld;
use unicorn_mining_server::simulation::update_world::WorldStepOptions;
use unicorn_mining_server::simulation::world::EntityKind;
use unicorn_mining_server::specs::Catalog;
use unicorn_mining_server::utilities::vector::Vector;

#[test]
fn a_player_ship_advances_through_the_concrete_world() {
    let catalog = Arc::new(Catalog::load().unwrap());
    let mut simulation = RunningWorld::new(25.0, catalog);
    let ship_id = simulation
        .world
        .spawn_player_ship(1, "mustang", ObjectProperties::default())
        .unwrap();
    let inputs = HashMap::from([(
        1,
        InputFrame {
            input: Input {
                thrust: 1.0,
                ..Input::default()
            },
            ..InputFrame::default()
        },
    )]);
    let mut events = Vec::new();
    for _ in 0..60 {
        simulation.update(
            WorldStepOptions {
                inputs: Some(&inputs),
                ..WorldStepOptions::default()
            },
            &mut events,
        );
    }
    let ship = simulation.world.entity(ship_id).unwrap();
    let EntityKind::Ship(ship) = &ship.model else {
        panic!("spawned entity changed type")
    };
    assert_eq!(simulation.world.tick, 60);
    assert!(ship.craft.object.position.x > 20.0);
    assert_eq!(ship.craft.object.position.y, 0.0);
    assert!(ship.fuel < ship.fuel_capacity);
}

#[test]
fn projectile_impact_runs_inside_the_concrete_world() {
    let catalog = Arc::new(Catalog::load().unwrap());
    let mut simulation = RunningWorld::new(25.0, Arc::clone(&catalog));
    let target = GameObject::new(
        1,
        ObjectProperties {
            radius: Some(6.0),
            health: Some(100.0),
            ..ObjectProperties::default()
        },
        &catalog.simulation,
    );
    simulation
        .world
        .add_entity(EntityKind::Object(Box::new(target)), false);
    let shot = Projectile::new(
        2,
        "plasmaAccelerator",
        ObjectProperties {
            position: Vector::new(-20.0, 0.0),
            velocity: Vector::new(1500.0, 0.0),
            player_id: Some(3),
            ..ObjectProperties::default()
        },
        &catalog,
    )
    .unwrap();
    simulation
        .world
        .add_entity(EntityKind::Projectile(Box::new(shot)), false);
    let mut events = Vec::new();
    simulation.update(WorldStepOptions::default(), &mut events);
    assert!(events.iter().any(|event| matches!(
        event,
        SimulationEvent::CollisionEvent {
            a: 2,
            b: 1,
            by: 3,
            ..
        }
    )));
    assert!(simulation.world.entity(2).is_none());
    assert!(simulation.world.entity(1).unwrap().model.object().health < 100.0);
}

#[test]
fn saved_player_ship_resumes_stationary_with_cargo_and_fuel() {
    let catalog = Catalog::load().unwrap();
    let mut id = 0;
    let mut ship = Ship::new_player(1, "mustang", ObjectProperties::default(), &catalog, || {
        id -= 1;
        id
    })
    .unwrap();
    ship.craft.object.position = Vector::new(10.5, -20.5);
    ship.craft.object.velocity = Vector::new(100.0, 12.0);
    ship.fuel *= 0.4;
    let mut item = Item::new(
        17,
        &catalog.item_ids[0],
        ObjectProperties::default(),
        &catalog,
    )
    .unwrap();
    item.object.mined = true;
    ship.craft
        .cargo_contents
        .push(CargoObject::Item(Box::new(item)));
    let saved = SavedShip::capture(&ship, &catalog);
    let json = serde_json::to_string(&saved).unwrap();
    let restored = serde_json::from_str::<SavedShip>(&json)
        .unwrap()
        .restore(3, &catalog)
        .unwrap();
    assert_eq!(restored.craft.object.position, Vector::new(11.0, -21.0));
    assert_eq!(restored.craft.object.velocity, Vector::ZERO);
    assert_eq!(restored.fuel, ship.fuel);
    assert_eq!(restored.craft.object.player_id, Some(3));
    assert_eq!(
        restored
            .craft
            .mounts
            .iter()
            .filter(|mount| mount.module.is_some())
            .count(),
        saved.modules.len()
    );
    assert!(
        matches!(&restored.craft.cargo_contents[0], CargoObject::Item(item) if item.object.mined)
    );
}
