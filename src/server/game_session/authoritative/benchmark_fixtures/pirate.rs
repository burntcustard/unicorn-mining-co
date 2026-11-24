use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::npc::flight::{AttackOptions, Movement, Pilot};
use crate::npc::perception::ObstacleSnapshot;
use crate::npc::world_host::flight_context;
use crate::objects::craft::{CargoObject, InstalledModule};
use crate::objects::item::Item;
use crate::objects::ship::Ship;
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::region_generation::RegionGenerator;
use crate::simulation::world::{EntityKind, Player, World};
use crate::utilities::vector::Vector;

use super::super::{Input, InputFrame, SimulationEvent};
use super::{AuthoritativeSession, npc::now_ms};

#[derive(Deserialize)]
pub(super) struct Fixture {
    directory: PathBuf,
    #[serde(skip)]
    encounters: HashMap<i64, Encounter>,
}

impl Fixture {
    pub(super) fn load(path: PathBuf) -> std::io::Result<Self> {
        Ok(serde_json::from_reader(fs::File::open(path)?)?)
    }
}

struct Encounter {
    index: usize,
    ships: [i64; 3],
    pilots: [Pilot; 2],
    obstacles: [ObstacleSnapshot; 2],
    hits: Vec<Hit>,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct Hit {
    at: u64,
    by: i64,
    #[serde(rename = "TargetID")]
    target_id: i64,
    damage: f64,
    weapon: &'static str,
}

fn equip(ship: &mut Ship, world: &mut World, ammunition: Option<&str>) {
    for hull in &mut ship.craft.hulls {
        if hull.health.is_finite() && hull.health > 0.0 {
            hull.health = 5000.0;
        }
    }
    for mount in &mut ship.craft.mounts {
        if mount.health.is_finite() && mount.health > 0.0 {
            mount.health = 5000.0;
        }
        if let Some(health) = &mut mount.health_activated {
            *health = 5000.0;
        }
    }
    if let Some(definition) = ammunition
        && let Some(item) = Item::new(
            world.ids.entity(),
            definition,
            Default::default(),
            &world.catalog,
        )
    {
        ship.craft
            .cargo_contents
            .push(CargoObject::Item(Box::new(item)));
    }
    ship.update_mass();
}

impl AuthoritativeSession {
    pub(in crate::game_session::authoritative) fn prepare_pirate_benchmark(&mut self, id: i64) {
        let Some(account) = self.accounts.get(&id) else {
            return;
        };
        if account.name != "Render pirate"
            || account.playing
            || self
                .fixtures
                .pirate
                .as_ref()
                .unwrap()
                .encounters
                .contains_key(&id)
        {
            return;
        }
        let ship_id = account.ship_id;
        let index = account.sector;
        self.sectors.update_ids(index);
        let sector = &mut self.sectors[index];
        let world = &mut sector.running.world;
        let catalog = Arc::clone(&world.catalog);
        let bound = Vector::new(40_000.0, 40_000.0);
        let center = RegionGenerator::new(&catalog, Some(&sector.sector))
            .generate_fields(self.world_seed as u32, -bound, bound)
            .into_iter()
            .filter(|field| field.resource == 2)
            .min_by(|a, b| {
                a.position
                    .length_squared()
                    .total_cmp(&b.position.length_squared())
            })
            .expect("pirate benchmark needs a combat field")
            .position;

        let offsets = [
            Vector::ZERO,
            Vector::new(-320.0, -160.0),
            Vector::new(-200.0, -400.0),
        ];
        sector.regions.sync(world, &[center]);
        let position = (0..=2400)
            .step_by(120)
            .flat_map(|distance| {
                (0..24).map(move |bearing| {
                    let (sin, cos) = (f64::from(bearing) * std::f64::consts::PI / 12.0).sin_cos();
                    center + Vector::new(cos, sin) * f64::from(distance)
                })
            })
            .find(|&position| {
                offsets.iter().all(|&offset| {
                    world.entities().all(|entity| {
                        let object = entity.model.object();
                        object.kind != "asteroid"
                            || object.position.distance_squared(position + offset)
                                >= (object.radius + 90.0).powi(2)
                    })
                })
            })
            .expect("pirate benchmark needs three clear starting positions");
        let mut ships = [ship_id, 0, 0];
        for (slot, (definition, weapon, ammo, color)) in [
            ("courser", None, Some("autogunAmmo"), "cyan"),
            ("mustang", Some("autogun"), Some("autogunAmmo"), "orange"),
            ("arrow", Some("laser"), None, "violet"),
        ]
        .into_iter()
        .enumerate()
        {
            let observer = if slot == 0 {
                id
            } else {
                let observer = self.next_player_number;
                self.next_player_number += 1;
                ships[slot] = world.ids.entity();
                observer
            };
            let mut ship = Ship::new_player(
                ships[slot],
                definition,
                ObjectProperties {
                    position: position + offsets[slot],
                    player_number: Some(observer),
                    name: Some(match weapon {
                        Some(_) => format!("Pirate {definition}"),
                        None => "Render pirate".into(),
                    }),
                    ..Default::default()
                },
                &catalog,
                || world.ids.object(),
            )
            .expect("pirate benchmark ship");
            ship.craft.object.shades = catalog.colors.get(color).cloned();
            if let Some(definition) = weapon {
                let mount = ship
                    .craft
                    .mounts
                    .iter()
                    .position(|mount| mount.accepts(definition) && mount.module.is_none())
                    .or_else(|| {
                        ship.craft.mounts.iter().position(|mount| {
                            mount.accepts(definition)
                                && mount
                                    .module
                                    .as_ref()
                                    .is_some_and(|module| module.spec.behavior == "cargoHatch")
                        })
                    })
                    .expect("pirate benchmark weapon mount");
                ship.fit(
                    mount,
                    Some(InstalledModule::new(
                        world.ids.object(),
                        definition.into(),
                        Arc::clone(&catalog.module_specs[definition]),
                    )),
                );
                let opponent = if slot == 1 { 2 } else { 1 };
                let bearing = offsets[opponent] - offsets[slot];
                ship.craft.object.rotation = bearing.y.atan2(bearing.x);
            }
            equip(&mut ship, world, ammo);
            if slot == 0 {
                let account = self.accounts.get_mut(&id).unwrap();
                account.hidden = Some(world.make_entity(EntityKind::Ship(Box::new(ship)), false));
                account.definition = definition.into();
                account.position = position;
                account.encounter_after = u64::MAX;
            } else {
                ship.craft.object.hostile = true;
                ship.npc_state = "Fighting";
                world.add_entity(EntityKind::Ship(Box::new(ship)), false);
                world.set_player(Player {
                    player_number: observer,
                    ship_id: ships[slot],
                    observer_range: 0.0,
                });
            }
        }
        self.fixtures.pirate.as_mut().unwrap().encounters.insert(
            id,
            Encounter {
                index,
                ships,
                pilots: Default::default(),
                obstacles: Default::default(),
                hits: Vec::new(),
            },
        );
        self.sectors.commit_ids(index);
    }

    pub(in crate::game_session::authoritative) fn update_pirate_benchmark(&mut self, index: usize) {
        let Some(fixture) = self.fixtures.pirate.as_mut() else {
            return;
        };
        let running = &mut self.sectors[index].running;
        for encounter in fixture
            .encounters
            .values_mut()
            .filter(|encounter| encounter.index == index)
        {
            for id in encounter.ships {
                if let Some(entity) = running.world.entity_mut(id)
                    && let EntityKind::Ship(ship) = &mut entity.model
                {
                    ship.fuel = ship.fuel_capacity;
                }
            }
            let world = &running.world;
            for (slot, pilot) in encounter.pilots.iter_mut().enumerate() {
                let id = encounter.ships[slot + 1];
                let Some(entity) = world.entity(id) else {
                    continue;
                };
                let EntityKind::Ship(ship) = &entity.model else {
                    continue;
                };
                let object = &ship.craft.object;
                let Some(target) = encounter
                    .ships
                    .iter()
                    .filter(|&&other| other != id)
                    .filter_map(|&other| world.entity(other).map(|entity| entity.model.object()))
                    .min_by(|a, b| {
                        object
                            .position
                            .distance_squared(a.position)
                            .total_cmp(&object.position.distance_squared(b.position))
                    })
                else {
                    continue;
                };
                let projectile_speed = ship
                    .craft
                    .mounts
                    .iter()
                    .filter_map(|mount| mount.module.as_ref())
                    .map(|module| module.spec.projectile.speed)
                    .find(|speed| *speed > 0.0)
                    .unwrap_or(0.0);
                let context = flight_context(
                    running,
                    &mut encounter.obstacles[slot],
                    id,
                    &Movement {
                        target_id: target.id,
                        ..Movement::default()
                    },
                );
                let rules = &world.catalog.pirate_spec;
                let (thrust, turn, fire) = pilot.attack(
                    context,
                    context.target.expect("visible combat opponent"),
                    AttackOptions {
                        pass_distance: rules.pass_distance,
                        aim_tolerance: rules.aim_tolerance,
                        projectile_speed,
                        aim_prediction_time: 1.0,
                        can_fire: object.position.distance_squared(target.position)
                            < 700.0_f64.powi(2),
                    },
                );
                self.inputs.insert(
                    object.player_number.unwrap(),
                    InputFrame {
                        input: Input {
                            thrust,
                            turn,
                            fire,
                            autogun_active: true,
                            laser_active: true,
                            cargo_hatch: true,
                            ..Default::default()
                        },
                        changes: Vec::new(),
                    },
                );
            }
        }
    }

    pub(super) fn record_pirate_benchmark(&mut self, index: usize) {
        let Some(fixture) = self.fixtures.pirate.as_mut() else {
            return;
        };
        let world = &self.sectors[index].running.world;
        for encounter in fixture
            .encounters
            .values_mut()
            .filter(|encounter| encounter.index == index)
        {
            for event in &self.events {
                let (by, targets, weapon) = match *event {
                    SimulationEvent::LaserDamage {
                        target_id,
                        by,
                        damage,
                        ..
                    } => (by, [(target_id, damage), (0, 0.0)], "laser"),
                    SimulationEvent::CollisionEvent {
                        by, a, b, damage, ..
                    } => (by, [(a, damage[0]), (b, damage[1])], "projectile"),
                    _ => continue,
                };
                let Some(attacker) = world.player(by) else {
                    continue;
                };
                if !encounter.ships.contains(&attacker.ship_id) {
                    continue;
                }
                for (target_id, damage) in targets {
                    if damage > 0.0
                        && target_id != attacker.ship_id
                        && encounter.ships.contains(&target_id)
                    {
                        encounter.hits.push(Hit {
                            at: now_ms(),
                            by,
                            target_id,
                            damage,
                            weapon,
                        });
                    }
                }
            }
        }
    }

    pub(super) fn finish_pirate_benchmark(&mut self, id: i64) {
        let Some(fixture) = self.fixtures.pirate.as_mut() else {
            return;
        };
        let Some(encounter) = fixture.encounters.remove(&id) else {
            return;
        };
        let world = &mut self.sectors[encounter.index].running.world;
        for id in &encounter.ships[1..] {
            if let Some(entity) = world.remove_entity(*id)
                && let Some(observer) = entity.model.object().player_number
            {
                world.remove_player(observer);
            }
        }
        let path = fixture
            .directory
            .join(format!("combat-{}.json", encounter.ships[0]));
        let report = serde_json::json!({ "hits": encounter.hits });
        if let Err(error) = fs::write(path, report.to_string()) {
            eprintln!("Pirate benchmark report: {error}");
        }
    }
}
