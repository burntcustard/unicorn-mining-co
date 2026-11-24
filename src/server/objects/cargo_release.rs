use crate::simulation::geometry::{direction_of, rotate_point};
use crate::specs::Catalog;

use super::craft::CargoObject;
use super::item::Item;
use super::ship::Ship;

impl Ship {
    pub fn releasing_cargo(&self) -> bool {
        self.releasing_cargo
    }

    pub fn cancel_cargo_release(&mut self) {
        self.cargo_release_held = false;
        self.releasing_cargo = false;
        self.cargo_release_time = 0.0;
    }

    fn releasable_item_index(&self, catalog: &Catalog) -> Option<usize> {
        self.craft.cargo_contents.iter().position(|object| {
            let CargoObject::Item(item) = object else {
                return false;
            };
            let Some(rounds) = item.rounds else {
                return true;
            };
            item.object
                .resource
                .and_then(|resource| usize::try_from(resource).ok())
                .and_then(|resource| catalog.item_ids.get(resource))
                .and_then(|definition| catalog.item_specs.get(definition))
                .is_some_and(|spec| rounds == spec.rounds)
        })
    }

    pub fn releasable_item(&self, catalog: &Catalog) -> Option<&Item> {
        let index = self.releasable_item_index(catalog)?;
        match &self.craft.cargo_contents[index] {
            CargoObject::Item(item) => Some(item.as_ref()),
            CargoObject::Module(_) => None,
        }
    }

    pub fn mined_cargo_value(&self) -> f64 {
        self.craft
            .cargo_contents
            .iter()
            .filter_map(|object| match object {
                CargoObject::Item(item)
                    if item.object.mined && item.rounds.is_none() && item.object.price > 0.0 =>
                {
                    Some(item.object.price)
                }
                _ => None,
            })
            .sum()
    }

    pub fn cargo_release(&mut self, catalog: &Catalog) {
        if self.craft.object.dead
            || self.craft.docked_to.is_some()
            || self.craft.transit_time != 0.0
            || self.releasing_cargo
        {
            return;
        }
        self.craft.set_module_active("cargoHatch", true);
        if self.craft.module_active("cargoHatch") && self.releasable_item_index(catalog).is_some() {
            self.releasing_cargo = true;
            self.cargo_release_time = 0.0;
        }
    }

    pub fn update_cargo_release(
        &mut self,
        duration: f64,
        tick: u64,
        catalog: &Catalog,
        mut next_entity_id: impl FnMut() -> i64,
    ) -> Option<Item> {
        if self.craft.object.dead
            || self.craft.docked_to.is_some()
            || self.craft.transit_time != 0.0
        {
            self.cancel_cargo_release();
            return None;
        }

        if !self.releasing_cargo {
            if !self.cargo_release_held {
                return None;
            }
            self.cargo_release(catalog);
            if !self.releasing_cargo {
                return None;
            }
        }
        self.cargo_release_time -= duration;
        if self.cargo_release_time > 1e-9 {
            return None;
        }

        let Some(item) = self.releasable_item_index(catalog) else {
            self.releasing_cargo = false;
            return None;
        };
        let mut hatches = smallvec::SmallVec::<[_; 4]>::new();
        for mount in &self.craft.mounts {
            if !self.craft.hulls[mount.hull].present || mount.health < 1.0 {
                continue;
            }
            let Some(module) = &mount.module else {
                continue;
            };
            if module.spec.behavior != "cargoHatch" {
                continue;
            }
            for (index, (part, model)) in module.parts.iter().zip(&module.spec.model).enumerate() {
                if model.catches && part.active != 0.0 && part.activation_progress >= 1.0 {
                    hatches.push((
                        module.spec.z_index.unwrap_or(crate::specs::HULL_Z_INDEX),
                        module.fitted_order,
                        index,
                        part.position,
                    ));
                }
            }
        }
        if hatches.is_empty() {
            return None;
        }

        hatches.sort_unstable_by_key(|&(z, order, index, _)| (z, order, index));
        let mount_position = hatches[self.cargo_release_hatch % hatches.len()].3;
        self.cargo_release_hatch = self.cargo_release_hatch.wrapping_add(1);
        let CargoObject::Item(mut item) = self.craft.cargo_contents.remove(item) else {
            return None;
        };
        let ship = &self.craft.object;
        let object = &mut item.object;
        if object.id < 0 {
            object.id = next_entity_id();
        }
        let direction = direction_of(ship.rotation);
        let position = ship.position + rotate_point(mount_position, ship.rotation);
        object.position = position.add_scaled(direction, object.radius + 2.0);
        object.velocity = ship.velocity.add_scaled(direction, 35.0);
        object.dropped_by = ship.player_number;
        object.pickup_after = tick.wrapping_add((3.0 / catalog.simulation.simulation_step) as u64);
        object.dead = false;
        self.cargo_release_time = 0.5;
        Some(*item)
    }
}

#[cfg(test)]
mod tests {
    use crate::protocol::{Input, SimulationEvent};
    use crate::simulation::game_object::ObjectProperties;
    use crate::utilities::vector::Vector;

    use super::*;

    #[test]
    fn release_skips_open_ammunition_and_alternates_throats()
    -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let mut next_module = 0;
        let mut ship = Ship::new_player(
            1,
            "mustang",
            ObjectProperties {
                player_number: Some(9),
                velocity: Vector::new(2.0, -1.0),
                ..ObjectProperties::default()
            },
            &catalog,
            || {
                next_module -= 1;
                next_module
            },
        )
        .expect("stock ship");
        let mut ammo =
            Item::new(4, "autogunAmmo", ObjectProperties::default(), &catalog).expect("stock ammo");
        ammo.rounds = Some(1);
        ship.craft
            .cargo_contents
            .push(CargoObject::Item(Box::new(ammo)));
        for (id, name) in [(-50, "gold"), (8, "diamond")] {
            let item =
                Item::new(id, name, ObjectProperties::default(), &catalog).expect("stock item");
            ship.craft
                .cargo_contents
                .push(CargoObject::Item(Box::new(item)));
        }

        let mut events = Vec::new();
        ship.control(
            Input {
                cargo_release: true,
                ..Input::default()
            },
            None,
            &mut events,
        );
        assert_eq!(
            events,
            [SimulationEvent::ModuleChanged {
                module: "cargoHatch".into(),
                player_number: 9,
                active: true
            }]
        );
        assert!(
            ship.update_cargo_release(0.01, 40, &catalog, || 100)
                .is_none()
        );
        ship.craft.update_modules(5.0, 1.0, Some(40));
        let first = ship
            .update_cargo_release(0.01, 40, &catalog, || 100)
            .expect("first hatch release");
        assert_eq!(first.object.id, 100);
        assert_eq!(first.object.velocity, Vector::new(37.0, -1.0));
        assert_eq!(first.object.dropped_by, Some(9));
        assert_eq!(first.object.pickup_after, 130);

        assert!(
            ship.update_cargo_release(0.49, 41, &catalog, || 100)
                .is_none()
        );
        let second = ship
            .update_cargo_release(0.01, 42, &catalog, || 100)
            .expect("second hatch release");
        assert_eq!(second.object.id, 8);
        assert_ne!(first.object.position.y, second.object.position.y);
        assert_eq!(
            ship.craft
                .cargo_contents
                .iter()
                .map(CargoObject::id)
                .collect::<Vec<_>>(),
            [4]
        );
        Ok(())
    }
}
