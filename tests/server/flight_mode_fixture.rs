use std::{error::Error, io};

use serde_json::json;
use unicorn_mining_server::objects::ship::{Ship, ShipStep};
use unicorn_mining_server::protocol::Input;
use unicorn_mining_server::simulation::game_object::ObjectProperties;
use unicorn_mining_server::simulation::update_world::WorldIds;
use unicorn_mining_server::specs::{Catalog, HULL_Z_INDEX};
use unicorn_mining_server::utilities::vector::Vector;

#[path = "support/ship_colliders.rs"]
mod ship_colliders;

fn main() -> Result<(), Box<dyn Error>> {
    let catalog = Catalog::load()?;
    let mut ids = WorldIds::default();
    let mut ship = Ship::new_player(
        ids.entity(),
        "crescent",
        ObjectProperties::default(),
        &catalog,
        || ids.object(),
    )
    .expect("catalog includes the stock Crescent");
    ship.craft.object.position = Vector::new(18.0, -29.0);
    ship.craft.object.rotation = 0.37;

    let stages = [
        (18, true, 1.0, 0.5),
        (18, true, 1.0, 0.5),
        (9, false, 0.0, -0.5),
        (27, false, 0.6, 0.0),
        (36, true, 1.0, -0.25),
    ];
    let mut hull_order: Vec<_> = (0..ship.craft.hulls.len()).collect();
    hull_order.sort_by_key(|&index| ship.craft.hulls[index].plan.z_index.unwrap_or(HULL_Z_INDEX));
    let mut mount_order: Vec<_> = (0..ship.craft.mounts.len()).collect();
    mount_order.sort_by_key(|&index| {
        ship.craft.hulls[ship.craft.mounts[index].hull]
            .plan
            .z_index
            .unwrap_or(HULL_Z_INDEX)
    });
    let loadout = &catalog.ship_specs["crescent"].initial_loadout;
    let mut module_order: Vec<_> = loadout.iter().map(|entry| entry.mount).collect();
    module_order.sort_by_key(|&mount| {
        ship.craft.mounts[mount]
            .module
            .as_ref()
            .and_then(|module| module.spec.z_index)
            .unwrap_or(HULL_Z_INDEX)
    });

    let mut tick = 0;
    let mut events = Vec::new();
    let mut steps = Vec::new();
    let dt = 1.0 / 60.0;
    for (frames, active, thrust, turn) in stages {
        for _ in 0..frames {
            events.clear();
            ship.control(
                Input {
                    flight_mode: active,
                    thrust,
                    turn,
                    ..Input::default()
                },
                None,
                &mut events,
            );
            ship.advance_flight(
                dt,
                ShipStep {
                    tick: Some(tick),
                    ..ShipStep::default()
                },
            );
            tick += 1;
        }
        let craft = &ship.craft;
        let object = &craft.object;
        let hulls: Vec<_> = hull_order
            .iter()
            .map(|&index| json!({"index": index, "position": craft.hulls[index].position}))
            .collect();
        let mounts: Vec<_> = mount_order
            .iter()
            .enumerate()
            .map(
                |(index, &mount)| json!({"index": index, "position": craft.mounts[mount].position}),
            )
            .collect();
        let mut module_parts = Vec::new();
        let mut progress = 0.0_f64;
        for &mount in &module_order {
            let index = mount_order
                .iter()
                .position(|&value| value == mount)
                .unwrap();
            let module = craft.mounts[mount].module.as_ref().unwrap();
            for part in &module.parts {
                module_parts.push(json!({"mount": index, "position": part.position}));
                if module.spec.behavior == "flightMode" {
                    progress = progress.max(part.activation_progress);
                }
            }
        }
        steps.push(json!({
            "frames": frames, "active": active, "thrust": thrust, "turn": turn,
            "position": object.position, "velocity": object.velocity,
            "rotation": object.rotation, "spin": object.spin, "fuel": ship.fuel,
            "progress": progress, "forwardThrust": ship.forward_thrust(),
            "rotationalThrust": ship.rotational_thrust(), "maxSpeed": ship.max_speed(),
            "hulls": hulls, "mounts": mounts, "moduleParts": module_parts,
            "colliders": ship_colliders::capture(&ship, true),
        }));
    }
    serde_json::to_writer(io::stdout().lock(), &json!({"dt": dt, "steps": steps}))?;
    Ok(())
}
