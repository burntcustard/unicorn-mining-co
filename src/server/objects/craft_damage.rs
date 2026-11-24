//! Hull fracture, detached module wreckage, and loose cargo after a hull loss.

use std::f64::consts::PI;

use crate::physics::apply_force;
use crate::simulation::game_object::{GameObject, ObjectProperties};
use crate::simulation::geometry::{move_point, rotate_point, shape_outline_extent};
use crate::simulation::polygon::{ShapeOutline, outer_edges};
use crate::specs::{Catalog, HULL_Z_INDEX};
use crate::utilities::seeded_random::SeededRandom;
use crate::utilities::vector::Vector;

use super::craft::{CargoObject, Craft, InstalledModule};
use super::item::Item;
use super::ship::{Ship, update_ship_mass};

use super::wreckage::{WreckageLaunch, WreckagePart};

#[derive(Debug)]
pub enum CraftSpawn {
    Wreckage(Box<Craft>),
    Item(Box<Item>),
    Module {
        object: Box<GameObject>,
        module: InstalledModule,
    },
}

#[derive(Debug)]
pub struct CraftDeath {
    pub position: Vector,
    pub color: String,
}

#[derive(Debug, Default)]
pub struct CraftDamage {
    pub changed: bool,
    pub destroyed: Option<CraftDeath>,
    pub spawns: Vec<CraftSpawn>,
}

impl Ship {
    pub fn resolve_damage(
        &mut self,
        catalog: &Catalog,
        random: &mut SeededRandom,
        next_entity_id: impl FnMut() -> i64,
    ) -> CraftDamage {
        let damage = self.craft.resolve_damage(catalog, random, next_entity_id);
        if damage.changed {
            self.update_mass();
        }
        damage
    }
}

impl Craft {
    pub fn resolve_damage(
        &mut self,
        catalog: &Catalog,
        random: &mut SeededRandom,
        mut next_entity_id: impl FnMut() -> i64,
    ) -> CraftDamage {
        let mut effects = CraftDamage::default();
        if self.cockpit.is_none()
            && self.object.player_number.is_none()
            && self.object.kind != "ship"
        {
            return effects;
        }

        let missing_essential = self
            .hulls
            .iter()
            .any(|hull| hull.plan.essential && (!hull.present || hull.health < 1.0));
        let core_count = self
            .hulls
            .iter()
            .filter(|hull| {
                hull.present && (hull.health >= 1.0 || hull.health.is_nan()) && hull.plan.core
            })
            .count();
        let broken_hull = self
            .hulls
            .iter()
            .any(|hull| hull.present && hull.health < 1.0);
        let broken_mount = self.mounts.iter().any(|mount| {
            self.hulls[mount.hull].present && mount.module.is_some() && mount.health < 1.0
        });

        if !broken_mount && core_count > 0 && !broken_hull && !missing_essential {
            return effects;
        }
        effects.changed = true;
        self.invalidate_collision_geometry();

        for index in 0..self.mounts.len() {
            let mount = &self.mounts[index];
            if self.hulls[mount.hull].present && mount.module.is_some() && mount.health < 1.0 {
                let wreckage =
                    self.detach_broken_module(index, catalog, random, &mut next_entity_id);
                if let Some(wreckage) = wreckage {
                    effects
                        .spawns
                        .push(CraftSpawn::Wreckage(Box::new(wreckage)));
                }
            }
        }

        let lost = core_count == 0 || missing_essential;
        if !lost
            && self.cockpit.is_none_or(|index| {
                let hull = &self.hulls[index];
                !hull.present || hull.health < 1.0
            })
        {
            self.cockpit = self.hulls.iter().position(|hull| {
                hull.present && hull.plan.core && (hull.health >= 1.0 || hull.health.is_nan())
            });
        }

        if !lost && !broken_hull {
            return effects;
        }

        let mut order: Vec<_> = (0..self.hulls.len())
            .filter(|&index| self.hulls[index].present)
            .collect();
        order.sort_by_key(|&index| self.hulls[index].plan.z_index.unwrap_or(HULL_Z_INDEX));
        let (broken, hulls): (Vec<_>, Vec<_>) = order
            .into_iter()
            .partition(|&index| self.hulls[index].health < 1.0);
        let broken_center = self.center_of_hulls(&broken);
        if !self.suppress_drops {
            for index in broken {
                let origin = self.center_of_hulls(&[index]);
                let part = self.hull_wreckage_part(index, origin, true);
                effects
                    .spawns
                    .push(CraftSpawn::Wreckage(Box::new(self.spawn_wreckage(
                        WreckageLaunch {
                            id: next_entity_id(),
                            origin,
                            away: origin - broken_center,
                            parts: vec![part],
                            shades: None,
                        },
                        catalog,
                        random,
                    ))));
            }
        }

        let groups = if lost {
            hulls.iter().map(|&index| vec![index]).collect()
        } else {
            self.connected_hull_groups(&hulls)
        };
        let kept = if lost {
            None
        } else {
            self.cockpit
                .and_then(|core| groups.iter().position(|group| group.contains(&core)))
        };
        let center = self.center_of_hulls(&hulls);
        let mut fragment_count = 0;
        if !self.suppress_drops {
            for (index, group) in groups.iter().enumerate() {
                if kept == Some(index) {
                    continue;
                }
                let origin = self.center_of_hulls(group);
                let parts = group
                    .iter()
                    .map(|&index| self.hull_wreckage_part(index, origin, false))
                    .collect();
                effects
                    .spawns
                    .push(CraftSpawn::Wreckage(Box::new(self.spawn_wreckage(
                        WreckageLaunch {
                            id: next_entity_id(),
                            origin,
                            away: origin - center,
                            parts,
                            shades: None,
                        },
                        catalog,
                        random,
                    ))));
                fragment_count += 1;
            }
        }

        if let Some(kept) = kept {
            let kept = &groups[kept];
            if fragment_count > 0 {
                let direction =
                    rotate_point(self.center_of_hulls(kept) - center, self.object.rotation);
                let mass = self.object.force_mass();
                apply_force(
                    &mut self.object.velocity,
                    &mut self.object.spin,
                    mass,
                    direction.normalized() * 30.0,
                    random.next_float() - 0.5,
                );
            }
            for (index, hull) in self.hulls.iter_mut().enumerate() {
                hull.present = kept.contains(&index);
            }
            for mount in &mut self.mounts {
                if !self.hulls[mount.hull].present {
                    mount.module = None;
                    mount.health = 0.0;
                    mount.health_activated = None;
                }
            }
        } else {
            for hull in &mut self.hulls {
                hull.present = false;
            }
            self.cockpit = None;
            self.object.dead = true;
            let cargo = std::mem::take(&mut self.cargo_contents);
            if !self.suppress_drops {
                for object in cargo {
                    let spawn = self.drop_object(object, catalog, random, &mut next_entity_id);
                    effects.spawns.push(spawn);
                }
            }
            effects.destroyed = Some(CraftDeath {
                position: self.object.position,
                color: self
                    .object
                    .shades
                    .as_ref()
                    .and_then(|shades| shades.get(2))
                    .or_else(|| catalog.colors.get("white")?.get(2))
                    .cloned()
                    .unwrap_or_default(),
            });
        }
        effects
    }

    fn center_of_hulls(&self, hulls: &[usize]) -> Vector {
        if hulls.is_empty() {
            return Vector::ZERO;
        }
        let mut center = Vector::ZERO;
        for &index in hulls {
            let hull = &self.hulls[index];
            center += hull.position + hull.collider_plan.middle;
        }
        center * (1.0 / hulls.len() as f64)
    }

    fn hull_wreckage_part(&self, index: usize, origin: Vector, broken: bool) -> WreckagePart {
        let hull = &self.hulls[index];
        WreckagePart {
            color: String::new(),
            outline: Some(hull.plan.points.clone()),
            radius: hull.collider_plan.radius,
            offset: hull.position - origin,
            health: if broken { 1.0 } else { hull.health },
            fill_shade: None,
            unstroked: false,
        }
    }

    fn connected_hull_groups(&self, hulls: &[usize]) -> Vec<Vec<usize>> {
        let mut outlines: Vec<_> = hulls
            .iter()
            .map(|&index| ShapeOutline {
                points: self.hulls[index].plan.points.clone(),
                edges: None,
            })
            .collect();
        let mut references: Vec<_> = outlines.iter_mut().collect();
        let groups = outer_edges(&mut references);
        if !self
            .hulls
            .iter()
            .any(|hull| hull.plan.connections.is_some())
        {
            return groups
                .into_iter()
                .map(|group| group.into_iter().map(|index| hulls[index]).collect())
                .collect();
        }

        let mut neighbors = vec![vec![false; hulls.len()]; hulls.len()];
        for group in groups {
            for &index in &group {
                for &other in &group {
                    neighbors[index][other] = true;
                }
            }
        }
        for (index, &hull) in hulls.iter().enumerate() {
            if let Some(connections) = &self.hulls[hull].plan.connections {
                for connection in connections {
                    if let Some(other) = hulls.iter().position(|hull| hull == connection) {
                        neighbors[index][other] = true;
                        neighbors[other][index] = true;
                    }
                }
            }
        }

        let mut unvisited = vec![true; hulls.len()];
        let mut groups = Vec::new();
        for index in (0..hulls.len()).rev() {
            if !unvisited[index] {
                continue;
            }
            unvisited[index] = false;
            let mut group = vec![index];
            let mut at = 0;
            while at < group.len() {
                for other in (0..hulls.len()).rev() {
                    if unvisited[other] && neighbors[group[at]][other] {
                        unvisited[other] = false;
                        group.push(other);
                    }
                }
                at += 1;
            }
            groups.push(group.into_iter().map(|index| hulls[index]).collect());
        }
        groups
    }

    fn detach_broken_module(
        &mut self,
        index: usize,
        catalog: &Catalog,
        random: &mut SeededRandom,
        next_id: &mut impl FnMut() -> i64,
    ) -> Option<Craft> {
        let mount = &self.mounts[index];
        let module = mount.module.as_ref()?;
        let spec = &module.spec;
        let mut origin = mount.position;
        let special = spec.behavior == "cargoHatch" || spec.behavior == "searchLight";
        let eligible = spec
            .model
            .iter()
            .filter(|part| {
                part.wreckage != Some(false) && !(spec.behavior == "cargoHatch" && part.catches)
            })
            .count();
        let mut parts = Vec::with_capacity(eligible);
        let shades = module.shades.clone();
        let palette = spec
            .shades
            .as_ref()
            .filter(|palette| !palette.is_empty())
            .or_else(|| catalog.colors.get("violet"));
        for (model_index, model) in spec.model.iter().enumerate() {
            if model.wreckage == Some(false) || spec.behavior == "cargoHatch" && model.catches {
                continue;
            }
            let Some((mut position, mut radius, mut outline)) =
                self.module_wreckage_shape(index, model_index)
            else {
                continue;
            };
            let mut color = model.color.clone();
            let mut fill_shade = color_index(palette, &color);
            if special && !outline.is_empty() {
                let ([x, y], extent) = shape_outline_extent(&outline);
                for point in &mut outline {
                    point[0] -= x;
                    point[1] -= y;
                }
                radius = extent;
                if eligible == 1 {
                    origin = position + Vector::new(x, y);
                    position = origin;
                }
                if fill_shade.is_none() && color.is_empty() {
                    let maximum = if spec.health == 0.0 {
                        spec.health_activated.unwrap_or(spec.health)
                    } else {
                        spec.health
                    };
                    fill_shade = Some(if mount.health < maximum / 2.0 {
                        0.0
                    } else {
                        1.0
                    });
                }
            } else if !model.wreckage_color.is_empty() {
                color.clone_from(&model.wreckage_color);
                fill_shade = color_index(catalog.colors.get("white"), &color);
            }
            if fill_shade.is_some() {
                color.clear();
            }
            parts.push(WreckagePart {
                color,
                outline: (!outline.is_empty()).then_some(outline),
                radius,
                offset: position,
                health: 1.0,
                fill_shade,
                unstroked: model.outline == Some(false),
            });
        }

        self.fit(index, None);
        if self.object.kind == "ship" {
            let definition = if self.object.definition_id.is_empty() {
                "mustang"
            } else {
                &self.object.definition_id
            };
            if let Some(ship) = catalog.ship_specs.get(definition) {
                update_ship_mass(self, ship.hull_mass, ship.drag);
            }
        }
        if self.suppress_drops || parts.is_empty() {
            return None;
        }
        for part in &mut parts {
            part.offset -= origin;
        }
        Some(self.spawn_wreckage(
            WreckageLaunch {
                id: next_id(),
                origin,
                away: origin,
                parts,
                shades,
            },
            catalog,
            random,
        ))
    }

    fn drop_object(
        &self,
        cargo: CargoObject,
        catalog: &Catalog,
        random: &mut SeededRandom,
        next_id: &mut impl FnMut() -> i64,
    ) -> CraftSpawn {
        let force = move_point(Vector::ZERO, random.next_float() * PI * 2.0, 30.0);
        let spin = random.next_float() - 0.5;
        let mut release = |object: &mut GameObject| {
            if object.id < 0 {
                object.id = next_id();
            }
            object.position = self.object.position;
            object.velocity = self.object.velocity;
            object.dead = false;
            let mass = object.force_mass();
            apply_force(&mut object.velocity, &mut object.spin, mass, force, spin);
        };
        match cargo {
            CargoObject::Item(mut item) => {
                release(&mut item.object);
                CraftSpawn::Item(item)
            }
            CargoObject::Module(mut module) => {
                let spec = &module.spec;
                let mut object = GameObject::new(
                    module.id,
                    ObjectProperties {
                        name: Some(spec.name.clone()),
                        health: Some(spec.health),
                        bounciness: spec.bounciness,
                        friction: spec.friction,
                        ..ObjectProperties::default()
                    },
                    &catalog.simulation,
                );
                object.price = spec.price;
                object.shades.clone_from(&module.shades);
                release(&mut object);
                module.id = object.id;
                CraftSpawn::Module {
                    object: Box::new(object),
                    module,
                }
            }
        }
    }
}

fn color_index(palette: Option<&Vec<String>>, color: &str) -> Option<f64> {
    palette?
        .iter()
        .position(|shade| shade == color)
        .map(|index| index as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::specs::{WRECKAGE_DECAY, WRECKAGE_HEALTH};

    #[test]
    fn core_loss_spawns_ordered_hull_fragments_and_releases_inventory()
    -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let mut next_module = 0;
        let mut ship =
            Ship::new_player(1, "mustang", ObjectProperties::default(), &catalog, || {
                next_module -= 1;
                next_module
            })
            .expect("stock ship");
        let core = ship.craft.cockpit.expect("ship has cockpit");
        ship.craft.hulls[core].health = 0.0;
        let cargo =
            Item::new(-50, "diamond", ObjectProperties::default(), &catalog).expect("stock item");
        ship.craft
            .cargo_contents
            .push(CargoObject::Item(Box::new(cargo)));

        let mut random = SeededRandom::new(25.0);
        let mut next_id = 100;
        let effects = ship.resolve_damage(&catalog, &mut random, || {
            let id = next_id;
            next_id += 1;
            id
        });
        assert!(effects.changed);
        assert!(effects.destroyed.is_some());
        assert!(ship.craft.object.dead);
        assert!(ship.craft.hulls.iter().all(|hull| !hull.present));
        assert!(ship.craft.cargo_contents.is_empty());
        assert_eq!(effects.spawns.len(), ship.craft.hulls.len() + 1);
        for (index, spawn) in effects.spawns[..effects.spawns.len() - 1]
            .iter()
            .enumerate()
        {
            let CraftSpawn::Wreckage(fragment) = spawn else {
                panic!("hull fragments first");
            };
            assert_eq!(fragment.object.id, 100 + index as i64);
            assert_eq!(fragment.object.decay, WRECKAGE_DECAY);
            assert!(fragment.object.health >= WRECKAGE_HEALTH);
        }
        let Some(CraftSpawn::Item(cargo)) = effects.spawns.last() else {
            panic!("loose cargo last");
        };
        assert_eq!(cargo.object.id, next_id - 1);
        assert_eq!(cargo.object.position, ship.craft.object.position);
        assert!(cargo.object.velocity.length() > 0.0);
        Ok(())
    }
}
