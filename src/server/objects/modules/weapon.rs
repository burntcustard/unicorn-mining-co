//! Mounted weapon aim and projectile firing.

use smallvec::SmallVec;

use crate::physics::apply_force;
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::geometry::rotate_point;
use crate::specs::{Catalog, Module};
use crate::utilities::vector::Vector;

use crate::objects::craft::{CargoObject, Hull, InstalledModule};
use crate::objects::projectile::Projectile;
use crate::objects::ship::Ship;

#[derive(Clone, Copy)]
pub struct WeaponTarget {
    pub position: Vector,
    pub velocity: Vector,
}

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
    pub fn update_weapon_aim(&mut self, duration: f64, target: Option<WeaponTarget>) {
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
                let mut direction = target.position - position;
                if !spec.turret && spec.behavior == "weapon" {
                    direction = projectile_lead(direction, target.velocity - object.velocity, spec);
                }
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
                    projectile_muzzle_distance(spec),
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

fn projectile_muzzle_distance(spec: &Module) -> f64 {
    spec.barrel_length + spec.projectile.radius + 1.0
}

fn projectile_lead(direction: Vector, relative_velocity: Vector, spec: &Module) -> Vector {
    let speed = spec.projectile.speed;
    let muzzle_distance = projectile_muzzle_distance(spec);
    let distance_squared = direction.length_squared() - muzzle_distance * muzzle_distance;
    if speed <= 0.0 || distance_squared <= 0.0 {
        return direction;
    }

    // Solve |direction + relative_velocity * time| = muzzle_distance + speed * time.
    let approach = direction.dot(relative_velocity) - muzzle_distance * speed;
    let speed_difference = speed * speed - relative_velocity.length_squared();
    let denominator = (approach * approach + speed_difference * distance_squared).sqrt() - approach;
    if denominator > 0.0 {
        direction.add_scaled(relative_velocity, distance_squared / denominator)
    } else {
        direction
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
    use crate::specs::{HullSegment, MountPoint};
    use crate::test_fixtures::load_example_catalog;

    fn fitting_ship(weapon: &str, catalog: &Catalog) -> Ship {
        let mut ship = Ship::new(
            1,
            "mustang",
            ObjectProperties {
                player_number: Some(9),
                ..ObjectProperties::default()
            },
            catalog,
        )
        .unwrap();
        ship.craft = Craft::new(
            ship.craft.object,
            &[HullSegment {
                core: true,
                mounts: vec![vec![MountPoint::default()]],
                ..HullSegment::default()
            }],
        );
        ship.fit(
            0,
            Some(InstalledModule::new(
                -1,
                weapon.into(),
                Arc::clone(&catalog.module_specs[weapon]),
            )),
        );
        ship
    }

    #[test]
    fn firing_consumes_ammo_and_applies_recoil_after_the_projectile_spawns() {
        let mut catalog = load_example_catalog().unwrap();
        Arc::make_mut(catalog.module_specs.get_mut("autogun").unwrap()).recoil = 12.0;
        let mut ship = fitting_ship("autogun", &catalog);
        let spec = &catalog.module_specs["autogun"];
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
            .weapon_position(0, spec.barrel_length + spec.projectile.radius + 1.0)
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
    }

    #[test]
    fn assisted_projectile_mount_leads_and_respects_its_arc() {
        let mut catalog = load_example_catalog().unwrap();
        Arc::make_mut(catalog.module_specs.get_mut("autogun").unwrap()).aim_limit = 0.07;
        let spec = &catalog.module_specs["autogun"];
        let mut ship = fitting_ship("autogun", &catalog);
        let rotation = PI - 0.03;
        let velocity = Vector::new(7.0, -13.0);
        ship.craft.object.position = Vector::new(17.0, -39.0);
        ship.craft.object.rotation = rotation;
        ship.craft.object.velocity = velocity;
        ship.craft.set_module_active("autogun", true);

        let pivot = ship.weapon_position(0, 0.0).unwrap();
        let relative_velocity = rotate_point(Vector::new(-50.0, 100.0), rotation);
        let time = 0.5;
        let distance =
            spec.barrel_length + spec.projectile.radius + 1.0 + spec.projectile.speed * time;
        for (aim, expected) in [(0.04, 0.04), (0.4, 0.0), (-0.04, -0.04)] {
            let target = WeaponTarget {
                position: pivot + rotate_point(Vector::new(distance, 0.0), rotation + aim)
                    - relative_velocity * time,
                velocity: velocity + relative_velocity,
            };
            ship.update_weapon_aim(1.0, Some(target));
            let muzzle = ship.weapon_position(0, 20.0).unwrap();
            let expected = pivot + rotate_point(Vector::new(20.0, 0.0), rotation + expected);
            assert!(muzzle.distance(expected) < 1e-9);
        }
        ship.update_weapon_aim(1.0, None);
        let neutral = pivot + rotate_point(Vector::new(20.0, 0.0), rotation);
        assert!(ship.weapon_position(0, 20.0).unwrap().distance(neutral) < 1e-9);
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
    fn turret_takes_short_path_and_recenters_without_a_target() {
        let mut catalog = load_example_catalog().unwrap();
        let spec = Arc::make_mut(catalog.module_specs.get_mut("autogun").unwrap());
        spec.turret = true;
        spec.turret_turn_rate = 0.8;
        let mut ship = fitting_ship("autogun", &catalog);
        ship.craft.set_module_active("autogun", true);
        let position = ship.craft.object.position + ship.craft.mounts[0].position;
        let module = ship.craft.mounts[0]
            .module
            .as_mut()
            .expect("turret mounted");
        let start = PI - 0.02;
        module.aim_rotation = start;
        let rate = module.spec.turret_turn_rate;
        let target = WeaponTarget {
            position: position + rotate_point(Vector::new(120.0, 0.0), -PI + 0.05),
            velocity: Vector::new(0.0, 100.0),
        };
        ship.update_weapon_aim(0.01 / rate, Some(target));
        let actual = ship.craft.mounts[0]
            .module
            .as_ref()
            .expect("turret mounted")
            .aim_rotation;
        assert!((actual - (start + 0.01)).abs() <= 1e-12);

        ship.update_weapon_aim(4.0 / rate, None);
        let actual = ship.craft.mounts[0]
            .module
            .as_ref()
            .expect("turret mounted")
            .aim_rotation;
        assert!(actual.abs() <= 1e-12);
    }
}
