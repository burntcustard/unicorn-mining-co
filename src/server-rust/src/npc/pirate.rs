//! Pirate cargo demands, retaliation, search, and return flights.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::protocol::{Input, SimulationEvent, StationDescription};
use crate::specs::Catalog;
use crate::utilities::{TickTimerOptions, tick_due};
use crate::vector::Vector;

use super::collection::collection_hatch;
use super::flight::{AttackOptions, FlightTarget, Movement, Pilot};
use super::navigation::{DockingGuide, Search};
use super::prediction::ShipMotion;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub enum Activity {
    #[default]
    Pursuing,
    Waiting,
    Fighting,
    Search,
    Collecting,
    Returning,
    Docked,
    Stranded,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct State {
    pub search: Search,
    pub destination: Vector,
    pub credits: f64,
    pub victim_ship_id: i64,
    pub victim_visible: bool,
    pub player_seen: bool,
    pub following: bool,
    pub home: StationDescription,
    pub home_id: i64,
    pub activity: Activity,
    pub spawned_at: f64,
    pub warned_at: f64,
    pub think_after: f64,
    pub search_started_at: f64,
    pub search_expired: bool,
    pub defeated: bool,
    pub attack_after: f64,
    pub taunt_after: f64,
    pub collect_after: f64,
    pub re_demand_after: f64,
    pub victim_releasing_cargo: bool,
    pub cargo_accepted: bool,
    pub countdown: i32,
    pub input: Input,
}

#[derive(Clone, Debug)]
pub struct Player {
    pub account: String,
    pub display_name: String,
    pub observer_id: i64,
    pub connected: bool,
    pub encounter_after: u64,
    pub ship: ShipView,
}

#[derive(Clone, Debug, Default)]
pub struct ShipView {
    pub id: i64,
    pub name: String,
    pub observer_id: i64,
    pub motion: ShipMotion,
    pub dead: bool,
    pub resident: bool,
    pub docked: bool,
    pub launching: bool,
    pub in_transit: bool,
    pub stranded: bool,
    pub has_hatch: bool,
    pub has_cannon: bool,
    pub releasing_cargo: bool,
    pub mined_cargo_value: f64,
    pub cargo_space: usize,
    pub cargo: Vec<Cargo>,
}

impl ShipView {
    fn target(&self) -> FlightTarget {
        FlightTarget {
            entity_id: self.id,
            position: self.motion.position,
            velocity: self.motion.velocity,
            radius: self.motion.radius,
            is_ship: true,
        }
    }

    fn available(&self) -> bool {
        self.resident && !self.dead && !self.docked && !self.in_transit
    }

    fn holds(&self, id: i64) -> bool {
        self.cargo.iter().any(|item| item.id == id)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Cargo {
    pub id: i64,
    pub item: bool,
    pub rounds: bool,
    pub price: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct LootView {
    pub position: Vector,
    pub velocity: Vector,
    pub dead: bool,
}

pub struct SpawnRequest<'a> {
    pub ship: &'static str,
    pub names: &'a [String],
    pub home: &'a StationDescription,
    pub credits: f64,
    pub ammunition: &'static str,
}

pub struct SpawnedPirate {
    pub ship_id: i64,
    pub observer_id: i64,
    pub home_id: i64,
    pub ammunition_id: i64,
}

pub trait PirateEnvironment {
    fn tick(&self) -> u64;
    fn players(&self) -> impl Iterator<Item = Player>;
    fn player(&self, account: &str) -> Option<Player>;
    fn all_player_identities(&self) -> impl Iterator<Item = (String, i64)>;
    fn observer_ship(&self, observer: i64) -> Option<ShipView>;
    fn ship(&self, id: i64) -> Option<ShipView>;
    fn loot(&self, id: i64) -> Option<LootView>;
    fn can_see(&self, ship: i64, target: i64) -> bool;
    fn nearest_station(&mut self, position: Vector) -> Option<StationDescription>;
    fn set_cooldown(&mut self, account: &str, tick: u64);
    fn spawn(&mut self, request: SpawnRequest<'_>) -> Option<SpawnedPirate>;
    fn remove(&mut self, ship: i64, observer: i64);
    fn set_input(&mut self, observer: i64, input: Input);
    fn set_state(&mut self, ship: i64, activity: Activity);
    fn cargo_demand(&mut self, ship: i64, victim: &str, active: bool);
    fn release_cargo(&mut self, ship: i64) -> bool;
    fn sell_cargo(&mut self, ship: i64, credits: &mut f64, exclude: Option<i64>);
    fn say(&mut self, ship: i64, lines: &[String], replacements: &[(&str, &str)]);
    fn steer(&mut self, ship: i64, pilot: &mut Pilot, movement: &Movement) -> (f64, f64);
    fn search(&mut self, ship: i64, pilot: &mut Pilot, search: &mut Search) -> (f64, f64);
    fn attack(
        &mut self,
        ship: i64,
        pilot: &mut Pilot,
        target: FlightTarget,
        options: AttackOptions,
    ) -> (f64, f64, bool);
    fn return_movement(
        &mut self,
        ship: i64,
        home: &StationDescription,
        home_id: i64,
        guide: &mut DockingGuide,
    ) -> Movement;
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SavedPirate {
    pub ship_id: i64,
    pub state: State,
    pub victim: String,
    pub aggressors: Vec<String>,
    pub aggressor_ships: Vec<i64>,
    pub loot: Vec<i64>,
    pub loot_target: Option<i64>,
    pub ammunition: Option<i64>,
}

struct Pirate {
    ship_id: i64,
    observer_id: i64,
    state: State,
    victim: String,
    aggressors: HashSet<i64>,
    loot: Vec<i64>,
    loot_target: Option<i64>,
    ammunition: Option<i64>,
    pilot: Pilot,
    docking: DockingGuide,
}

#[derive(Default)]
pub struct Manager {
    pub dispatch_at: u64,
    pirates: Vec<Pirate>,
}

impl Manager {
    pub fn dispatch(&mut self, catalog: &Catalog, environment: &mut impl PirateEnvironment) {
        let tick = environment.tick();
        let step = catalog.simulation.simulation_step;
        let rules = &catalog.pirate_spec;
        let timer = TickTimerOptions {
            tick,
            step,
            interval: rules.dispatch_interval,
            interval_max: 0.0,
        };
        if !tick_due(&mut self.dispatch_at, timer, || unreachable!()) {
            return;
        }
        let players: Vec<_> = environment
            .players()
            .filter(|player| {
                player.connected
                    && player.ship.available()
                    && player.ship.mined_cargo_value > rules.cargo_value_threshold
                    && tick >= player.encounter_after
            })
            .collect();
        for player in players {
            if self.pirates.iter().any(|npc| npc.victim == player.account) {
                continue;
            }
            let Some(home) = environment
                .nearest_station(player.ship.motion.position)
                .filter(|home| !home.definition_id.is_empty())
            else {
                continue;
            };
            let request = SpawnRequest {
                ship: "courser",
                names: &rules.names,
                home: &home,
                credits: rules.starting_credits,
                ammunition: "autogunAmmo",
            };
            let Some(spawned) = environment.spawn(request) else {
                continue;
            };
            let mut npc = Pirate::new(spawned.ship_id, spawned.observer_id, player.account);
            npc.state = State {
                destination: player.ship.motion.position,
                credits: rules.starting_credits,
                victim_ship_id: player.ship.id,
                home,
                home_id: spawned.home_id,
                spawned_at: tick as f64 * step,
                ..State::default()
            };
            npc.ammunition = Some(spawned.ammunition_id);
            environment.set_state(npc.ship_id, npc.state.activity);
            self.pirates.push(npc);
        }
    }

    pub fn update(&mut self, catalog: &Catalog, environment: &mut impl PirateEnvironment) {
        let tick = environment.tick();
        let now = tick as f64 * catalog.simulation.simulation_step;
        self.pirates
            .retain_mut(|npc| npc.update(tick, now, catalog, environment));
    }

    pub fn ship_ids(&self) -> impl Iterator<Item = i64> + '_ {
        self.pirates.iter().map(|npc| npc.ship_id)
    }

    pub fn hits(
        &mut self,
        events: &[SimulationEvent],
        catalog: &Catalog,
        environment: &mut impl PirateEnvironment,
    ) {
        let now = environment.tick() as f64 * catalog.simulation.simulation_step;
        for event in events {
            let (target, by) = match event {
                SimulationEvent::CollisionEvent { b, by, damage, .. }
                    if *by != 0 && damage[1] > 0.0 =>
                {
                    (*b, *by)
                }
                SimulationEvent::LaserDamage {
                    target_id,
                    by,
                    damage,
                    ..
                }
                | SimulationEvent::DrillDamage {
                    target_id,
                    by,
                    damage,
                    ..
                } if *damage > 0.0 => (*target_id, *by),
                _ => continue,
            };
            let Some(source) = environment
                .observer_ship(by)
                .filter(|ship| ship.available() && !ship.launching)
            else {
                continue;
            };
            for npc in &mut self.pirates {
                if npc.ship_id != target
                    || by == npc.observer_id
                    || npc.state.defeated
                    || !environment
                        .ship(npc.ship_id)
                        .is_some_and(|ship| !ship.dead && !ship.docked)
                {
                    continue;
                }
                let ongoing = npc.state.activity == Activity::Fighting
                    || npc.state.attack_after > 0.0
                    || npc.state.taunt_after > 0.0;
                let lines = npc.retaliation_dialog(source.observer_id, catalog, environment);
                npc.aggressors.insert(by);
                npc.state.think_after = 0.0;
                if npc.collecting() || !ongoing {
                    npc.begin_attack(now, catalog, environment, lines);
                }
            }
        }
    }

    pub fn items_collected(
        &mut self,
        events: &[SimulationEvent],
        catalog: &Catalog,
        environment: &mut impl PirateEnvironment,
    ) {
        let tick = environment.tick();
        let now = tick as f64 * catalog.simulation.simulation_step;
        for event in events {
            let SimulationEvent::ItemCollected { by, item_id, .. } = event else {
                continue;
            };
            let Some(player) = environment.players().find(|player| {
                player.observer_id == *by && player.connected && player.ship.available()
            }) else {
                continue;
            };
            for npc in &mut self.pirates {
                if npc.state.defeated
                    || !npc.state.cargo_accepted
                    || !npc.collecting()
                    || !npc.loot.contains(item_id)
                    || !environment
                        .ship(npc.ship_id)
                        .is_some_and(|ship| !ship.dead && !ship.docked)
                {
                    continue;
                }
                environment.cargo_demand(npc.ship_id, &npc.victim, false);
                if npc.victim != player.account {
                    environment.set_cooldown(&npc.victim, cooldown(tick, catalog));
                }
                npc.victim.clone_from(&player.account);
                let state = &mut npc.state;
                state.victim_ship_id = player.ship.id;
                state.victim_visible = environment.can_see(npc.ship_id, player.ship.id);
                state.destination = player.ship.motion.position;
                state.victim_releasing_cargo = player.ship.releasing_cargo;
                state.activity = Activity::Waiting;
                state.think_after = 0.0;
                state.countdown = -1;
                state.collect_after = 0.0;
                state.attack_after = 0.0;
                state.taunt_after = 0.0;
                state.cargo_accepted = false;
                state.search_expired = false;
                state.following = false;
                state.spawned_at = now;
                state.re_demand_after = now + catalog.pirate_spec.loot_theft_delay;
                npc.aggressors.clear();
                state.input.fire = false;
                environment.set_state(npc.ship_id, state.activity);
                environment.say(npc.ship_id, &catalog.pirate_dialog.loot_stolen, &[]);
            }
        }
    }

    pub fn capture(&self, environment: &impl PirateEnvironment) -> Vec<SavedPirate> {
        self.pirates
            .iter()
            .filter(|npc| {
                environment
                    .ship(npc.ship_id)
                    .is_some_and(|ship| !ship.dead && ship.resident)
            })
            .map(|npc| {
                let mut outstanding = npc.aggressors.clone();
                let mut aggressors: Vec<_> = environment
                    .all_player_identities()
                    .filter_map(|(account, observer)| {
                        outstanding.remove(&observer).then_some(account)
                    })
                    .collect();
                let mut aggressor_ships: Vec<_> = outstanding
                    .into_iter()
                    .filter_map(|observer| environment.observer_ship(observer))
                    .map(|ship| ship.id)
                    .collect();
                aggressors.sort();
                aggressor_ships.sort_unstable();
                SavedPirate {
                    ship_id: npc.ship_id,
                    state: npc.state.clone(),
                    victim: npc.victim.clone(),
                    aggressors,
                    aggressor_ships,
                    loot: npc.loot.clone(),
                    loot_target: npc.loot_target,
                    ammunition: npc.ammunition,
                }
            })
            .collect()
    }

    pub fn restore(
        &mut self,
        observer: i64,
        saved: SavedPirate,
        environment: &mut impl PirateEnvironment,
    ) -> bool {
        if environment.player(&saved.victim).is_none() {
            return false;
        }
        let mut npc = Pirate::new(saved.ship_id, observer, saved.victim);
        npc.state = saved.state;
        npc.loot = saved.loot;
        npc.loot_target = saved.loot_target;
        npc.ammunition = saved.ammunition;
        npc.aggressors.extend(
            saved
                .aggressors
                .iter()
                .filter_map(|account| environment.player(account).map(|player| player.observer_id)),
        );
        npc.aggressors.extend(
            saved
                .aggressor_ships
                .iter()
                .filter_map(|&id| environment.ship(id).map(|ship| ship.observer_id)),
        );
        environment.set_input(observer, npc.state.input);
        environment.set_state(npc.ship_id, npc.state.activity);
        self.pirates.push(npc);
        true
    }
}

impl Pirate {
    fn new(ship_id: i64, observer_id: i64, victim: String) -> Self {
        Self {
            ship_id,
            observer_id,
            victim,
            state: State::default(),
            aggressors: HashSet::new(),
            loot: Vec::new(),
            loot_target: None,
            ammunition: None,
            pilot: Pilot::default(),
            docking: DockingGuide::default(),
        }
    }

    fn collecting(&self) -> bool {
        self.state.activity == Activity::Collecting || self.state.collect_after > 0.0
    }

    fn enemy(&mut self, ship: &ShipView, environment: &impl PirateEnvironment) -> Option<ShipView> {
        if ship.docked {
            return None;
        }
        self.aggressors.retain(|&observer| {
            environment
                .observer_ship(observer)
                .is_some_and(|target| !target.dead && target.resident)
        });
        self.aggressors
            .iter()
            .filter_map(|&observer| environment.observer_ship(observer))
            .filter(|target| environment.can_see(ship.id, target.id))
            .min_by(|a, b| {
                ship.motion
                    .position
                    .distance_squared(a.motion.position)
                    .total_cmp(&ship.motion.position.distance_squared(b.motion.position))
                    .then_with(|| a.id.cmp(&b.id))
            })
    }

    fn retaliation_dialog<'a>(
        &self,
        attacker: i64,
        catalog: &'a Catalog,
        environment: &impl PirateEnvironment,
    ) -> &'a [String] {
        let dialog = &catalog.pirate_dialog;
        if self.collecting() {
            if environment
                .player(&self.victim)
                .is_some_and(|victim| victim.observer_id == attacker)
            {
                &dialog.broken_truce
            } else {
                &dialog.defend_loot
            }
        } else {
            &dialog.attack
        }
    }

    fn begin_collection(&mut self, now: f64, catalog: &Catalog) {
        let state = &mut self.state;
        state.re_demand_after = 0.0;
        state.activity = Activity::Waiting;
        state.think_after = 0.0;
        state.countdown = -1;
        state.collect_after = now + catalog.pirate_spec.collect_delay;
        state.cargo_accepted = true;
        if self.aggressors.is_empty() {
            state.attack_after = 0.0;
            state.taunt_after = 0.0;
        }
    }

    fn begin_attack(
        &mut self,
        now: f64,
        catalog: &Catalog,
        environment: &mut impl PirateEnvironment,
        lines: &[String],
    ) {
        let state = &mut self.state;
        state.re_demand_after = 0.0;
        if state.activity != Activity::Stranded {
            state.activity = Activity::Waiting;
        }
        state.attack_after = now + catalog.pirate_spec.attack_delay;
        state.collect_after = 0.0;
        state.think_after = 0.0;
        state.countdown = -1;
        state.input.fire = false;
        environment.set_state(self.ship_id, state.activity);
        environment.say(self.ship_id, lines, &[]);
    }

    fn update_attack(&mut self, now: f64, catalog: &Catalog, environment: &impl PirateEnvironment) {
        self.aggressors.retain(|&observer| {
            environment
                .observer_ship(observer)
                .is_some_and(|ship| ship.resident && !ship.dead)
        });
        let state = &mut self.state;
        if self.aggressors.is_empty() && (state.attack_after > 0.0 || state.taunt_after > 0.0) {
            state.attack_after = 0.0;
            state.taunt_after = 0.0;
            if state.activity == Activity::Fighting
                || state.activity == Activity::Waiting && state.collect_after == 0.0
            {
                if state.cargo_accepted {
                    self.begin_collection(now, catalog);
                } else {
                    state.activity = Activity::Pursuing;
                    state.think_after = 0.0;
                }
            }
        }
        let state = &mut self.state;
        if state.activity == Activity::Waiting
            && state.attack_after > 0.0
            && now + 1e-9 >= state.attack_after
        {
            state.activity = Activity::Fighting;
            state.think_after = 0.0;
        }
    }

    fn update_warning(
        &mut self,
        now: f64,
        victim: &Player,
        catalog: &Catalog,
        environment: &mut impl PirateEnvironment,
    ) {
        let (rules, dialog) = (&catalog.pirate_spec, &catalog.pirate_dialog);
        let state = &mut self.state;
        if state.collect_after > 0.0 || state.attack_after > 0.0 {
            return;
        }
        if state.re_demand_after > 0.0 {
            if now + 1e-9 < state.re_demand_after {
                return;
            }
            state.warned_at = state.re_demand_after + rules.re_demand_delay - rules.demand_delay;
            state.re_demand_after = 0.0;
            state.countdown = rules.countdown_from + 1;
            environment.say(self.ship_id, &dialog.cargo_re_demand, &[]);
            environment.cargo_demand(self.ship_id, &self.victim, true);
        }
        let elapsed = now - state.warned_at + 1e-9;
        let remaining =
            (rules.demand_delay + f64::from(rules.countdown_from) - elapsed).ceil() as i32;
        let end = rules.demand_delay + f64::from(rules.countdown_from - 1) + rules.countdown_pause;
        if remaining <= rules.countdown_from && remaining > 0 && remaining < state.countdown {
            state.countdown = remaining;
            environment.say(
                self.ship_id,
                &dialog.countdown,
                &[("{seconds}", &remaining.to_string())],
            );
        }
        if elapsed >= end && state.countdown > 0 {
            state.countdown = 0;
            environment.say(self.ship_id, &dialog.countdown_end, &[]);
        }
        if elapsed >= end + rules.countdown_pause && state.countdown == 0 {
            self.aggressors.insert(victim.observer_id);
            self.begin_attack(now, catalog, environment, &dialog.attack);
        }
    }

    fn call_off_docked(&mut self, environment: &mut impl PirateEnvironment, catalog: &Catalog) {
        let docked: Vec<_> = environment
            .players()
            .filter(|player| player.ship.docked)
            .collect();
        for player in docked {
            let victim =
                player.account == self.victim && player.ship.id == self.state.victim_ship_id;
            if !(self.aggressors.contains(&player.observer_id)
                || victim && self.state.activity <= Activity::Search && !self.state.cargo_accepted)
            {
                continue;
            }
            environment.say(
                self.ship_id,
                &catalog.pirate_dialog.escaped,
                &[("{player}", &player.display_name)],
            );
            self.aggressors.remove(&player.observer_id);
            self.state.think_after = 0.0;
            if victim {
                environment.cargo_demand(self.ship_id, &self.victim, false);
                self.state.victim_visible = false;
                self.loot.clear();
                self.state.collect_after = 0.0;
                self.state.re_demand_after = 0.0;
                self.state.cargo_accepted = false;
                if self.state.activity != Activity::Stranded && self.aggressors.is_empty() {
                    self.state.activity = Activity::Returning;
                }
            }
        }
    }

    fn observe(
        &mut self,
        ship: &ShipView,
        now: f64,
        catalog: &Catalog,
        environment: &mut impl PirateEnvironment,
    ) {
        let returning = self.state.activity == Activity::Returning && self.state.search_expired;
        if self.state.activity > Activity::Search && !returning {
            return;
        }
        let Some(victim) = environment.player(&self.victim) else {
            return;
        };
        self.state.victim_visible = victim.ship.id == self.state.victim_ship_id
            && victim.connected
            && environment.can_see(ship.id, victim.ship.id);
        self.state.player_seen |= self.state.victim_visible;
        if self.state.collect_after > 0.0 || self.state.re_demand_after > 0.0 {
            return;
        }
        let enemy = self.enemy(ship, environment);
        let state = &mut self.state;
        if now + 1e-9 < state.attack_after {
            if let Some(enemy) = enemy {
                state.destination = enemy.motion.position;
            }
            return;
        }
        if !state.victim_visible
            && matches!(state.activity, Activity::Waiting | Activity::Fighting)
            && !victim.ship.releasing_cargo
        {
            environment.cargo_demand(self.ship_id, &self.victim, false);
            state.activity = Activity::Pursuing;
        }
        if let Some(enemy) = enemy {
            if returning {
                state.spawned_at = now;
            }
            state.search_expired = false;
            state.player_seen = true;
            state.destination = enemy.motion.position;
            state.activity = Activity::Fighting;
            return;
        }
        let hostile = self.aggressors.contains(&victim.observer_id);
        if state.victim_visible && (self.aggressors.is_empty() || hostile) {
            state.destination = victim.ship.motion.position;
            if returning {
                state.spawned_at = now;
            }
            if state.activity == Activity::Search || returning {
                state.activity = Activity::Pursuing;
            }
            state.search_expired = false;
            if hostile {
                state.activity = Activity::Fighting;
            }
            return;
        }
        if matches!(state.activity, Activity::Waiting | Activity::Fighting) {
            state.activity = Activity::Pursuing;
        }
        let radius = catalog.pirate_spec.report_arrival_distance;
        if state.activity == Activity::Pursuing
            && ship.motion.position.distance_squared(state.destination) <= radius * radius
        {
            state.activity = Activity::Search;
            state.search_started_at = now;
            state.search = Search {
                origin: state.destination,
                heading: ship.motion.rotation,
                angle: 0.0,
            };
            let lines = if state.player_seen {
                &catalog.pirate_dialog.lost_player
            } else {
                &catalog.pirate_dialog.search
            };
            environment.say(self.ship_id, lines, &[]);
            return;
        }
        if state.activity != Activity::Search && !returning {
            return;
        }
        let nearest = environment
            .players()
            .filter(|player| {
                player.connected
                    && (self.aggressors.is_empty() || self.aggressors.contains(&player.observer_id))
                    && environment.can_see(ship.id, player.ship.id)
            })
            .min_by(|a, b| {
                ship.motion
                    .position
                    .distance_squared(a.ship.motion.position)
                    .total_cmp(
                        &ship
                            .motion
                            .position
                            .distance_squared(b.ship.motion.position),
                    )
            });
        if let Some(player) = nearest {
            if returning {
                state.spawned_at = now;
            }
            state.search_expired = false;
            if self.victim != player.account {
                environment.set_cooldown(&self.victim, cooldown(environment.tick(), catalog));
            }
            if self.victim != player.account || state.victim_ship_id != player.ship.id {
                self.loot.clear();
                state.victim_releasing_cargo = false;
                state.cargo_accepted = false;
            }
            self.victim = player.account;
            state.victim_ship_id = player.ship.id;
            state.player_seen = true;
            state.activity = Activity::Pursuing;
            state.destination = player.ship.motion.position;
            state.victim_visible = true;
        } else if state.activity == Activity::Search
            && now - state.search_started_at + 1e-9 >= catalog.pirate_spec.search_duration
        {
            environment.say(self.ship_id, &catalog.pirate_dialog.search_expired, &[]);
            state.activity = Activity::Returning;
            self.loot.clear();
            state.search_expired = true;
        }
    }

    fn update(
        &mut self,
        tick: u64,
        now: f64,
        catalog: &Catalog,
        environment: &mut impl PirateEnvironment,
    ) -> bool {
        let (rules, dialog) = (&catalog.pirate_spec, &catalog.pirate_dialog);
        let Some(ship) = environment.ship(self.ship_id) else {
            self.remove(tick, catalog, environment);
            return false;
        };
        if ship.dead {
            environment.say(self.ship_id, &dialog.destroyed, &[]);
        }
        if ship.docked && !ship.dead {
            self.state.activity = Activity::Docked;
            environment.sell_cargo(self.ship_id, &mut self.state.credits, self.ammunition);
        }
        let mut remove = ship.dead || ship.docked || !ship.resident;
        if !remove && !self.state.defeated && (!ship.has_hatch || !ship.has_cannon) {
            let state = &mut self.state;
            state.defeated = true;
            state.activity = Activity::Returning;
            state.think_after = 0.0;
            state.collect_after = 0.0;
            state.attack_after = 0.0;
            state.taunt_after = 0.0;
            state.re_demand_after = 0.0;
            state.search_expired = false;
            state.victim_visible = false;
            self.loot.clear();
            self.aggressors.clear();
            environment.cargo_demand(self.ship_id, &self.victim, false);
            if let Some(victim) = environment.player(&self.victim) {
                environment.say(
                    self.ship_id,
                    &dialog.defeat,
                    &[("{player}", &victim.display_name)],
                );
            }
        }
        let elapsed = now - self.state.spawned_at;
        if !remove
            && elapsed > rules.encounter_duration
            && !matches!(self.state.activity, Activity::Search | Activity::Returning)
        {
            let releasable = environment.release_cargo(self.ship_id);
            if releasable && elapsed < rules.encounter_duration + rules.cargo_release_timeout {
                environment.set_input(
                    self.observer_id,
                    Input {
                        cargo_hatch: true,
                        ..Input::default()
                    },
                );
                return true;
            }
            remove = true;
        }
        if remove {
            self.remove(tick, catalog, environment);
            return false;
        }
        if ship.stranded && self.state.activity != Activity::Stranded {
            self.state.activity = Activity::Stranded;
            self.state.think_after = 0.0;
            self.state.collect_after = 0.0;
            self.state.re_demand_after = 0.0;
            environment.cargo_demand(self.ship_id, &self.victim, false);
            environment.say(self.ship_id, &dialog.stranded, &[]);
        } else if self.state.activity == Activity::Stranded && !ship.stranded {
            self.state.activity = Activity::Returning;
            self.state.think_after = 0.0;
        }
        self.call_off_docked(environment, catalog);
        self.update_attack(now, catalog, environment);
        if self.state.collect_after > 0.0 && now + 1e-9 >= self.state.collect_after {
            self.state.activity = Activity::Collecting;
            self.state.collect_after = 0.0;
            self.state.think_after = 0.0;
        }
        if now + 1e-9 >= self.state.think_after {
            self.observe(&ship, now, catalog, environment);
        }
        let Some(victim) = environment.player(&self.victim) else {
            self.remove(tick, catalog, environment);
            return false;
        };
        self.track_surrender(&ship, &victim, now, catalog, environment);
        if self.state.activity == Activity::Waiting {
            self.update_warning(now, &victim, catalog, environment);
        }
        if now + 1e-9 >= self.state.think_after {
            self.state.think_after = now + catalog.npc_movement.decision_interval;
            self.state.input = self.input_for(&ship, &victim, now, catalog, environment);
        }
        if self.aggressors.is_empty() && self.state.activity != Activity::Fighting {
            self.state.input.fire = false;
        }
        environment.set_input(self.observer_id, self.state.input);
        environment.set_state(self.ship_id, self.state.activity);
        true
    }

    fn track_surrender(
        &mut self,
        ship: &ShipView,
        victim: &Player,
        now: f64,
        catalog: &Catalog,
        environment: &mut impl PirateEnvironment,
    ) {
        let (rules, dialog) = (&catalog.pirate_spec, &catalog.pirate_dialog);
        let state = &mut self.state;
        let releasing = victim.ship.releasing_cargo;
        let new_release = releasing && !state.victim_releasing_cargo;
        state.victim_releasing_cargo = releasing;
        if state.activity <= Activity::Fighting
            && state.victim_visible
            && (now + 1e-9 >= state.think_after || releasing)
        {
            for cargo in &victim.ship.cargo {
                if cargo.item
                    && !cargo.rounds
                    && cargo.price > 0.0
                    && !self.loot.contains(&cargo.id)
                {
                    self.loot.push(cargo.id);
                }
            }
        }
        let available =
            victim.ship.id == state.victim_ship_id && victim.connected && victim.ship.available();
        if state.activity <= Activity::Fighting && state.collect_after == 0.0 {
            let claimed = self.loot.iter().any(|&item| victim.ship.holds(item));
            if new_release
                || state.victim_visible
                    && victim.ship.mined_cargo_value == 0.0
                    && !claimed
                    && self.aggressors.is_empty()
                || victim.ship.dead && !state.cargo_accepted
            {
                if new_release {
                    if state.activity == Activity::Fighting {
                        environment.say(self.ship_id, &dialog.late_surrender, &[]);
                    } else if state.activity == Activity::Waiting {
                        environment.say(self.ship_id, &dialog.surrender, &[]);
                    }
                    self.aggressors.remove(&victim.observer_id);
                }
                environment.cargo_demand(self.ship_id, &self.victim, false);
                self.begin_collection(now, catalog);
            } else if !available && !state.cargo_accepted {
                environment.cargo_demand(self.ship_id, &self.victim, false);
                self.aggressors.remove(&victim.observer_id);
                state.think_after = 0.0;
                if self.aggressors.is_empty() {
                    state.activity = Activity::Returning;
                }
                self.loot.clear();
                state.cargo_accepted = false;
                state.re_demand_after = 0.0;
            }
        }
        let state = &mut self.state;
        if state.activity == Activity::Pursuing
            && state.victim_visible
            && self.aggressors.is_empty()
            && ship
                .motion
                .position
                .distance_squared(victim.ship.motion.position)
                <= rules.follow_start_distance * rules.follow_start_distance
        {
            state.activity = Activity::Waiting;
            state.warned_at = now;
            state.countdown = rules.countdown_from + 1;
            state.following = false;
            state.think_after = 0.0;
            environment.say(self.ship_id, &dialog.cargo_demand, &[]);
            environment.cargo_demand(self.ship_id, &self.victim, true);
        }
    }

    fn input_for(
        &mut self,
        ship: &ShipView,
        victim: &Player,
        now: f64,
        catalog: &Catalog,
        environment: &mut impl PirateEnvironment,
    ) -> Input {
        let (rules, dialog) = (&catalog.pirate_spec, &catalog.pirate_dialog);
        let mut input = Input {
            autogun_active: true,
            ..Input::default()
        };
        let enemy = self.enemy(ship, environment);
        if enemy.is_none() && self.state.activity >= Activity::Collecting {
            self.state.attack_after = 0.0;
        }
        if let Some(enemy) = &enemy
            && self.state.activity != Activity::Fighting
            && self.state.attack_after == 0.0
            && self.state.taunt_after == 0.0
        {
            let lines = self.retaliation_dialog(enemy.observer_id, catalog, environment);
            self.begin_attack(now, catalog, environment, lines);
        }
        let announcing = now + 1e-9 < self.state.attack_after;
        self.combat_dialog(enemy.is_some() && !announcing, now, catalog, environment);
        if let Some(enemy) = &enemy
            && !announcing
        {
            if self.state.activity != Activity::Stranded {
                self.state.activity = Activity::Fighting;
            }
            self.state.collect_after = 0.0;
            let projectile_speed = catalog.module_specs["cannonSm"].projectile.speed;
            let options = AttackOptions {
                pass_distance: rules.pass_distance,
                aim_tolerance: rules.aim_tolerance,
                projectile_speed,
                aim_prediction_time: rules.aim_prediction_time,
                can_fire: ship.motion.position.distance_squared(enemy.motion.position)
                    < rules.firing_distance * rules.firing_distance,
            };
            (input.thrust, input.turn, input.fire) =
                environment.attack(self.ship_id, &mut self.pilot, enemy.target(), options);
            return input;
        }
        if self.state.activity == Activity::Stranded {
            return input;
        }
        if self.state.collect_after > 0.0 {
            input.autogun_active = false;
            let movement = Movement {
                position: self.state.destination,
                waiting: true,
                ..Movement::default()
            };
            return self.steer(input, &movement, environment);
        }
        if self.state.activity == Activity::Waiting || announcing {
            if enemy.is_none() && !self.state.victim_visible {
                let movement = Movement {
                    position: self.state.destination,
                    waiting: true,
                    ..Movement::default()
                };
                return self.steer(input, &movement, environment);
            }
            let target = if announcing {
                enemy.as_ref().unwrap_or(&victim.ship)
            } else {
                &victim.ship
            };
            let distance = ship.motion.position.distance(target.motion.position);
            if distance > rules.follow_start_distance {
                self.state.following = true;
            } else if distance <= rules.follow_distance + 8.0
                && target.motion.velocity.length() < 10.0
                && (ship.motion.velocity - target.motion.velocity).length() < 10.0
            {
                self.state.following = false;
            }
            let movement = Movement {
                position: target.motion.position,
                velocity: target.motion.velocity,
                target_id: target.id,
                follow_distance: rules.follow_distance,
                waiting: !self.state.following,
                ..Movement::default()
            };
            return self.steer(input, &movement, environment);
        }
        if self.state.activity == Activity::Search {
            (input.thrust, input.turn) =
                environment.search(self.ship_id, &mut self.pilot, &mut self.state.search);
            return input;
        }
        if self.state.activity == Activity::Pursuing {
            let mut movement = Movement {
                position: self.state.destination,
                ..Movement::default()
            };
            if self.state.victim_visible
                && (self.aggressors.is_empty() || self.aggressors.contains(&victim.observer_id))
            {
                movement.velocity = victim.ship.motion.velocity;
                movement.follow_distance = rules.follow_distance;
                movement.target_id = victim.ship.id;
            }
            return self.steer(input, &movement, environment);
        }
        if self.state.activity == Activity::Collecting {
            let mut best = f64::INFINITY;
            let mut nearest = None;
            let mut waiting = false;
            self.loot.retain(|&id| {
                let held = victim.ship.holds(id);
                let loose = environment.loot(id);
                if !held && loose.is_none_or(|item| item.dead) {
                    return false;
                }
                waiting |= held;
                if let Some(item) = loose
                    && (nearest.is_none()
                        || nearest.is_some_and(|(id, _)| Some(id) != self.loot_target))
                {
                    let distance = ship.motion.position.distance_squared(item.position);
                    if Some(id) == self.loot_target || distance < best {
                        best = distance;
                        nearest = Some((id, item));
                    }
                }
                true
            });
            self.loot_target = nearest.map(|(id, _)| id);
            let full = ship.cargo.len() >= ship.cargo_space;
            if let Some((id, item)) = nearest
                && !full
            {
                input.cargo_hatch =
                    collection_hatch(ship.motion, ship.motion.model_radius, item.position);
                input.autogun_active = false;
                let movement = Movement {
                    position: item.position,
                    velocity: item.velocity,
                    ignore_id: id,
                    collect: true,
                    ..Movement::default()
                };
                return self.steer(input, &movement, environment);
            }
            if !full && victim.ship.releasing_cargo && waiting {
                input.autogun_active = false;
                input.cargo_hatch = collection_hatch(
                    ship.motion,
                    ship.motion.model_radius,
                    victim.ship.motion.position,
                );
                return input;
            }
            if full {
                environment.say(self.ship_id, &dialog.cargo_full, &[]);
            } else if ship
                .cargo
                .iter()
                .any(|item| Some(item.id) != self.ammunition && item.price > 0.0)
            {
                environment.say(
                    self.ship_id,
                    &dialog.successful_haul,
                    &[("{player_name}", &victim.ship.name)],
                );
            }
            self.state.activity = Activity::Returning;
        }
        if self.state.activity == Activity::Returning {
            input.autogun_active = false;
            let movement = environment.return_movement(
                self.ship_id,
                &self.state.home,
                self.state.home_id,
                &mut self.docking,
            );
            return self.steer(input, &movement, environment);
        }
        input
    }

    fn steer(
        &mut self,
        mut input: Input,
        movement: &Movement,
        environment: &mut impl PirateEnvironment,
    ) -> Input {
        (input.thrust, input.turn) = environment.steer(self.ship_id, &mut self.pilot, movement);
        input
    }

    fn combat_dialog(
        &mut self,
        attacking: bool,
        now: f64,
        catalog: &Catalog,
        environment: &mut impl PirateEnvironment,
    ) {
        let state = &mut self.state;
        if !attacking {
            if self.aggressors.is_empty() || state.activity >= Activity::Collecting {
                state.taunt_after = 0.0;
            }
            return;
        }
        if state.taunt_after == 0.0 {
            state.taunt_after = now + catalog.pirate_spec.taunt_interval;
        } else if now + 1e-9 >= state.taunt_after {
            environment.say(self.ship_id, &catalog.pirate_dialog.taunt, &[]);
            state.taunt_after = now + catalog.pirate_spec.taunt_interval;
        }
    }

    fn remove(&self, tick: u64, catalog: &Catalog, environment: &mut impl PirateEnvironment) {
        environment.cargo_demand(self.ship_id, &self.victim, false);
        environment.remove(self.ship_id, self.observer_id);
        environment.set_cooldown(&self.victim, cooldown(tick, catalog));
    }
}

fn cooldown(tick: u64, catalog: &Catalog) -> u64 {
    tick + (catalog.pirate_spec.encounter_cooldown / catalog.simulation.simulation_step) as u64
}

#[cfg(test)]
#[path = "pirate_tests.rs"]
mod tests;
