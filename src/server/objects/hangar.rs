//! Hangar prices and services shared by active and stored ships.

use crate::protocol::{DockAction, valid_display_name};
use crate::specs::Catalog;

use super::ship::Ship;
use super::station::Station;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShipPurchase {
    pub price: f64,
    pub replace_owned_ships: bool,
}

impl Station {
    /// Decide whether a station's regular or special offer is available.
    pub fn hangar_purchase(
        &self,
        definition: &str,
        special: bool,
        credits: f64,
        owned_ship_value: f64,
    ) -> Result<ShipPurchase, &'static str> {
        let offer = self
            .ships_for_sale
            .iter()
            .find(|offer| offer.ship == definition)
            .ok_or("This station does not sell that ship.")?;
        if special {
            if offer.ship != "mustang" {
                return Err("Special offer only available for a Mustang.");
            }
            if credits >= offer.price || credits + owned_ship_value >= offer.price {
                return Err("Special offer unavailable: your assets can cover the regular price.");
            }
            return Ok(ShipPurchase {
                price: credits,
                replace_owned_ships: true,
            });
        }
        if credits < offer.price {
            return Err("Insufficient funds.");
        }
        Ok(ShipPurchase {
            price: offer.price,
            replace_owned_ships: false,
        })
    }
}

impl Ship {
    pub fn rename_in_hangar(&mut self, name: &str) -> Result<(), &'static str> {
        let name = name.trim();
        if name.is_empty() || !valid_display_name(name) || name.chars().any(char::is_control) {
            return Err("Enter a ship name from 1 to 16 characters.");
        }
        self.craft.object.name = name.to_owned();
        Ok(())
    }

    pub fn repair_in_hangar(
        &mut self,
        credits: &mut f64,
        catalog: &Catalog,
    ) -> Result<(), &'static str> {
        let mut total = self.repair_cost(None);
        for (index, mount) in self.craft.mounts.iter().enumerate() {
            if self.craft.hulls[mount.hull].present {
                total += self.repair_cost(Some(index));
            }
        }
        if *credits < total {
            return Err("Insufficient funds.");
        }

        self.apply_dock_action(
            &DockAction::Repair {
                module_id: None,
                mount: None,
            },
            credits,
            None,
            catalog,
            || 0,
        );
        let mut wire_index = 0;
        for index in 0..self.craft.mounts.len() {
            let mount = &self.craft.mounts[index];
            if !self.craft.hulls[mount.hull].present {
                continue;
            }
            if let Some(module) = &mount.module {
                self.apply_dock_action(
                    &DockAction::Repair {
                        module_id: Some(module.id),
                        mount: Some(wire_index),
                    },
                    credits,
                    None,
                    catalog,
                    || 0,
                );
            }
            wire_index += 1;
        }
        Ok(())
    }

    pub fn refuel_in_hangar(
        &mut self,
        credits: &mut f64,
        station: &mut Station,
        catalog: &Catalog,
    ) -> Result<(), &'static str> {
        if *credits < self.refuel_cost() {
            return Err("Insufficient funds.");
        }
        self.apply_dock_action(&DockAction::Refuel, credits, Some(station), catalog, || 0);
        Ok(())
    }

    pub fn paint_in_hangar(
        &mut self,
        paint: &str,
        unlocked_paints: u16,
        credits: &mut f64,
        catalog: &Catalog,
    ) -> Result<(), &'static str> {
        let index = paint.parse::<u32>().map_err(|_| "Paint unavailable.")?;
        if index as usize >= catalog.paint_colors.len()
            || 1_u16
                .checked_shl(index)
                .is_none_or(|mask| unlocked_paints & mask == 0)
        {
            return Err("Paint unavailable.");
        }
        self.apply_dock_action(
            &DockAction::Paint {
                paint: i64::from(index),
                module_id: None,
                mount: None,
            },
            credits,
            None,
            catalog,
            || 0,
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::simulation::game_object::ObjectProperties;
    use crate::specs::ShipOffer;

    use super::*;

    #[test]
    fn mustang_special_uses_station_price_and_total_assets()
    -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let mut station = Station::new(
            1,
            "corral-5",
            ObjectProperties::default(),
            Some(Vec::new()),
            &catalog,
            || 0,
        )
        .expect("known station");
        station.ships_for_sale = vec![
            ShipOffer {
                ship: "mustang".into(),
                price: 100.0,
            },
            ShipOffer {
                ship: "moth".into(),
                price: 125.0,
            },
        ];
        assert_eq!(
            station.hangar_purchase("mustang", true, 20.0, 75.0),
            Ok(ShipPurchase {
                price: 20.0,
                replace_owned_ships: true
            })
        );
        assert_eq!(
            station.hangar_purchase("mustang", true, 20.0, 80.0),
            Err("Special offer unavailable: your assets can cover the regular price.")
        );
        assert_eq!(
            station.hangar_purchase("moth", true, 0.0, 0.0),
            Err("Special offer only available for a Mustang.")
        );
        assert_eq!(
            station.hangar_purchase("moth", false, 125.0, 0.0),
            Ok(ShipPurchase {
                price: 125.0,
                replace_owned_ships: false
            })
        );
        Ok(())
    }
}
