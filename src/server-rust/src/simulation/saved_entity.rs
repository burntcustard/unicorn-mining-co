//! Native save records for authoritative world entities.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::objects::craft::{CargoObject, Craft, InstalledModule};
use crate::objects::craft_damage::WreckagePart;
use crate::objects::item::Item;
use crate::objects::nav_beacon::new_nav_beacon;
use crate::objects::portal::{Portal, PortalState};
use crate::objects::projectile::Projectile;
use crate::objects::saved_ship::SavedShip;
use crate::objects::station::Station;
use crate::persistence::EntityState;
use crate::specs::{Catalog, HullSegment};
use crate::vector::Vector;

use super::asteroid::{Asteroid, AsteroidProperties};
use super::asteroid_geometry::{AsteroidOutlines, AsteroidSegment};
use super::game_object::{GameObject, ObjectProperties};
use super::world::EntityKind;

#[derive(Debug, Deserialize, Serialize)]
pub struct SavedModel {
    object: GameObject,
    model: SavedKind,
}

#[derive(Debug, Deserialize, Serialize)]
enum SavedKind {
    Object,
    Module(SavedModule),
    Item {
        rounds: Option<i32>,
    },
    Projectile,
    Portal(PortalState),
    Asteroid {
        contents: Vec<i32>,
        max_health: f64,
        segments: Option<Vec<AsteroidSegment>>,
    },
    Ship {
        ship: SavedShip,
        launching: f64,
        has_launching: bool,
        forward: f64,
        turn: f64,
        thruster_power: f64,
        systems_power: f64,
        firing: bool,
        target_id: Option<i64>,
    },
    Station(SavedCraft),
    Craft(SavedCraft),
}

#[derive(Debug, Deserialize, Serialize)]
struct SavedCraft {
    plans: Option<Vec<HullSegment>>,
    hulls: Vec<SavedHull>,
    modules: Vec<SavedMount>,
    cargo: Vec<SavedCargo>,
    wreckage: Vec<WreckagePart>,
    docked_to: Option<i64>,
    launching: f64,
    has_launching: bool,
    transit_time: f64,
    transit_gate: Option<i64>,
    suppress_drops: bool,
}

#[derive(Debug, Deserialize, Serialize)]
struct SavedHull {
    health: f64,
    present: bool,
    position: Vector,
    original_position: Vector,
}

#[derive(Debug, Deserialize, Serialize)]
struct SavedMount {
    index: usize,
    health: f64,
    health_activated: Option<f64>,
    module: SavedModule,
    active: Vec<[f64; 2]>,
}

#[derive(Debug, Deserialize, Serialize)]
struct SavedModule {
    id: i64,
    definition: String,
    shades: Option<Vec<String>>,
    charge_cooldown: f64,
    fire_cooldown: f64,
    aim_rotation: f64,
    fitted_order: u64,
}

#[derive(Debug, Deserialize, Serialize)]
enum SavedCargo {
    Module(SavedModule),
    Item {
        object: Box<GameObject>,
        rounds: Option<i32>,
    },
}

impl EntityState for SavedModel {
    fn id(&self) -> i64 {
        self.object.id
    }
}

impl SavedModel {
    pub fn capture(model: &EntityKind, catalog: &Catalog) -> Self {
        let object = capture_object(model.object());
        let model = match model {
            EntityKind::Object(_) => SavedKind::Object,
            EntityKind::Module { module, .. } => SavedKind::Module(SavedModule::capture(module)),
            EntityKind::Item(item) => SavedKind::Item {
                rounds: item.rounds,
            },
            EntityKind::Projectile(_) => SavedKind::Projectile,
            EntityKind::Portal(portal) => SavedKind::Portal(portal.capture_state()),
            EntityKind::Asteroid(asteroid) => {
                // A pristine procedural asteroid regenerates its outline and
                // subdivisions from its ID. Checkpoints avoid materializing them.
                let segments = if object.shape_outline.is_some() || asteroid.damaged() {
                    asteroid.segments().map(<[AsteroidSegment]>::to_vec)
                } else {
                    None
                };
                SavedKind::Asteroid {
                    contents: asteroid.contents.clone(),
                    max_health: asteroid.max_health,
                    segments,
                }
            }
            EntityKind::Ship(ship) => SavedKind::Ship {
                ship: SavedShip::capture(ship, catalog),
                launching: ship.craft.launching,
                has_launching: ship.craft.has_launching,
                forward: ship.forward,
                turn: ship.turn,
                thruster_power: ship.thruster_power,
                systems_power: ship.systems_power,
                firing: ship.firing,
                target_id: ship.target_id,
            },
            EntityKind::Station(station) => {
                SavedKind::Station(SavedCraft::capture(&station.craft, false, true))
            }
            EntityKind::Craft(craft) => SavedKind::Craft(SavedCraft::capture(
                craft,
                craft.object.kind != "navBeacon" && craft.wreckage.is_empty(),
                false,
            )),
        };
        Self { object, model }
    }

    pub fn restore(
        self,
        catalog: &Catalog,
        outlines: &mut AsteroidOutlines,
    ) -> Result<EntityKind, String> {
        let Self { mut object, model } = self;
        object.restore_rules(&catalog.simulation);
        let id = object.id;
        let model = match model {
            SavedKind::Object => EntityKind::Object(Box::new(object)),
            SavedKind::Module(module) => EntityKind::Module {
                object: Box::new(object),
                module: module.restore(catalog)?,
            },
            SavedKind::Item { rounds } => EntityKind::Item(Box::new(Item { object, rounds })),
            SavedKind::Projectile => {
                let mut projectile = Projectile::new(
                    id,
                    &object.definition_id,
                    ObjectProperties {
                        position: object.position,
                        health: Some(object.health),
                        ..ObjectProperties::default()
                    },
                    catalog,
                )
                .ok_or_else(|| format!("unknown saved projectile {:?}", object.definition_id))?;
                projectile.object = object;
                EntityKind::Projectile(Box::new(projectile))
            }
            SavedKind::Portal(state) => {
                EntityKind::Portal(Box::new(Portal::restore_state(object, state, catalog)))
            }
            SavedKind::Asteroid {
                contents,
                max_health,
                segments,
            } => {
                let mut asteroid = Asteroid::new(
                    id,
                    AsteroidProperties {
                        object: ObjectProperties {
                            shape_outline: object.shape_outline.clone(),
                            radius: Some(object.radius),
                            mass: Some(object.mass),
                            health: Some(object.health),
                            resource: object.resource,
                            ..ObjectProperties::default()
                        },
                        contents,
                        max_health: Some(max_health),
                        point_count: object.point_count,
                        radius_even: object.radius_even,
                        segments,
                    },
                    catalog,
                    outlines,
                );
                asteroid.object = object;
                asteroid.lock_geometry();
                EntityKind::Asteroid(Box::new(asteroid))
            }
            SavedKind::Ship {
                ship,
                launching,
                has_launching,
                forward,
                turn,
                thruster_power,
                systems_power,
                firing,
                target_id,
            } => {
                let mut ship = ship.restore(object.player_id.unwrap_or_default(), catalog)?;
                ship.craft.object = object;
                ship.craft.launching = launching;
                ship.craft.has_launching = has_launching;
                ship.forward = forward;
                ship.turn = turn;
                ship.thruster_power = thruster_power;
                ship.systems_power = systems_power;
                ship.firing = firing;
                ship.target_id = target_id;
                ship.craft.update_flight_mode();
                EntityKind::Ship(Box::new(ship))
            }
            SavedKind::Station(state) => {
                let mut station = Station::new(
                    id,
                    &object.definition_id,
                    ObjectProperties::default(),
                    Some(Vec::new()),
                    catalog,
                    || 0,
                )
                .ok_or_else(|| format!("unknown saved station {:?}", object.definition_id))?;
                station.craft.object = object;
                state.restore(&mut station.craft, catalog)?;
                EntityKind::Station(Box::new(station))
            }
            SavedKind::Craft(mut state) => {
                let mut craft = if object.kind == "navBeacon" {
                    new_nav_beacon(id, ObjectProperties::default(), catalog)
                } else if !state.wreckage.is_empty() {
                    Craft::from_wreckage(
                        id,
                        ObjectProperties::default(),
                        std::mem::take(&mut state.wreckage),
                        object.shades.clone(),
                        catalog,
                    )
                } else {
                    let plans = state
                        .plans
                        .as_deref()
                        .ok_or_else(|| "saved craft has no hull plans".to_owned())?;
                    Craft::new(object.clone(), plans)
                };
                craft.object = object;
                state.restore(&mut craft, catalog)?;
                EntityKind::Craft(Box::new(craft))
            }
        };
        Ok(model)
    }
}

impl SavedCraft {
    fn capture(craft: &Craft, save_plans: bool, station: bool) -> Self {
        let mut modules: Vec<_> = craft
            .mounts
            .iter()
            .enumerate()
            .filter_map(|(index, mount)| {
                let module = mount.module.as_ref()?;
                craft.hulls[mount.hull].present.then_some(SavedMount {
                    index,
                    health: mount.health,
                    health_activated: mount.health_activated,
                    module: SavedModule::capture(module),
                    active: module
                        .parts
                        .iter()
                        .map(|part| [part.active, part.activation_progress])
                        .collect(),
                })
            })
            .collect();
        // The installed order breaks equal-layer collider ties.
        modules.sort_unstable_by_key(|mount| mount.module.fitted_order);
        let cargo = craft
            .cargo_contents
            .iter()
            .filter_map(|object| match object {
                CargoObject::Item(item) => Some(SavedCargo::Item {
                    object: Box::new(capture_object(&item.object)),
                    rounds: item.rounds,
                }),
                // Sold modules are stock for the current docking visit only.
                CargoObject::Module(_) if station => None,
                CargoObject::Module(module) => {
                    Some(SavedCargo::Module(SavedModule::capture(module)))
                }
            })
            .collect();
        Self {
            plans: save_plans.then(|| craft.hulls.iter().map(|hull| hull.plan.clone()).collect()),
            hulls: craft
                .hulls
                .iter()
                .map(|hull| SavedHull {
                    health: hull.health,
                    present: hull.present,
                    position: hull.position,
                    original_position: hull.original_position,
                })
                .collect(),
            modules,
            cargo,
            wreckage: craft.wreckage.clone(),
            docked_to: craft.docked_to,
            launching: craft.launching,
            has_launching: craft.has_launching,
            transit_time: craft.transit_time,
            transit_gate: craft.transit_gate,
            suppress_drops: craft.suppress_drops,
        }
    }

    fn restore(self, craft: &mut Craft, catalog: &Catalog) -> Result<(), String> {
        if self.hulls.len() != craft.hulls.len() {
            return Err(format!(
                "saved hull does not match craft {}",
                craft.object.id
            ));
        }
        for (hull, saved) in craft.hulls.iter_mut().zip(self.hulls) {
            hull.health = saved.health;
            hull.present = saved.present;
            hull.position = saved.position;
            hull.original_position = saved.original_position;
        }
        craft.cockpit = craft
            .hulls
            .iter()
            .position(|hull| hull.present && hull.plan.core);
        for saved in self.modules {
            let mount = craft
                .mounts
                .get(saved.index)
                .ok_or_else(|| format!("unknown saved mount {}", saved.index))?;
            if mount.module.is_some()
                || !craft.hulls[mount.hull].present
                || !mount.accepts(&saved.module.definition)
            {
                return Err(format!(
                    "saved module {:?} does not fit mount {}",
                    saved.module.definition, saved.index
                ));
            }
            let order = saved.module.fitted_order;
            let module = saved.module.restore(catalog)?;
            craft.fit(saved.index, Some(module));
            let mount = &mut craft.mounts[saved.index];
            mount.health = saved.health;
            mount.health_activated = saved.health_activated;
            if let Some(module) = &mut mount.module {
                module.fitted_order = order;
                for (part, [active, progress]) in module.parts.iter_mut().zip(saved.active) {
                    part.active = active;
                    part.activation_progress = progress;
                }
            }
            craft.fitted_order = craft.fitted_order.max(order);
        }
        for saved in self.cargo {
            let cargo = match saved {
                SavedCargo::Module(module) => CargoObject::Module(module.restore(catalog)?),
                SavedCargo::Item { mut object, rounds } => {
                    object.restore_rules(&catalog.simulation);
                    CargoObject::Item(Box::new(Item {
                        object: *object,
                        rounds,
                    }))
                }
            };
            craft.cargo_contents.push(cargo);
        }
        craft.docked_to = self.docked_to;
        craft.launching = self.launching;
        craft.has_launching = self.has_launching;
        craft.transit_time = self.transit_time;
        craft.transit_gate = self.transit_gate;
        craft.suppress_drops = self.suppress_drops;
        craft.update_flight_mode();
        Ok(())
    }
}

impl SavedModule {
    fn capture(module: &InstalledModule) -> Self {
        Self {
            id: module.id,
            definition: module.definition_id.clone(),
            shades: module.shades.clone(),
            charge_cooldown: module.charge_cooldown,
            fire_cooldown: module.fire_cooldown,
            aim_rotation: module.aim_rotation,
            fitted_order: module.fitted_order,
        }
    }

    fn restore(self, catalog: &Catalog) -> Result<InstalledModule, String> {
        let spec = catalog
            .module_specs
            .get(&self.definition)
            .ok_or_else(|| format!("unknown saved module {:?}", self.definition))?;
        let mut module = InstalledModule::new(self.id, self.definition, Arc::clone(spec));
        module.shades = self.shades;
        module.charge_cooldown = self.charge_cooldown;
        module.fire_cooldown = self.fire_cooldown;
        module.aim_rotation = self.aim_rotation;
        module.fitted_order = self.fitted_order;
        Ok(module)
    }
}

fn capture_object(object: &GameObject) -> GameObject {
    let mut state = object.clone();
    state.position.x = state.position.x.round();
    state.position.y = state.position.y.round();
    state
}

#[cfg(test)]
mod tests {
    use crate::objects::craft_damage::WreckagePart;

    use super::*;

    fn round_trip(
        model: EntityKind,
        catalog: &Catalog,
    ) -> Result<EntityKind, Box<dyn std::error::Error>> {
        let state = SavedModel::capture(&model, catalog);
        let mut bytes = Vec::new();
        ciborium::into_writer(&state, &mut bytes)?;
        let state: SavedModel = ciborium::from_reader(bytes.as_slice())?;
        let mut outlines = AsteroidOutlines::default();
        state.restore(catalog, &mut outlines).map_err(Into::into)
    }

    #[test]
    fn wreckage_keeps_zero_fill_empty_stroke_and_nan_defaults()
    -> Result<(), Box<dyn std::error::Error>> {
        let catalog = Catalog::load()?;
        let craft = Craft::from_wreckage(
            8,
            ObjectProperties {
                position: Vector::new(12.25, -5.5),
                velocity: Vector::new(4.0, 3.0),
                decay: Some(1.0),
                health: Some(8.0),
                ..ObjectProperties::default()
            },
            vec![WreckagePart {
                color: String::new(),
                outline: Some(vec![[-2.0, -3.0], [4.0, -2.0], [1.0, 5.0]]),
                radius: 6.0,
                offset: Vector::new(2.0, 1.0),
                health: 1.0,
                fill_shade: Some(0.0),
                unstroked: true,
            }],
            None,
            &catalog,
        );
        let EntityKind::Craft(restored) = round_trip(EntityKind::Craft(Box::new(craft)), &catalog)?
        else {
            panic!("restored craft")
        };
        assert_eq!(restored.object.id, 8);
        assert_eq!(restored.object.position, Vector::new(12.0, -6.0));
        assert_eq!(restored.object.velocity, Vector::new(4.0, 3.0));
        assert!(restored.object.speed_limit.is_nan());
        assert_eq!(
            restored.object.max_speed(),
            catalog.simulation.motion.default_max_speed
        );
        assert_eq!(restored.wreckage[0].fill_shade, Some(0.0));
        assert!(restored.wreckage[0].unstroked);
        assert_eq!(restored.hulls[0].position, Vector::new(2.0, 1.0));
        Ok(())
    }

    #[test]
    fn damaged_asteroid_survives_save_and_pristine_geometry_stays_lazy()
    -> Result<(), Box<dyn std::error::Error>> {
        let catalog = Catalog::load()?;
        let mut outlines = AsteroidOutlines::default();
        let mut pristine = Asteroid::new(
            20,
            AsteroidProperties {
                object: ObjectProperties {
                    radius: Some(55.0),
                    ..ObjectProperties::default()
                },
                contents: vec![1, 2],
                ..AsteroidProperties::default()
            },
            &catalog,
            &mut outlines,
        );
        pristine.lock_geometry();
        let model = EntityKind::Asteroid(Box::new(pristine));
        let EntityKind::Asteroid(mut restored) = round_trip(model, &catalog)? else {
            panic!("restored asteroid")
        };
        assert!(restored.deferred_extent().is_some());

        let health = restored.segments().expect("generated segments")[0].health;
        assert_eq!(restored.damage_segment(Some(0), health / 2.0), health / 2.0);
        let EntityKind::Asteroid(restored) = round_trip(EntityKind::Asteroid(restored), &catalog)?
        else {
            panic!("restored asteroid")
        };
        assert!(restored.damaged());
        assert_eq!(
            restored.segments().expect("captured segments")[0].health,
            health / 2.0
        );
        assert_eq!(restored.contents, [1, 2]);
        Ok(())
    }

    #[test]
    fn station_stock_persists_and_loose_module_preserves_booster_charge()
    -> Result<(), Box<dyn std::error::Error>> {
        let catalog = Catalog::load()?;
        let booster = Arc::clone(&catalog.module_specs["thrustBooster"]);
        let mut module = InstalledModule::new(51, "thrustBooster".into(), Arc::clone(&booster));
        module.charge_cooldown = 1.25;
        module.fire_cooldown = 0.75;
        let object = GameObject::new(51, ObjectProperties::default(), &catalog.simulation);
        let EntityKind::Module { module, object } = round_trip(
            EntityKind::Module {
                object: Box::new(object),
                module,
            },
            &catalog,
        )?
        else {
            panic!("restored loose module")
        };
        assert_eq!(object.id, 51);
        assert_eq!(module.charge_cooldown, 1.25);
        assert_eq!(module.fire_cooldown, 0.75);

        let mut item = Item::new(52, "autogunAmmo", ObjectProperties::default(), &catalog)
            .expect("known item");
        item.rounds = Some(72);
        let station = Station::new(
            50,
            "corral-6",
            ObjectProperties::default(),
            Some(vec![
                CargoObject::Module(module),
                CargoObject::Item(Box::new(item)),
            ]),
            &catalog,
            || unreachable!(),
        )
        .expect("known station");
        let EntityKind::Station(restored) =
            round_trip(EntityKind::Station(Box::new(station)), &catalog)?
        else {
            panic!("restored station")
        };
        let [CargoObject::Item(item)] = restored.craft.cargo_contents.as_slice() else {
            panic!("durable stock only")
        };
        assert_eq!(item.object.id, 52);
        assert_eq!(item.rounds, Some(72));
        Ok(())
    }
}
