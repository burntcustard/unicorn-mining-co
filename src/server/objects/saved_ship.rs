use std::collections::HashSet;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::simulation::game_object::ObjectProperties;
use crate::specs::Catalog;
use crate::utilities::vector::Vector;

use super::craft::{CargoObject, InstalledModule};
use super::item::Item;
use super::ship::Ship;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SavedShip {
    pub id: i64,
    pub definition: String,
    pub name: Option<String>,
    pub position: [i64; 2],
    pub rotation: f64,
    pub paint: Option<usize>,
    pub dead: bool,
    pub docked_to: Option<i64>,
    pub transit_time: f64,
    pub transit_gate: Option<i64>,
    pub fuel: f64,
    pub stored_power: f64,
    pub hull: Vec<f64>,
    pub modules: Vec<SavedShipModule>,
    pub cargo: Vec<SavedCargo>,
    pub stored_ships: Vec<SavedShip>,
    pub no_ship: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SavedShipModule {
    pub mount: usize,
    pub id: i64,
    pub definition: String,
    pub health: Option<f64>,
    pub activated_health: Option<f64>,
    pub charge_cooldown: Option<f64>,
    pub fire_cooldown: f64,
    pub aim_rotation: f64,
    pub paint: Option<usize>,
    pub active: Vec<[f64; 2]>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum SavedCargo {
    Item {
        id: i64,
        definition: String,
        health: Option<f64>,
        mined: bool,
        rounds: Option<i32>,
        message: Option<String>,
        unlock: String,
    },
    Module {
        id: i64,
        definition: String,
        paint: Option<usize>,
        charge_cooldown: Option<f64>,
        fire_cooldown: f64,
    },
}

impl SavedShip {
    pub fn capture(ship: &Ship, catalog: &Catalog) -> Self {
        let object = &ship.craft.object;
        let definition = if object.definition_id.is_empty() {
            "mustang"
        } else {
            &object.definition_id
        };
        let name =
            (object.name != catalog.ship_specs[definition].name).then(|| object.name.clone());
        let paint = object
            .shades
            .as_deref()
            .and_then(|shades| paint_index(shades, catalog));
        let hull = ship
            .craft
            .hulls
            .iter()
            .map(|hull| {
                if hull.plan.health.is_none() {
                    -1.0
                } else if !hull.present || !hull.health.is_finite() {
                    0.0
                } else {
                    hull.health
                }
            })
            .collect();
        let mounts = ship
            .craft
            .mounts
            .iter()
            .enumerate()
            .filter(|(_, mount)| ship.craft.hulls[mount.hull].present);
        let modules = mounts
            .filter_map(|(index, mount)| {
                let module = mount.module.as_ref()?;
                let active_parts = module
                    .parts
                    .iter()
                    .rposition(|part| part.active != 0.0 || part.activation_progress != 0.0)
                    .map_or(0, |index| index + 1);
                Some(SavedShipModule {
                    mount: index,
                    id: module.id,
                    definition: module.definition_id.clone(),
                    health: mount.health.is_finite().then_some(mount.health),
                    activated_health: mount.health_activated,
                    charge_cooldown: module
                        .spec
                        .booster
                        .is_some()
                        .then_some(module.charge_cooldown),
                    fire_cooldown: module.fire_cooldown.max(0.0),
                    aim_rotation: module.aim_rotation,
                    paint: module
                        .shades
                        .as_deref()
                        .and_then(|shades| paint_index(shades, catalog)),
                    active: module.parts[..active_parts]
                        .iter()
                        .map(|part| [part.active, part.activation_progress])
                        .collect(),
                })
            })
            .collect();
        let cargo = ship
            .craft
            .cargo_contents
            .iter()
            .map(|item| match item {
                CargoObject::Item(item) => {
                    let object = &item.object;
                    let definition = object
                        .resource
                        .and_then(|resource| catalog.item_ids.get(resource as usize))
                        .unwrap_or(&object.definition_id)
                        .clone();
                    SavedCargo::Item {
                        id: object.id,
                        definition,
                        health: object.health.is_finite().then_some(object.health),
                        mined: object.mined,
                        rounds: item.rounds,
                        message: object.message.clone(),
                        unlock: object.unlock.clone(),
                    }
                }
                CargoObject::Module(module) => SavedCargo::Module {
                    id: module.id,
                    definition: module.definition_id.clone(),
                    paint: module
                        .shades
                        .as_deref()
                        .and_then(|shades| paint_index(shades, catalog)),
                    charge_cooldown: module
                        .spec
                        .booster
                        .is_some()
                        .then_some(module.charge_cooldown),
                    fire_cooldown: if module.spec.booster.is_some() {
                        module.fire_cooldown
                    } else {
                        0.0
                    },
                },
            })
            .collect();
        Self {
            id: object.id,
            definition: definition.to_owned(),
            name,
            position: [
                object.position.x.round() as i64,
                object.position.y.round() as i64,
            ],
            rotation: object.rotation,
            paint,
            dead: object.dead,
            docked_to: ship.craft.docked_to,
            transit_time: ship.craft.transit_time,
            transit_gate: ship.craft.transit_gate,
            fuel: ship.fuel,
            stored_power: ship.stored_power.clamp(0.0, ship.power_rates().capacity),
            hull,
            modules,
            cargo,
            stored_ships: Vec::new(),
            no_ship: false,
        }
    }

    pub fn restore(&self, player_number: i64, catalog: &Catalog) -> Result<Ship, String> {
        if self.id == 0 {
            return Err("invalid saved ship ID".to_owned());
        }
        let properties = ObjectProperties {
            position: Vector::new(self.position[0] as f64, self.position[1] as f64),
            rotation: self.rotation,
            player_number: Some(player_number),
            name: self.name.clone(),
            ..ObjectProperties::default()
        };
        let mut ship = Ship::new(self.id, &self.definition, properties, catalog)
            .ok_or_else(|| format!("unknown saved ship {:?}", self.definition))?;
        if self.hull.len() != ship.craft.hulls.len() {
            return Err(format!("saved hull does not match {:?}", self.definition));
        }
        if !self.fuel.is_finite() || !(0.0..=ship.fuel_capacity).contains(&self.fuel) {
            return Err("invalid saved fuel".to_owned());
        }
        if !self.stored_power.is_finite() || self.stored_power < 0.0 {
            return Err("invalid saved power storage".to_owned());
        }
        if !self.transit_time.is_finite()
            || (self.transit_time != 0.0 && self.transit_gate.is_none())
        {
            return Err("invalid saved portal transit".to_owned());
        }
        if self.paint.is_some() {
            ship.craft.object.shades = paint(self.paint, catalog)?;
        }
        let mut ids = HashSet::from([self.id]);
        let mut mounts = HashSet::new();
        for (index, (hull, &health)) in ship.craft.hulls.iter_mut().zip(&self.hull).enumerate() {
            if hull.plan.health.is_none() {
                continue;
            }
            hull.health = health;
            if health < 1.0 {
                hull.present = false;
                if ship.craft.cockpit == Some(index) {
                    ship.craft.cockpit = None;
                }
            }
        }
        for saved in &self.modules {
            if !ids.insert(saved.id) || saved.id == 0 || !mounts.insert(saved.mount) {
                return Err("duplicate saved ship module, mount, or object ID".to_owned());
            }
            let mount = ship
                .craft
                .mounts
                .get(saved.mount)
                .ok_or_else(|| format!("unknown saved mount {}", saved.mount))?;
            if !mount.accepts(&saved.definition) || !ship.craft.hulls[mount.hull].present {
                return Err(format!(
                    "saved module {:?} does not fit mount {}",
                    saved.definition, saved.mount
                ));
            }
            let mut module = make_module(
                saved.id,
                &saved.definition,
                saved.paint,
                saved.charge_cooldown,
                saved.fire_cooldown,
                catalog,
            )?;
            module.aim_rotation = module.bounded_aim_rotation(saved.aim_rotation);
            ship.fit(saved.mount, Some(module));
            let mount = &mut ship.craft.mounts[saved.mount];
            if let Some(health) = saved.health {
                mount.health = health;
            }
            if saved.activated_health.is_some() {
                mount.health_activated = saved.activated_health;
            }
            if let Some(module) = &mut mount.module {
                for (part, &[active, progress]) in module.parts.iter_mut().zip(&saved.active) {
                    part.active = active;
                    part.activation_progress = progress;
                }
            }
        }
        for saved in &self.cargo {
            let cargo = match saved {
                SavedCargo::Module {
                    id,
                    definition,
                    paint,
                    charge_cooldown,
                    fire_cooldown,
                } => CargoObject::Module(make_module(
                    *id,
                    definition,
                    *paint,
                    *charge_cooldown,
                    *fire_cooldown,
                    catalog,
                )?),
                SavedCargo::Item {
                    id,
                    definition,
                    health,
                    mined,
                    rounds,
                    message,
                    unlock,
                } => {
                    let properties = ObjectProperties {
                        health: *health,
                        message: message.clone(),
                        ..ObjectProperties::default()
                    };
                    let mut item = Item::new(*id, definition, properties, catalog)
                        .ok_or_else(|| format!("unknown saved cargo {:?}", definition))?;
                    item.rounds = rounds.or(item.rounds);
                    item.object.mined = *mined;
                    item.object.dead = true;
                    item.object.unlock.clone_from(unlock);
                    CargoObject::Item(Box::new(item))
                }
            };
            if !ids.insert(cargo.id()) || cargo.id() == 0 {
                return Err("duplicate saved cargo or object ID".to_owned());
            }
            ship.craft.cargo_contents.push(cargo);
        }
        ship.craft.docked_to = self.docked_to;
        ship.craft.object.dead = self.dead;
        ship.craft.transit_time = self.transit_time;
        ship.craft.transit_gate = self.transit_gate;
        ship.fuel = self.fuel;
        ship.stored_power = self.stored_power.min(ship.power_rates().capacity);
        ship.update_mass();
        Ok(ship)
    }
}

fn paint_index(shades: &[String], catalog: &Catalog) -> Option<usize> {
    if catalog
        .colors
        .get("white")
        .is_some_and(|white| white == shades)
    {
        return None;
    }
    catalog
        .paint_colors
        .iter()
        .position(|palette| palette == shades)
}

fn paint(index: Option<usize>, catalog: &Catalog) -> Result<Option<Vec<String>>, String> {
    index
        .map(|index| {
            catalog
                .paint_colors
                .get(index)
                .cloned()
                .ok_or_else(|| format!("unknown saved paint {index}"))
        })
        .transpose()
}

fn make_module(
    id: i64,
    definition: &str,
    paint_index: Option<usize>,
    charge: Option<f64>,
    fire: f64,
    catalog: &Catalog,
) -> Result<InstalledModule, String> {
    let spec = catalog
        .module_specs
        .get(definition)
        .ok_or_else(|| format!("unknown saved module {definition:?}"))?;
    let mut module = InstalledModule::new(id, definition.to_owned(), Arc::clone(spec));
    if let Some(shades) = paint(paint_index, catalog)? {
        module.shades = Some(shades);
    }
    if let Some(charge) = charge {
        module.charge_cooldown = charge;
    }
    module.fire_cooldown = fire;
    Ok(module)
}
