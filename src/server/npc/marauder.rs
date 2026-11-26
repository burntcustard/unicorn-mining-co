//! Sector-local marauder dispatch and combat state.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::objects::ship::Ship;
use crate::protocol::Input;
use crate::specs::Catalog;
use crate::utilities::vector::Vector;
use crate::utilities::{TickTimerOptions, next_tick, tick_due};

use super::flight::{AttackOptions, AttackWeapon, FlightContext, FlightTarget, Movement, Pilot};
use super::navigation::Search;
use super::world_host::attack_weapon;

#[derive(Clone, Copy, Debug)]
pub struct PlayerView<'a> {
    pub account: &'a str,
    pub observer_id: i64,
    pub ship_id: i64,
    pub connected: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct MarauderSpawn<'a> {
    pub ship_spec: &'a str,
    pub name: &'static str,
    pub position: Vector,
    pub rotation: f64,
    pub weapon: &'static str,
    pub ammunition: &'static str,
    pub weapons: usize,
}

/// The host supplies one sector's live ships, player observers, and held input queue.
/// Spawning initializes a hostile ship with suppressed drops and active flight mode.
pub trait MarauderEnvironment {
    fn tick(&self) -> u64;
    fn players(&self) -> impl Iterator<Item = PlayerView<'_>>;
    fn observer_exists(&self, id: i64) -> bool;
    fn ship(&self, id: i64) -> Option<&Ship>;
    fn other_npc_ships(&self) -> impl Iterator<Item = i64>;
    fn can_see(&self, ship: i64, target: i64) -> bool;
    fn flight_context(&mut self, ship: i64, target: Option<i64>) -> FlightContext<'_>;
    /// Return the new entity and observer IDs, after regional observer registration.
    fn spawn(&mut self, request: MarauderSpawn<'_>) -> Option<(i64, i64)>;
    fn remove(&mut self, ship: i64, observer: i64);
    fn set_state(&mut self, ship: i64, activity: Activity);
    fn set_input(&mut self, observer: i64, input: Input);
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub enum Activity {
    #[default]
    Pursuing,
    Preparing,
    Fighting,
    Search,
}

impl Activity {
    pub fn label(self) -> &'static str {
        match self {
            Self::Pursuing => "Pursuing",
            Self::Preparing => "Preparing",
            Self::Fighting => "Fighting",
            Self::Search => "Search",
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct State {
    pub destination: Vector,
    pub search: Search,
    pub visited: bool,
    pub target_id: Option<i64>,
    pub combat_at: u64,
    pub activity: Activity,
}

struct Marauder {
    state: State,
    ship_id: i64,
    observer_id: i64,
    pilot: Pilot,
    input: Input,
    think_at: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Dispatch {
    pub check_at: u64,
    pub seen: HashSet<String>,
}

pub struct Manager {
    pub dispatch: Dispatch,
    marauders: Vec<Marauder>,
}

impl Manager {
    pub fn new(tick: u64, catalog: &Catalog) -> Self {
        let check_at = next_tick(
            timer(tick, catalog.marauder_spec.check_interval, catalog),
            || unreachable!(),
        );
        Self {
            dispatch: Dispatch {
                check_at,
                ..Dispatch::default()
            },
            marauders: Vec::new(),
        }
    }

    pub fn dispatch(&mut self, environment: &mut impl MarauderEnvironment, catalog: &Catalog) {
        let rules = &catalog.marauder_spec;
        let tick = environment.tick();
        if !tick_due(
            &mut self.dispatch.check_at,
            timer(tick, rules.check_interval, catalog),
            || unreachable!(),
        ) {
            return;
        }
        let mut seen = HashSet::new();
        let mut pending = Vec::new();
        for player in environment.players() {
            let Some(ship) = active_ship(environment, player) else {
                continue;
            };
            let destination = ship.craft.object.position;
            if destination.length_squared() <= rules.minimum_distance * rules.minimum_distance {
                continue;
            }
            seen.insert(player.account.to_owned());
            if self.dispatch.seen.contains(player.account) {
                pending.push(destination);
            }
        }
        self.dispatch.seen = seen;
        for destination in pending {
            let position = destination.add_scaled(destination.normalized(), rules.spawn_distance);
            let offset = destination - position;
            let heading = offset.y.atan2(offset.x);
            let request = MarauderSpawn {
                ship_spec: &rules.ship,
                name: "Marauder",
                position,
                rotation: heading,
                weapon: "cannonSm",
                ammunition: "autogunAmmo",
                weapons: 2,
            };
            if let Some((ship_id, observer_id)) = environment.spawn(request) {
                let state = State {
                    destination,
                    search: Search {
                        origin: destination,
                        heading,
                        angle: 0.0,
                    },
                    ..State::default()
                };
                environment.set_state(ship_id, state.activity);
                self.insert(ship_id, observer_id, state);
            }
        }
    }

    fn insert(&mut self, ship_id: i64, observer_id: i64, state: State) {
        self.marauders.push(Marauder {
            state,
            ship_id,
            observer_id,
            pilot: Pilot::default(),
            input: Input::default(),
            think_at: 0,
        });
    }

    pub fn update(&mut self, environment: &mut impl MarauderEnvironment, catalog: &Catalog) {
        let rules = &catalog.marauder_spec;
        let tick = environment.tick();
        self.marauders.retain_mut(|npc| {
            let Some(ship) = environment.ship(npc.ship_id) else {
                environment.remove(npc.ship_id, npc.observer_id);
                return false;
            };
            let position = ship.craft.object.position;
            if !npc.state.visited
                && position.distance_squared(npc.state.destination)
                    <= rules.arrival_distance * rules.arrival_distance
            {
                npc.state.visited = true;
                npc.think_at = 0;
            }
            let no_players_nearby = || {
                !environment.players().any(|player| {
                    active_ship(environment, player).is_some_and(|ship| {
                        position.distance_squared(ship.craft.object.position)
                            <= rules.despawn_distance * rules.despawn_distance
                    })
                })
            };
            if ship.craft.object.dead
                || ship.craft.docked_to.is_some()
                || (npc.state.visited || ship.stranded()) && no_players_nearby()
            {
                environment.remove(npc.ship_id, npc.observer_id);
                return false;
            }
            if tick_due(
                &mut npc.think_at,
                timer(tick, catalog.npc_movement.decision_interval, catalog),
                || unreachable!(),
            ) {
                npc.input = npc.decision(environment, catalog, position);
                environment.set_state(npc.ship_id, npc.state.activity);
            }
            environment.set_input(npc.observer_id, npc.input);
            true
        });
    }

    pub fn ship_ids(&self) -> impl Iterator<Item = i64> + '_ {
        self.marauders.iter().map(|npc| npc.ship_id)
    }

    pub fn states(
        &self,
        environment: &impl MarauderEnvironment,
    ) -> impl Iterator<Item = (i64, &State)> {
        self.marauders
            .iter()
            .filter(move |npc| {
                environment
                    .ship(npc.ship_id)
                    .is_some_and(|ship| !ship.craft.object.dead)
            })
            .map(|npc| (npc.ship_id, &npc.state))
    }

    /// The host registers the restored observer before passing it back to the manager.
    pub fn restore(
        &mut self,
        environment: &mut impl MarauderEnvironment,
        ship_id: i64,
        observer_id: i64,
        state: State,
    ) {
        environment.set_state(ship_id, state.activity);
        self.insert(ship_id, observer_id, state);
    }
}

impl Marauder {
    fn target(&self, environment: &impl MarauderEnvironment, position: Vector) -> Option<i64> {
        let others = environment
            .players()
            .filter_map(|player| active_ship(environment, player).map(|ship| ship.craft.object.id))
            .chain(environment.other_npc_ships());
        let mut closest = f64::INFINITY;
        let mut best = None;
        for id in others {
            let Some(other) = environment
                .ship(id)
                .filter(|_| environment.can_see(self.ship_id, id))
            else {
                continue;
            };
            if self.state.target_id == Some(id) {
                return Some(id);
            }
            let distance = position.distance_squared(other.craft.object.position);
            if distance < closest || distance == closest && best.is_some_and(|best| id < best) {
                closest = distance;
                best = Some(id);
            }
        }
        best
    }

    fn decision(
        &mut self,
        environment: &mut impl MarauderEnvironment,
        catalog: &Catalog,
        position: Vector,
    ) -> Input {
        let rules = &catalog.marauder_spec;
        let mut input = Input {
            flight_mode: true,
            ..Input::default()
        };
        let target_id = self.target(environment, position);
        let weapon = environment
            .ship(self.ship_id)
            .map_or(AttackWeapon::None, attack_weapon);
        let context = environment.flight_context(self.ship_id, target_id);
        if let Some(target) = context
            .target
            .filter(|target| Some(target.entity_id) == target_id)
        {
            if self.state.target_id != Some(target.entity_id) {
                self.state.combat_at = 0;
            }
            self.state.target_id = Some(target.entity_id);
            self.state.search.origin = target.position;
            let distance = position.distance(target.position);
            if self.state.combat_at == 0 && distance <= rules.combat_distance {
                self.state.combat_at = next_tick(
                    timer(context.tick, rules.combat_delay, catalog),
                    || unreachable!(),
                );
            }
            if self.state.combat_at != 0 {
                if context.tick < self.state.combat_at {
                    self.state.activity = Activity::Preparing;
                    return input;
                }
                self.state.activity = Activity::Fighting;
                input.flight_mode = false;
                input.autogun_active = true;
                input.laser_active = true;
                input.plasma_active = true;
                input.target_id = Some(target.entity_id);
                let firing_distance = match weapon {
                    AttackWeapon::Beam { range } => rules.firing_distance.min(range),
                    AttackWeapon::Projectile { .. } => rules.firing_distance,
                    AttackWeapon::None => 0.0,
                };
                (input.thrust, input.turn, input.fire) = self.pilot.attack(
                    context,
                    target,
                    AttackOptions {
                        pass_distance: rules.pass_distance,
                        aim_tolerance: rules.aim_tolerance,
                        weapon,
                        aim_prediction_time: 1.0,
                        can_fire: distance < firing_distance,
                    },
                );
                return input;
            }
            self.state.activity = Activity::Pursuing;
            (input.thrust, input.turn) = self
                .pilot
                .steer(context, &pursuit(target, rules.pass_distance));
            return input;
        }
        if self.state.target_id.is_some() {
            self.state.search.heading = context.ship.rotation;
            self.state.search.angle = 0.0;
        }
        self.state.target_id = None;
        self.state.combat_at = 0;
        let movement = if self.state.visited {
            self.state.activity = Activity::Search;
            self.state.search.movement(context)
        } else {
            self.state.activity = Activity::Pursuing;
            Movement {
                position: self.state.destination,
                ..Movement::default()
            }
        };
        (input.thrust, input.turn) = self.pilot.steer(context, &movement);
        input
    }
}

fn timer(tick: u64, interval: f64, catalog: &Catalog) -> TickTimerOptions {
    TickTimerOptions {
        tick,
        interval,
        interval_max: 0.0,
        step: catalog.simulation.simulation_step,
    }
}

fn pursuit(target: FlightTarget, pass_distance: f64) -> Movement {
    Movement {
        position: target.position,
        velocity: target.velocity,
        pass_distance,
        target_id: target.entity_id,
        ..Movement::default()
    }
}

fn active_ship<'a>(
    environment: &'a impl MarauderEnvironment,
    player: PlayerView<'_>,
) -> Option<&'a Ship> {
    let ship = environment.ship(player.ship_id)?;
    (player.connected
        && environment.observer_exists(player.observer_id)
        && !ship.craft.object.dead
        && ship.craft.docked_to.is_none()
        && ship.craft.transit_time == 0.0)
        .then_some(ship)
}
