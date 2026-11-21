use std::{error::Error, f64::consts::FRAC_PI_2, io};

use serde_json::json;
use unicorn_mining_server::objects::ship::Ship;
use unicorn_mining_server::simulation::game_object::ObjectProperties;
use unicorn_mining_server::simulation::update_world::WorldIds;
use unicorn_mining_server::specs::Catalog;
use unicorn_mining_server::utilities::vector::Vector;

#[path = "support/ship_colliders.rs"]
mod ship_colliders;

fn main() -> Result<(), Box<dyn Error>> {
    let catalog = Catalog::load()?;
    let cases: Vec<_> = [0.0, FRAC_PI_2]
        .into_iter()
        .map(|rotation| {
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
            ship.craft.object.rotation = rotation;
            json!({
                "shipType": "crescent",
                "rotation": rotation,
                "colliders": ship_colliders::capture(&ship, false),
            })
        })
        .collect();
    serde_json::to_writer(io::stdout().lock(), &cases)?;
    Ok(())
}
