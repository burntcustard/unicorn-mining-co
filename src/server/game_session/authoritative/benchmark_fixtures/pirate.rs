use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::npc::flight::{AttackOptions, AttackWeapon, Pilot};
use crate::npc::perception::ObstacleSnapshot;
use crate::npc::world_host::{AttackContextOptions, attack_context, attack_weapon};
use crate::objects::craft::{CargoObject, InstalledModule};
use crate::objects::item::Item;
use crate::objects::ship::Ship;
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::region_generation::RegionGenerator;
use crate::simulation::world::{EntityKind, Player};
use crate::utilities::vector::Vector;

use super::super::{Input, InputFrame, SimulationEvent};
use super::{AuthoritativeSession, npc::now_ms};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Fixture {
    directory: PathBuf,
    #[serde(default)]
    until_ship_destroyed: bool,
    #[serde(default)]
    ship_destruction_limit: usize,
    #[serde(skip)]
    encounters: HashMap<i64, Encounter>,
}

impl Fixture {
    pub(super) fn load(path: PathBuf) -> std::io::Result<Self> {
        Ok(serde_json::from_reader(fs::File::open(path)?)?)
    }

    fn destruction_limit(&self) -> usize {
        if self.until_ship_destroyed {
            self.ship_destruction_limit.max(1)
        } else {
            0
        }
    }
}

struct Encounter {
    index: usize,
    ships: [i64; 4],
    pilots: [Pilot; 3],
    obstacles: [ObstacleSnapshot; 3],
    start: Option<(u64, u64)>,
    destroyed_ships: Vec<i64>,
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

fn reinforce(ship: &mut Ship) {
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
        let destruction_limit = self.fixtures.pirate.as_ref().unwrap().destruction_limit();
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
            Vector::new(180.0, -230.0),
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
            .expect("pirate benchmark needs clear starting positions");
        let mut ships = [ship_id, 0, 0, 0];
        for (slot, (definition, weapon, ammo_items, color)) in [
            ("courser", None, 1, "cyan"),
            ("mustang", Some(("autogun", [0, 6])), 3, "orange"),
            ("arrow", Some(("laser", [1, 6])), 0, "violet"),
            ("excel8", Some(("plasmaAccelerator", [6, 7])), 0, "green"),
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
            if let Some((mount, module)) = match definition {
                "courser" if destruction_limit > 1 => Some((4, "shieldGeneratorXs")),
                "excel8" => Some((3, "powerPlant1A")),
                _ => None,
            } {
                assert!(ship.craft.mounts[mount].accepts(module));
                ship.fit(
                    mount,
                    Some(InstalledModule::new(
                        world.ids.object(),
                        module.into(),
                        Arc::clone(&catalog.module_specs[module]),
                    )),
                );
            }
            if let Some((weapon, mounts)) = weapon {
                for mount in mounts {
                    assert!(ship.craft.mounts[mount].accepts(weapon));
                    ship.fit(
                        mount,
                        Some(InstalledModule::new(
                            world.ids.object(),
                            weapon.into(),
                            Arc::clone(&catalog.module_specs[weapon]),
                        )),
                    );
                }
                let bearing = offsets
                    .iter()
                    .enumerate()
                    .filter(|(opponent, _)| *opponent != slot)
                    .map(|(_, &offset)| offset - offsets[slot])
                    .min_by(|a, b| a.length_squared().total_cmp(&b.length_squared()))
                    .expect("pirate benchmark opponent");
                ship.craft.object.rotation = bearing.y.atan2(bearing.x);
            }
            if destruction_limit == 0 {
                reinforce(&mut ship);
            }
            for _ in 0..ammo_items {
                let Some(item) = Item::new(
                    world.ids.entity(),
                    "autogunAmmo",
                    Default::default(),
                    &world.catalog,
                ) else {
                    break;
                };
                ship.craft
                    .cargo_contents
                    .push(CargoObject::Item(Box::new(item)));
            }
            ship.update_mass();
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
                start: None,
                destroyed_ships: Vec::new(),
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
            if fixture.until_ship_destroyed
                && encounter.start.is_none()
                && running.world.entity(encounter.ships[0]).is_some()
            {
                encounter.start = Some((now_ms(), running.world.tick));
            }
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
                let rules = &world.catalog.pirate_spec;
                let weapon = attack_weapon(ship);
                let firing_distance = match weapon {
                    AttackWeapon::Beam { range } => rules.firing_distance.min(range),
                    AttackWeapon::Projectile { .. } => rules.firing_distance,
                    AttackWeapon::None => 0.0,
                };
                let context = attack_context(
                    running,
                    &mut encounter.obstacles[slot],
                    AttackContextOptions {
                        ship_id: id,
                        target_id: target.id,
                        pass_distance: rules.pass_distance,
                    },
                );
                let (thrust, turn, fire) = pilot.attack(
                    context,
                    context.target.expect("visible combat opponent"),
                    AttackOptions {
                        pass_distance: rules.pass_distance,
                        aim_tolerance: rules.aim_tolerance,
                        weapon,
                        aim_prediction_time: rules.aim_prediction_time,
                        can_fire: object.position.distance_squared(target.position)
                            < firing_distance * firing_distance,
                    },
                );
                self.inputs.insert(
                    object.player_number.unwrap(),
                    InputFrame {
                        input: Input {
                            thrust,
                            turn,
                            fire,
                            target_id: Some(target.id),
                            autogun_active: true,
                            laser_active: true,
                            plasma_active: true,
                            cargo_hatch: true,
                            ..Default::default()
                        },
                        changes: Vec::new(),
                    },
                );
            }
        }
    }

    pub(in crate::game_session::authoritative) fn record_pirate_ship_destruction(
        &mut self,
        index: usize,
        ship_id: i64,
    ) {
        let Some(fixture) = self.fixtures.pirate.as_mut() else {
            return;
        };
        let destruction_limit = fixture.destruction_limit();
        let Some(encounter) = fixture.encounters.values_mut().find(|encounter| {
            encounter.index == index
                && encounter.destroyed_ships.len() < destruction_limit
                && !encounter.destroyed_ships.contains(&ship_id)
                && encounter.ships.contains(&ship_id)
        }) else {
            return;
        };
        let Some((started_at, start_tick)) = encounter.start else {
            return;
        };
        encounter.destroyed_ships.push(ship_id);
        let order = encounter.destroyed_ships.len();
        let courser_id = encounter.ships[0];
        let file = if order == 1 {
            format!("destruction-{courser_id}.json")
        } else {
            format!("destruction-{courser_id}-{order}.json")
        };
        let path = fixture.directory.join(file);
        let pending = path.with_extension("tmp");
        let report = serde_json::json!({
            "shipId": ship_id,
            "at": now_ms(),
            "tick": self.sectors[index].running.world.tick,
            "startedAt": started_at,
            "startTick": start_tick,
        });
        if let Err(error) =
            fs::write(&pending, report.to_string()).and_then(|_| fs::rename(pending, path))
        {
            eprintln!("Pirate benchmark destruction: {error}");
        }
    }

    pub(super) fn record_pirate_benchmark(&mut self, index: usize) {
        let Some(fixture) = self.fixtures.pirate.as_mut() else {
            return;
        };
        let world = &self.sectors[index].running.world;
        let follow_survivor = fixture.destruction_limit() > 1;
        for (&account_id, encounter) in fixture
            .encounters
            .iter_mut()
            .filter(|(_, encounter)| encounter.index == index)
        {
            if follow_survivor
                && encounter.destroyed_ships.first() == Some(&encounter.ships[0])
                && let Some(account) = self.accounts.get_mut(&account_id)
                && let Some(survivor) = encounter.ships[1..]
                    .iter()
                    .filter_map(|&id| world.entity(id))
                    .map(|entity| entity.model.object())
                    .find(|object| !object.dead)
            {
                account.position = survivor.position;
            }
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
            let observer = world
                .players()
                .find(|player| player.ship_id == *id)
                .map(|player| player.player_number);
            world.remove_entity(*id);
            if let Some(observer) = observer {
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
