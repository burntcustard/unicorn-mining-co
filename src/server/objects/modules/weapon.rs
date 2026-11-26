//! Mounted weapon aim and projectile firing.

use smallvec::SmallVec;

use crate::physics::apply_force;
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::geometry::rotate_point;
use crate::specs::Catalog;
use crate::utilities::vector::Vector;

use crate::objects::craft::{CargoObject, Hull, InstalledModule};
use crate::objects::projectile::Projectile;
use crate::objects::ship::Ship;

impl InstalledModule {
    pub(crate) fn bounded_aim_rotation(&self, rotation: f64) -> f64 {
        if self.spec.turret {
            rotation
        } else if self.spec.aim_limit > 0.0 {
            rotation.clamp(-self.spec.aim_limit, self.spec.aim_limit)
        } else {
            0.0
        }
    }
}

impl Ship {
    pub(crate) fn weapon_target_position(&self) -> Vector {
        let craft = &self.craft;
        let object = &craft.object;
        let present = |hull: &Hull| hull.present && (hull.health >= 1.0 || hull.health.is_nan());
        if craft.hulls.iter().all(present) {
            return object.position;
        }

        // Hull loss leaves the ship's movement origin at its authored position.
        let center = craft.center_of_hulls(
            craft
                .hulls
                .iter()
                .enumerate()
                .filter_map(|(index, hull)| present(hull).then_some(index)),
        );
        object.position + rotate_point(center, object.rotation)
    }

    /// The world supplies a live, unburied target other than this ship.
    pub fn update_weapon_aim(&mut self, duration: f64, target: Option<Vector>) {
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
            let spec = &module.spec;
            if !matches!(spec.behavior.as_str(), "weapon" | "beam") {
                continue;
            }
            let active = (spec.turret || spec.aim_limit > 0.0)
                && module.parts.iter().any(|part| part.active == 1.0);
            if spec.turret && !active {
                continue;
            }

            let angle = if let Some(target) = target.filter(|_| active) {
                let position = object.position + rotate_point(mount.position, object.rotation);
                let direction = target - position;
                if direction == Vector::ZERO && !spec.turret {
                    0.0
                } else {
                    direction.y.atan2(direction.x) - object.rotation
                }
            } else {
                0.0
            };
            let rotation = if spec.turret {
                let turn = normalize_angle(angle - module.aim_rotation);
                let limit = spec.turret_turn_rate * duration;
                normalize_angle(module.aim_rotation + (-limit).max(limit.min(turn)))
            } else if spec.aim_limit > 0.0 {
                let angle = normalize_angle(angle);
                let target = if angle.abs() <= spec.aim_limit {
                    angle
                } else {
                    0.0
                };
                let offset = (module.aim_rotation - target) * (-15.0 * duration).exp();
                if offset.abs() < 0.001 {
                    target
                } else {
                    target + offset
                }
            } else {
                0.0
            };
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
        let Some(player_number) = self.craft.object.player_number else {
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
                        player_number: Some(player_number),
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
    use crate::objects::craft::Craft;
    use crate::objects::item::Item;
    use crate::specs::HullSegment;

    fn fitting_ship(weapon: &str, catalog: &Catalog) -> (Ship, usize) {
        let mut next_module = 0;
        for name in ["mustang", "moth", "crescent", "courser"] {
            let mut ship = Ship::new_player(
                1,
                name,
                ObjectProperties {
                    player_number: Some(9),
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
        assert_eq!(shots[0].object.player_number, Some(9));
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
    fn mounted_weapons_aim_within_their_arc_and_recenter_outside_it()
    -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        for (weapon, aim_limit) in [("autogun", 0.15), ("laser", 0.19), ("cannonSm", 0.0)] {
            let (mut ship, mount) = fitting_ship(weapon, &catalog);
            ship.craft.object.position = Vector::new(17.0, -39.0);
            let rotation = PI - 0.03;
            ship.craft.object.rotation = rotation;
            let pivot = ship.weapon_position(mount, 0.0).unwrap();
            ship.craft.set_module_active(weapon, true);
            let module = ship.craft.mounts[mount].module.as_mut().unwrap();
            Arc::make_mut(&mut module.spec).aim_limit = aim_limit;
            if aim_limit == 0.0 {
                module.aim_rotation = 0.3;
            }

            for offset in [0.08_f64, FRAC_PI_2, -0.08, -FRAC_PI_2, 0.08] {
                let target = pivot + rotate_point(Vector::new(300.0, 0.0), rotation + offset);
                let expected_aim = if offset.abs() <= aim_limit {
                    offset
                } else {
                    0.0
                };
                if expected_aim == 0.0 && aim_limit > 0.0 {
                    ship.update_weapon_aim(0.01, Some(target));
                    let aim = ship.craft.mounts[mount]
                        .module
                        .as_ref()
                        .unwrap()
                        .aim_rotation;
                    assert!(aim.abs() > 0.0 && aim.abs() < 0.08);
                    assert_eq!(aim.is_sign_positive(), offset.is_sign_positive());
                }
                ship.update_weapon_aim(1.0, Some(target));
                let muzzle = ship.weapon_position(mount, 20.0).unwrap();
                let expected =
                    pivot + rotate_point(Vector::new(20.0, 0.0), rotation + expected_aim);
                assert!(muzzle.distance(expected) < 1e-9);
            }

            let neutral = pivot + rotate_point(Vector::new(20.0, 0.0), rotation);
            ship.update_weapon_aim(1.0, None);
            assert!(ship.weapon_position(mount, 20.0).unwrap().distance(neutral) < 1e-9);
        }
        Ok(())
    }

    #[test]
    fn damaged_ship_target_center_follows_its_surviving_hull()
    -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let position = Vector::new(30.0, -10.0);
        let mut ship = Ship::new(
            1,
            "mustang",
            ObjectProperties {
                position,
                rotation: FRAC_PI_2,
                ..Default::default()
            },
            &catalog,
        )
        .expect("stock ship available");
        let core_center = Vector::new(-24.0, 3.0);
        let core = HullSegment {
            points: [[-5.0, -2.0], [5.0, -2.0], [5.0, 2.0], [-5.0, 2.0]]
                .map(|[x, y]| [x + core_center.x, y + core_center.y])
                .to_vec(),
            core: true,
            ..HullSegment::default()
        };
        ship.craft = Craft::new(ship.craft.object, &[core, HullSegment::default()]);
        assert_eq!(ship.weapon_target_position(), position);

        ship.craft.hulls[1].present = false;

        assert!(
            ship.weapon_target_position()
                .distance(position + rotate_point(core_center, FRAC_PI_2))
                < 1e-9
        );
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
        ship.update_weapon_aim(0.01 / rate, Some(target));
        let actual = ship.craft.mounts[mount]
            .module
            .as_ref()
            .expect("turret mounted")
            .aim_rotation;
        assert!((actual - (start + 0.01)).abs() <= 1e-12);

        ship.update_weapon_aim(4.0 / rate, None);
        let actual = ship.craft.mounts[mount]
            .module
            .as_ref()
            .expect("turret mounted")
            .aim_rotation;
        assert!(actual.abs() <= 1e-12);
        Ok(())
    }
}
