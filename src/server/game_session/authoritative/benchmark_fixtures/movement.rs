use std::sync::Arc;

use crate::objects::craft::InstalledModule;
use crate::objects::ship::Ship;
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::world::EntityKind;
use crate::utilities::vector::Vector;

use super::AuthoritativeSession;

impl AuthoritativeSession {
    pub(in crate::game_session::authoritative) fn prepare_movement_benchmark(&mut self, id: i64) {
        let Some(account) = self.accounts.get(&id) else {
            return;
        };
        let Some(option) = account.name.strip_prefix("Bench ") else {
            return;
        };
        let definition = format!("thruster{option}");
        let Some(spec) = self.catalog.module_specs.get(&definition).cloned() else {
            return;
        };
        if spec.behavior != "thruster" || account.playing {
            return;
        }
        let index = account.sector;
        let ship_id = account.ship_id;
        let label = account.name.clone();
        self.sectors.update_ids(index);
        let sector = &mut self.sectors[index];
        let world = &mut sector.running.world;

        // Inspect the entire flight corridor, including generated entities.
        let mut position = None;
        for distance in (18_000..=42_000).step_by(2000) {
            for y in [-f64::from(distance), f64::from(distance)] {
                let centers = [-3000.0, 0.0, 3000.0].map(|x| Vector::new(x, y));
                sector.regions.sync(world, &centers);
                let blocked = world
                    .entities()
                    .chain(sector.regions.sleeping_entities())
                    .any(|entity| {
                        let object = entity.model.object();
                        let closest = Vector::new(object.position.x.clamp(-3000.0, 3000.0), y);
                        !object.dead
                            && closest.distance_squared(object.position)
                                < (object.radius + 500.0).powi(2)
                    });
                if !blocked {
                    position = Some(centers[0]);
                    break;
                }
            }
            if position.is_some() {
                break;
            }
        }
        let position = position.expect("movement fixture needs a clear flight corridor");
        let catalog = Arc::clone(&world.catalog);
        let mut ship = Ship::new_player(
            ship_id,
            "mustang",
            ObjectProperties {
                position,
                player_number: Some(id),
                ..Default::default()
            },
            &catalog,
            || world.ids.object(),
        )
        .expect("movement fixture ship");
        let engine = ship.engine().expect("movement fixture engine").id;
        let mount = ship
            .craft
            .mounts
            .iter()
            .position(|mount| {
                mount
                    .module
                    .as_ref()
                    .is_some_and(|module| module.id == engine)
            })
            .expect("movement fixture engine mount");
        if !ship.craft.mounts[mount].accepts(&definition) {
            return;
        }
        ship.fit(
            mount,
            Some(InstalledModule::new(world.ids.object(), definition, spec)),
        );
        ship.craft.object.target_label = label;
        let account = self.accounts.get_mut(&id).unwrap();
        account.hidden = Some(world.make_entity(EntityKind::Ship(Box::new(ship)), false));
        account.position = position;
        self.sectors.commit_ids(index);
    }
}
