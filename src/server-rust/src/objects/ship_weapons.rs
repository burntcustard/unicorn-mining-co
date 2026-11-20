//! Turret steering and mounted projectile weapons.

use smallvec::SmallVec;

use crate::physics::apply_force;
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::geometry::rotate_point;
use crate::specs::Catalog;
use crate::vector::Vector;

use super::craft::CargoObject;
use super::projectile::Projectile;
use super::ship::Ship;

impl Ship {
    /// The world supplies a live, unburied target other than this ship.
    pub fn update_turrets(&mut self, duration: f64, target: Option<Vector>) {
        let object = &self.craft.object;
        if object.dead {
            return;
        }
        let mut changed = false;
        for mount in &mut self.craft.mounts {
            if mount.health <= 0.0 || !self.craft.hulls[mount.hull].present {
                continue;
            }
            let Some(module) = &mut mount.module else {
                continue;
            };
            if !module.spec.turret || !module.parts.iter().any(|part| part.active == 1.0) {
                continue;
            }

            let angle = if let Some(target) = target {
                let position = object.position + rotate_point(mount.position, object.rotation);
                let direction = target - position;
                direction.y.atan2(direction.x) - object.rotation
            } else {
                0.0
            };
            let difference = angle - module.aim_rotation;
            let turn = normalize_angle(difference);
            let limit = module.spec.turret_turn_rate * duration;
            let rotation = module.aim_rotation + (-limit).max(limit.min(turn));
            let rotation = normalize_angle(rotation);
            changed |= rotation.to_bits() != module.aim_rotation.to_bits();
            module.aim_rotation = rotation;
        }
        if changed {
            self.craft.invalidate_collision_geometry();
        }
    }

    pub fn weapon_position(&self, mount: usize, distance: f64) -> Option<Vector> {
        let mount = self.craft.mounts.get(mount)?;
        let module = mount.module.as_ref()?;
        let object = &self.craft.object;
        Some(weapon_position(
            object.position,
            object.rotation,
            mount.position,
            module.aim_rotation,
            distance,
        ))
    }

    pub fn fire_projectiles(
        &mut self,
        duration: f64,
        catalog: &Catalog,
        mut next_entity_id: impl FnMut() -> i64,
    ) -> SmallVec<[Box<Projectile>; 4]> {
        let mut spawned = SmallVec::new();
        let Some(player_id) = self.craft.object.player_id else {
            return spawned;
        };
        if self.craft.object.dead
            || self.craft.docked()
            || self.craft.launching != 0.0
            || self.craft.transit_time != 0.0
        {
            return spawned;
        }

        let mass = self.craft.object.force_mass();
        let object = &mut self.craft.object;
        let cargo = &mut self.craft.cargo_contents;
        for mount in &mut self.craft.mounts {
            if !self.craft.hulls[mount.hull].present {
                continue;
            }
            let Some(module) = &mut mount.module else {
                continue;
            };
            let spec = &module.spec;
            if spec.behavior != "weapon" {
                continue;
            }
            module.fire_cooldown -= duration;
            let active = mount.health > 0.0
                && module
                    .parts
                    .iter()
                    .any(|part| part.active != 0.0 && part.activation_progress == 1.0);
            if !self.firing || !active || module.charge_cooldown > 1e-9 {
                module.fire_cooldown = module.fire_cooldown.max(0.0);
                continue;
            }
            if spec.fire_interval <= 0.0
                || !catalog.module_specs.contains_key(&module.definition_id)
            {
                continue;
            }

            while module.fire_cooldown <= 1e-9 {
                if let Some(ammo) = spec.ammo
                    && !consume_ammunition(cargo, ammo)
                {
                    module.fire_cooldown = 0.0;
                    break;
                }

                let rotation = object.rotation + module.aim_rotation;
                let position = weapon_position(
                    object.position,
                    object.rotation,
                    mount.position,
                    module.aim_rotation,
                    spec.barrel_length + spec.projectile.radius + 1.0,
                );
                let velocity = object.velocity
                    + rotate_point(Vector::new(spec.projectile.speed, 0.0), rotation);
                let projectile = Projectile::new(
                    next_entity_id(),
                    &module.definition_id,
                    ObjectProperties {
                        position,
                        velocity,
                        player_id: Some(player_id),
                        ..ObjectProperties::default()
                    },
                    catalog,
                );
                if let Some(projectile) = projectile {
                    spawned.push(Box::new(projectile));
                    if spec.recoil != 0.0 {
                        apply_force(
                            &mut object.velocity,
                            &mut object.spin,
                            mass,
                            rotate_point(Vector::new(-spec.recoil, 0.0), rotation),
                            0.0,
                        );
                    }
                }
                module.fire_cooldown += spec.fire_interval;
            }
        }

        spawned
    }
}

fn weapon_position(
    position: Vector,
    rotation: f64,
    mount: Vector,
    aim_rotation: f64,
    distance: f64,
) -> Vector {
    let local = rotate_point(Vector::new(distance, 0.0), aim_rotation);
    position + rotate_point(mount + local, rotation)
}

fn normalize_angle(angle: f64) -> f64 {
    let (sin, cos) = angle.sin_cos();
    sin.atan2(cos)
}

fn consume_ammunition(cargo: &mut Vec<CargoObject>, ammo: i32) -> bool {
    for (index, object) in cargo.iter_mut().enumerate() {
        if let CargoObject::Item(item) = object
            && item.object.resource == Some(ammo)
            && let Some(rounds) = &mut item.rounds
            && *rounds > 0
        {
            *rounds -= 1;
            if *rounds == 0 {
                cargo.remove(index);
            }
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use std::f64::consts::{FRAC_PI_2, PI};
    use std::sync::Arc;

    use super::*;
    use crate::objects::craft::InstalledModule;
    use crate::objects::item::Item;

    fn fitting_ship(weapon: &str, catalog: &Catalog) -> (Ship, usize) {
        let mut next_module = 0;
        for name in ["mustang", "moth", "crescent", "courser"] {
            let mut ship = Ship::new_player(
                1,
                name,
                ObjectProperties {
                    player_id: Some(9),
                    ..ObjectProperties::default()
                },
                catalog,
                || {
                    next_module -= 1;
                    next_module
                },
            )
            .expect("stock ship available");
            if let Some(mount) = ship
                .craft
                .mounts
                .iter()
                .position(|mount| mount.accepts(weapon))
            {
                ship.fit(
                    mount,
                    Some(InstalledModule::new(
                        -1000,
                        weapon.into(),
                        Arc::clone(&catalog.module_specs[weapon]),
                    )),
                );
                return (ship, mount);
            }
        }
        panic!("stock ships accept {weapon}");
    }

    #[test]
    fn firing_consumes_ammo_and_applies_recoil_after_the_projectile_spawns()
    -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let (mut ship, mount) = fitting_ship("autogun", &catalog);
        let spec = Arc::clone(&catalog.module_specs["autogun"]);
        let mut ammo = Item::new(22, "autogunAmmo", ObjectProperties::default(), &catalog)
            .expect("ammo available");
        ammo.rounds = Some(1);
        ship.craft
            .cargo_contents
            .push(CargoObject::Item(Box::new(ammo)));
        ship.craft.object.rotation = FRAC_PI_2;
        ship.craft.object.velocity = Vector::new(7.0, -3.0);
        ship.craft.set_module_active("autogun", true);
        ship.craft.update_modules(3.0, 1.0, Some(0));
        ship.firing = true;

        let start = ship.craft.object.velocity;
        let muzzle = ship
            .weapon_position(mount, spec.barrel_length + spec.projectile.radius + 1.0)
            .expect("weapon mounted");
        let shots = ship.fire_projectiles(0.0, &catalog, || 51);
        assert_eq!(shots.len(), 1);
        assert_eq!(shots[0].object.id, 51);
        assert_eq!(shots[0].object.player_id, Some(9));
        assert_eq!(shots[0].object.position, muzzle);
        assert!((shots[0].object.velocity.distance(start) - spec.projectile.speed).abs() <= 1e-8);
        let expected_recoil = Vector::new(0.0, -spec.recoil / ship.craft.object.force_mass());
        assert!((ship.craft.object.velocity - start).distance(expected_recoil) <= 1e-8);
        assert_eq!(ship.craft.object.spin, 0.0);
        assert!(ship.craft.cargo_contents.is_empty());

        let after = ship.craft.object.velocity;
        assert!(
            ship.fire_projectiles(spec.fire_interval * 2.0, &catalog, || 52)
                .is_empty()
        );
        assert_eq!(ship.craft.object.velocity, after);
        Ok(())
    }

    #[test]
    fn turret_takes_short_path_and_recenters_without_a_target()
    -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let (mut ship, mount) = fitting_ship("autogunTurret", &catalog);
        ship.craft.set_module_active("autogunTurret", true);
        let position = ship.craft.object.position + ship.craft.mounts[mount].position;
        let module = ship.craft.mounts[mount]
            .module
            .as_mut()
            .expect("turret mounted");
        let start = PI - 0.02;
        module.aim_rotation = start;
        let rate = module.spec.turret_turn_rate;
        let target = position + rotate_point(Vector::new(120.0, 0.0), -PI + 0.05);
        ship.update_turrets(0.01 / rate, Some(target));
        let actual = ship.craft.mounts[mount]
            .module
            .as_ref()
            .expect("turret mounted")
            .aim_rotation;
        assert!((actual - (start + 0.01)).abs() <= 1e-12);

        ship.update_turrets(4.0 / rate, None);
        let actual = ship.craft.mounts[mount]
            .module
            .as_ref()
            .expect("turret mounted")
            .aim_rotation;
        assert!(actual.abs() <= 1e-12);
        Ok(())
    }
}
