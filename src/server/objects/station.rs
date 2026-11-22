//! Docking bays, local motion, and station trade inventory.

use std::collections::HashMap;
use std::sync::Arc;

use crate::replication::snapshot_writer::EntityReplication;
use crate::replication::station_stock::StationStock;

use crate::simulation::game_object::{GameObject, ObjectProperties};
use crate::simulation::local_movement::MovementParent;
use crate::specs::{CRAFT_FRICTION, CRAFT_HEALTH, Catalog, ShipOffer};

use super::craft::{CargoObject, Craft};
use super::item::Item;

#[derive(Debug)]
pub struct Station {
    pub craft: Craft,
    pub ships_for_sale: Vec<ShipOffer>,
    pub local_movement_radius: f64,
    pub docking_bays: Vec<f64>,
    pub z_index: i32,
    module_sellers: HashMap<i64, i64>,
    pub(crate) marker_replication: Option<Box<EntityReplication>>,
    pub(crate) craft_replication: Option<Box<EntityReplication>>,
    pub(crate) stock_replication: Option<Arc<StationStock>>,
}

impl Station {
    pub fn new(
        id: i64,
        definition: &str,
        mut properties: ObjectProperties,
        cargo_contents: Option<Vec<CargoObject>>,
        catalog: &Catalog,
        mut new_item_id: impl FnMut() -> i64,
    ) -> Option<Self> {
        let definition = if definition.is_empty() {
            "corral-5"
        } else {
            definition
        };
        let spec = catalog.station_specs.get(definition)?;
        properties.mass.get_or_insert(spec.mass);
        properties.friction.get_or_insert(CRAFT_FRICTION);
        properties.health.get_or_insert(CRAFT_HEALTH);
        properties.name.get_or_insert_with(|| spec.name.clone());
        let mut object = GameObject::new(id, properties, &catalog.simulation);
        object.kind = "station".into();
        object.shades = catalog.colors.get("white").cloned();
        if definition != "corral-5" {
            object.definition_id = definition.into();
        }

        let mut plans = spec.hull_segments.clone();
        for plan in &mut plans {
            plan.z_index.get_or_insert(spec.z_index);
        }
        let mut craft = Craft::new(object, &plans);
        if let Some(cargo_contents) = cargo_contents {
            craft.cargo_contents = cargo_contents;
        } else {
            for entry in &spec.initial_cargo_contents {
                for _ in 0..entry.count {
                    let item = Item::new(
                        new_item_id(),
                        &entry.item,
                        ObjectProperties::default(),
                        catalog,
                    )?;
                    craft.cargo_contents.push(CargoObject::Item(Box::new(item)));
                }
            }
        }

        Some(Self {
            craft,
            ships_for_sale: spec.ships_for_sale.clone(),
            local_movement_radius: spec.local_movement_radius,
            docking_bays: spec.docking_bays.clone(),
            z_index: spec.z_index,
            module_sellers: HashMap::new(),
            marker_replication: None,
            craft_replication: None,
            stock_replication: None,
        })
    }

    pub fn movement_parent(&self) -> MovementParent {
        let object = &self.craft.object;
        let mut parent = MovementParent::radial(
            object.id,
            object.position,
            object.spin,
            self.local_movement_radius,
        );
        parent.dead = object.dead;
        parent
    }

    pub fn launch_bearing(&self, sample: impl FnOnce() -> f64) -> Option<f64> {
        let bays = &self.docking_bays;
        let index = if bays.len() > 1 {
            (sample() * bays.len() as f64) as usize
        } else {
            0
        };
        bays.get(index)
            .map(|bearing| self.craft.object.rotation + bearing)
    }

    pub fn record_module_sale(&mut self, module: i64, seller: i64) {
        self.module_sellers.insert(module, seller);
    }

    pub fn remove_seller(&mut self, module: i64) {
        self.module_sellers.remove(&module);
    }

    pub(crate) fn stock_changed(&mut self) {
        self.stock_replication = None;
    }

    pub fn end_trade_visit(&mut self, ship: i64) {
        let count = self.craft.cargo_contents.len();
        self.craft.cargo_contents.retain(|object| {
            let id = object.id();
            if self.module_sellers.get(&id) == Some(&ship) {
                self.module_sellers.remove(&id);
                false
            } else {
                true
            }
        });
        if self.craft.cargo_contents.len() != count {
            self.stock_changed();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::SimulationEvent;
    use crate::utilities::vector::Vector;

    use super::super::ship::Ship;

    #[test]
    fn stock_and_docking_use_station_and_ship_specs() -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let mut next = 51;
        let station = Station::new(
            50,
            "corral-6",
            ObjectProperties {
                position: Vector::new(25.0, -12.0),
                rotation: 0.7,
                ..ObjectProperties::default()
            },
            None,
            &catalog,
            || {
                let id = next;
                next += 1;
                id
            },
        )
        .expect("stock station definition");
        let first = station
            .craft
            .cargo_contents
            .first()
            .expect("stock cargo starts populated");
        let last = station
            .craft
            .cargo_contents
            .last()
            .expect("stock cargo ends populated");
        assert_eq!(first.id(), 51);
        assert_eq!(last.id(), next - 1);
        let spec = &catalog.station_specs["corral-6"];
        assert_eq!(
            station.craft.cargo_contents.len(),
            spec.initial_cargo_contents
                .iter()
                .map(|item| item.count)
                .sum::<usize>()
        );
        assert_eq!(
            station.launch_bearing(|| 0.9),
            Some(0.7 + spec.docking_bays[1])
        );

        let mut module = 0;
        let mut ship = Ship::new_player(
            1,
            "mustang",
            ObjectProperties {
                player_id: Some(1),
                velocity: Vector::new(1.0, 2.0),
                ..ObjectProperties::default()
            },
            &catalog,
            || {
                module -= 1;
                module
            },
        )
        .expect("stock ship definition");
        ship.fly(1.0, 0.0);
        let mut events = Vec::new();
        assert!(ship.dock_at(&station.craft, &mut events));
        assert_eq!(
            events,
            [SimulationEvent::Docked {
                player_id: 1,
                docked_to: 50
            }]
        );
        assert_eq!(ship.craft.object.position, station.craft.object.position);
        assert_eq!(ship.craft.object.velocity, Vector::ZERO);
        assert!(
            ship.engine()
                .expect("stock engine")
                .parts
                .iter()
                .all(|part| part.active == 0.0)
        );
        assert!(!ship.dock_at(&station.craft, &mut events));
        Ok(())
    }
}
