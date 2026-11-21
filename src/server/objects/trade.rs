//! Docked trade, repair, outfitting, and ship valuation.

use std::collections::HashSet;
use std::sync::Arc;

use crate::protocol::DockAction;
use crate::specs::Catalog;

use super::craft::{CargoObject, InstalledModule};
use super::ship::Ship;
use super::station::Station;

impl CargoObject {
    fn price(&self) -> f64 {
        match self {
            Self::Item(item) => item.object.price,
            Self::Module(module) => module.spec.price,
        }
    }
}

impl Ship {
    pub fn apply_dock_action(
        &mut self,
        action: &DockAction,
        credits: &mut f64,
        station: Option<&mut Station>,
        catalog: &Catalog,
        mut next_entity_id: impl FnMut() -> i64,
    ) -> bool {
        match action {
            DockAction::Refuel => {
                let cost = self.refuel_cost();
                if station.is_none() || !spend(credits, cost) {
                    return false;
                }
                self.fuel = self.fuel_capacity;
                true
            }
            DockAction::BuyAmmo => {
                let Some(station) = station else { return false };
                let Some(ammo) = catalog.item_specs.get("autogunAmmo") else {
                    return false;
                };
                let Some(item) = station.craft.cargo_contents.iter().find_map(|object| {
                    if let CargoObject::Item(item) = object
                        && item.object.resource == Some(ammo.resource)
                    {
                        Some(item.object.id)
                    } else {
                        None
                    }
                }) else {
                    return false;
                };
                self.buy_stock(station, &[item], credits, catalog)
            }
            DockAction::BuyStock { object_ids } => {
                station.is_some_and(|station| self.buy_stock(station, object_ids, credits, catalog))
            }
            DockAction::Sell { object_ids } => {
                let mut seen = HashSet::new();
                if object_ids.is_empty()
                    || !object_ids
                        .iter()
                        .all(|&id| seen.insert(id) && self.inventory_has(id))
                {
                    return false;
                }
                let mut sold = Vec::with_capacity(object_ids.len());
                for &id in object_ids {
                    if let Some(object) = self.take_inventory(id) {
                        sold.push(object);
                    }
                }
                let mut sum = 0.0;
                for object in &sold {
                    let value = object.price();
                    if !value.is_nan() {
                        sum += value;
                    }
                }
                if let Some(station) = station {
                    for mut object in sold {
                        if let CargoObject::Module(module) = &mut object {
                            if !catalog.station_module_ids.contains(&module.definition_id) {
                                continue;
                            }
                            module.id = next_entity_id();
                            station.record_module_sale(module.id, self.craft.object.id);
                        }
                        station.craft.cargo_contents.push(object);
                    }
                }
                *credits += sum;
                true
            }
            DockAction::Buy {
                module,
                module_id,
                mount,
            } => {
                let Some(id) = usize::try_from(*module)
                    .ok()
                    .and_then(|index| catalog.module_ids.get(index))
                else {
                    return false;
                };
                let Some(spec) = catalog.module_specs.get(id) else {
                    return false;
                };
                if !catalog.station_module_ids.contains(id)
                    || *credits < spec.price
                    || self.inventory_has(*module_id)
                {
                    return false;
                }

                let target = match mount {
                    Some(mount) => {
                        let Some(index) = self.mount_index(*mount) else {
                            return false;
                        };
                        let mount = &self.craft.mounts[index];
                        if mount.module.is_some() || !mount.accepts(id) {
                            return false;
                        }
                        Some(index)
                    }
                    None if self.craft.cargo_contents.len() < self.cargo_space => None,
                    None => return false,
                };

                let module = InstalledModule::new(*module_id, id.clone(), Arc::clone(spec));
                *credits -= spec.price;
                if let Some(mount) = target {
                    self.fit(mount, Some(module));
                } else {
                    self.craft.cargo_contents.push(CargoObject::Module(module));
                }
                true
            }
            DockAction::Equip { module_id, mount } => {
                let Some(mount) = self.mount_index(*mount) else {
                    return false;
                };
                let Some(module) = self.inventory_module(*module_id) else {
                    return false;
                };
                if !self.craft.mounts[mount].accepts(&module.definition_id) {
                    return false;
                }
                if self.craft.mounts[mount]
                    .module
                    .as_ref()
                    .is_some_and(|module| module.id == *module_id)
                {
                    return true;
                }

                let Some(CargoObject::Module(module)) = self.take_inventory(*module_id) else {
                    return false;
                };
                if let Some(old) = self.fit(mount, Some(module)) {
                    self.craft.cargo_contents.push(CargoObject::Module(old));
                }
                true
            }
            DockAction::Remove { mount } => {
                let Some(mount) = self.mount_index(*mount) else {
                    return false;
                };
                if let Some(removed) = self.fit(mount, None) {
                    self.craft.cargo_contents.push(CargoObject::Module(removed));
                }
                true
            }
            DockAction::RepairHull { hull_index } => {
                let Some(index) = usize::try_from(*hull_index).ok() else {
                    return false;
                };
                let Some(hull) = self.craft.hulls.get_mut(index) else {
                    return false;
                };
                let Some(maximum) = hull.plan.health else {
                    return false;
                };
                let current = if hull.present && !hull.health.is_nan() {
                    hull.health
                } else {
                    0.0
                };
                if !spend(credits, maximum - current.floor()) {
                    return false;
                }
                hull.health = maximum;
                hull.present = true;
                self.restore_hull_placement();
                true
            }
            DockAction::Repair {
                module_id,
                mount: None,
            } => {
                if module_id.is_some() || !spend(credits, self.repair_cost(None)) {
                    return false;
                }
                for hull in &mut self.craft.hulls {
                    hull.health = hull.plan.health.unwrap_or(f64::NAN);
                    hull.present = true;
                }
                self.restore_hull_placement();
                true
            }
            DockAction::Repair {
                module_id,
                mount: Some(mount),
            } => {
                let Some(mount) = self.mount_index(*mount) else {
                    return false;
                };
                let Some(module) = &self.craft.mounts[mount].module else {
                    return false;
                };
                if Some(module.id) != *module_id || !spend(credits, self.repair_cost(Some(mount))) {
                    return false;
                }
                let (maximum, activated) = (module.spec.health, module.spec.health_activated);
                let mount = &mut self.craft.mounts[mount];
                mount.health = maximum;
                if maximum == 0.0
                    && let Some(activated) = activated
                {
                    mount.health = activated;
                    mount.health_activated = Some(activated);
                }
                self.craft.invalidate_collision_geometry();
                true
            }
            DockAction::Paint {
                paint,
                module_id,
                mount,
            } => {
                let Some(index) = usize::try_from(*paint).ok() else {
                    return false;
                };
                let Some(shades) = catalog.paint_colors.get(index) else {
                    return false;
                };
                if let Some(mount) = mount {
                    let Some(mount) = self.mount_index(*mount) else {
                        return false;
                    };
                    let Some(module) = &mut self.craft.mounts[mount].module else {
                        return false;
                    };
                    if Some(module.id) != *module_id {
                        return false;
                    }
                    module.shades = Some(shades.clone());
                } else if let Some(id) = module_id {
                    let Some(module) = self.inventory_module_mut(*id) else {
                        return false;
                    };
                    module.shades = Some(shades.clone());
                } else {
                    self.craft.object.shades = Some(shades.clone());
                    for hull in &mut self.craft.hulls {
                        hull.plan.shades = Some(shades.clone());
                    }
                }
                true
            }
        }
    }

    fn buy_stock(
        &mut self,
        station: &mut Station,
        ids: &[i64],
        credits: &mut f64,
        catalog: &Catalog,
    ) -> bool {
        if ids.is_empty() || self.craft.cargo_contents.len() + ids.len() > self.cargo_space {
            return false;
        }
        let mut cost = 0.0;
        let mut seen = HashSet::new();
        for &id in ids {
            if !seen.insert(id) {
                return false;
            }
            let Some(object) = station
                .craft
                .cargo_contents
                .iter()
                .find(|object| object.id() == id)
            else {
                return false;
            };
            if let CargoObject::Module(module) = object
                && !catalog.station_module_ids.contains(&module.definition_id)
            {
                return false;
            }
            cost += object.price();
        }
        if cost.is_nan() || *credits < cost {
            return false;
        }

        for id in ids {
            let index = station
                .craft
                .cargo_contents
                .iter()
                .position(|object| object.id() == *id)
                .expect("all selected stock was validated");
            let mut object = station.craft.cargo_contents.remove(index);
            station.remove_seller(*id);
            if let CargoObject::Item(item) = &mut object {
                item.object.mined = false;
            }
            self.craft.cargo_contents.push(object);
        }
        *credits -= cost;
        true
    }

    pub fn repair_cost(&self, mount: Option<usize>) -> f64 {
        if let Some(index) = mount {
            let mount = &self.craft.mounts[index];
            let Some(module) = &mount.module else {
                return 0.0;
            };
            let spec = &module.spec;
            let maximum = if spec.health == 0.0 {
                spec.health_activated.unwrap_or(spec.health)
            } else {
                spec.health
            };
            return maximum - integer32(mount.health);
        }
        let maximum = self
            .craft
            .hulls
            .iter()
            .filter_map(|hull| hull.plan.health)
            .sum::<f64>();
        let current = self
            .craft
            .hulls
            .iter()
            .filter(|hull| hull.present)
            .map(|hull| hull.health)
            .sum::<f64>();
        maximum - integer32(current)
    }

    pub fn sale_price(&self, catalog: &Catalog) -> f64 {
        let id = if self.craft.object.definition_id.is_empty() {
            "mustang"
        } else {
            &self.craft.object.definition_id
        };
        let mut price = catalog
            .ship_specs
            .get(id)
            .map_or(0.0, |definition| definition.price);
        for mount in self
            .craft
            .mounts
            .iter()
            .filter(|mount| self.craft.hulls[mount.hull].present)
        {
            if let Some(module) = &mount.module {
                price += module.spec.price;
            }
        }
        for object in &self.craft.cargo_contents {
            let value = object.price();
            if !value.is_nan() {
                price += value;
            }
        }
        price -= self.repair_cost(None) + self.refuel_cost();
        for (index, mount) in self.craft.mounts.iter().enumerate() {
            if self.craft.hulls[mount.hull].present {
                price -= self.repair_cost(Some(index));
            }
        }
        price
    }

    fn restore_hull_placement(&mut self) {
        self.craft.invalidate_collision_geometry();
        self.craft.cockpit = self
            .craft
            .hulls
            .iter()
            .position(|hull| hull.present && hull.plan.core);
        self.craft.update_flight_mode();
        self.update_mass();
    }

    /// Wire mount indices skip hulls already removed from the live craft.
    fn mount_index(&self, index: i64) -> Option<usize> {
        let index = usize::try_from(index).ok()?;
        self.craft
            .mounts
            .iter()
            .enumerate()
            .filter(|(_, mount)| self.craft.hulls[mount.hull].present)
            .nth(index)
            .map(|(index, _)| index)
    }

    fn inventory_has(&self, id: i64) -> bool {
        self.inventory_module(id).is_some()
            || self
                .craft
                .cargo_contents
                .iter()
                .any(|object| object.id() == id)
    }

    fn inventory_module(&self, id: i64) -> Option<&InstalledModule> {
        self.craft
            .mounts
            .iter()
            .filter(|mount| self.craft.hulls[mount.hull].present)
            .filter_map(|mount| mount.module.as_ref())
            .find(|module| module.id == id)
            .or_else(|| {
                self.craft.cargo_contents.iter().find_map(|object| {
                    if let CargoObject::Module(module) = object
                        && module.id == id
                    {
                        Some(module)
                    } else {
                        None
                    }
                })
            })
    }

    fn inventory_module_mut(&mut self, id: i64) -> Option<&mut InstalledModule> {
        self.craft
            .mounts
            .iter_mut()
            .filter(|mount| self.craft.hulls[mount.hull].present)
            .filter_map(|mount| mount.module.as_mut())
            .find(|module| module.id == id)
            .or_else(|| {
                self.craft.cargo_contents.iter_mut().find_map(|object| {
                    if let CargoObject::Module(module) = object
                        && module.id == id
                    {
                        Some(module)
                    } else {
                        None
                    }
                })
            })
    }

    fn take_inventory(&mut self, id: i64) -> Option<CargoObject> {
        if let Some(index) = self
            .craft
            .cargo_contents
            .iter()
            .position(|object| object.id() == id)
        {
            return Some(self.craft.cargo_contents.remove(index));
        }
        let index = self.craft.mounts.iter().position(|mount| {
            self.craft.hulls[mount.hull].present
                && mount.module.as_ref().is_some_and(|module| module.id == id)
        })?;
        self.fit(index, None).map(CargoObject::Module)
    }
}

fn spend(credits: &mut f64, cost: f64) -> bool {
    if cost > 0.0 && *credits >= cost {
        *credits -= cost;
        true
    } else {
        false
    }
}

fn integer32(value: f64) -> f64 {
    if value.is_finite() {
        f64::from((value.trunc() % 4294967296.0) as i64 as i32)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use crate::simulation::game_object::ObjectProperties;

    use super::*;

    #[test]
    fn trade_stock_and_module_buyback_keep_atomic_inventory_order()
    -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let mut next_module = 0;
        let mut ship =
            Ship::new_player(1, "mustang", ObjectProperties::default(), &catalog, || {
                next_module -= 1;
                next_module
            })
            .expect("stock ship");
        let mut next_stock = 51;
        let mut station = Station::new(
            50,
            "corral-5",
            ObjectProperties::default(),
            None,
            &catalog,
            || {
                let next = next_stock;
                next_stock += 1;
                next
            },
        )
        .expect("stock station");
        ship.craft.docked_to = Some(50);
        let mut credits = 10000.0;
        let original_count = station.craft.cargo_contents.len();
        assert!(!ship.apply_dock_action(
            &DockAction::BuyStock {
                object_ids: vec![51, 51]
            },
            &mut credits,
            Some(&mut station),
            &catalog,
            || next_stock
        ));
        assert!(ship.craft.cargo_contents.is_empty());
        assert_eq!(station.craft.cargo_contents.len(), original_count);
        assert_eq!(credits, 10000.0);

        assert!(ship.apply_dock_action(
            &DockAction::BuyStock {
                object_ids: vec![53, 51]
            },
            &mut credits,
            Some(&mut station),
            &catalog,
            || next_stock
        ));
        assert_eq!(
            ship.craft
                .cargo_contents
                .iter()
                .map(CargoObject::id)
                .collect::<Vec<_>>(),
            [53, 51]
        );
        assert_eq!(station.craft.cargo_contents[0].id(), 52);
        let module = ship.engine().expect("stock engine").id;
        let inventory_id = next_stock;
        assert!(ship.apply_dock_action(
            &DockAction::Sell {
                object_ids: vec![module]
            },
            &mut credits,
            Some(&mut station),
            &catalog,
            || inventory_id
        ));
        assert!(ship.engine().is_none());
        assert_eq!(
            station
                .craft
                .cargo_contents
                .last()
                .expect("engine listed")
                .id(),
            inventory_id
        );
        station.end_trade_visit(ship.craft.object.id);
        assert!(
            station
                .craft
                .cargo_contents
                .iter()
                .all(|object| object.id() != inventory_id)
        );

        ship.fuel = ship.fuel_capacity - 2.0;
        let swap = credits;
        assert!(ship.apply_dock_action(
            &DockAction::Refuel,
            &mut credits,
            Some(&mut station),
            &catalog,
            || inventory_id
        ));
        assert_eq!(ship.fuel, ship.fuel_capacity);
        assert_eq!(credits, swap - 1.0);
        Ok(())
    }
}
