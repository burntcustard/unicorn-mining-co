//! Collector activity, pickup attempts, and on-site inspections.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::protocol::{Input, SimulationEvent, StationDescription};
use crate::simulation::game_object::GameObject;
use crate::specs::Catalog;
use crate::vector::Vector;

use super::collection::pickup_departure;
use super::collector::{PickupItem, eligible, pickup_route, return_waypoints};
use super::flight::{Movement, Pilot};
use super::navigation::{DockingGuide, DockingStation};
use super::prediction::ShipMotion;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub enum Activity {
    #[default]
    Collecting,
    Inspecting,
    Returning,
    Stranded,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Inspection {
    pub item: PickupItem,
    pub arrived_at: f64,
    pub started_at: f64,
    pub announced: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct State {
    pub home: StationDescription,
    pub home_id: i64,
    pub credits: f64,
    pub activity: Activity,
    pub items: Vec<PickupItem>,
    pub target_id: Option<i64>,
    pub attempt_started_at: f64,
    pub think_after: f64,
    pub attempts: HashMap<i64, f64>,
    pub missing: usize,
    pub inspect: Option<Inspection>,
    pub inspected: HashSet<i64>,
    pub hull_segments: usize,
    pub modules: usize,
}

pub struct CollectorShip {
    pub motion: ShipMotion,
    pub dead: bool,
    pub docked: bool,
    pub stranded: bool,
    pub launching: bool,
    pub cargo_contents: Vec<i64>,
    pub cargo_space: usize,
    pub hull_segments: usize,
    pub modules: usize,
}

pub trait CollectorEnvironment {
    fn ship(&self, id: i64) -> Option<CollectorShip>;
    /// Resolve an item in the live or sleeping world.
    fn item(&self, id: i64) -> Option<&GameObject>;
    fn live_items(&self) -> impl Iterator<Item = &GameObject>;
    fn return_station(&self, home: Vector) -> Option<DockingStation<'_>>;
    fn return_movement(
        &mut self,
        ship: i64,
        home: &StationDescription,
        home_id: i64,
        docking: &mut DockingGuide,
    ) -> Movement;
    /// Use the native pilot and its prepared contact forecast for this decision.
    fn steer(
        &mut self,
        ship: i64,
        pilot: &mut Pilot,
        movement: Movement,
        operating_area: Option<(Vector, f64)>,
    ) -> Input;
    fn set_input(&mut self, observer: i64, input: Input);
    fn set_state(&mut self, ship: i64, activity: Activity);
    fn sell_cargo(&mut self, ship: i64, credits: &mut f64);
    fn remove(&mut self, ship: i64, observer: i64);
    fn say(&mut self, ship: i64, lines: &[String], item_name: Option<&str>);
}

pub struct Controller {
    pub ship_id: i64,
    pub observer_id: i64,
    pub state: State,
    pilot: Pilot,
    docking: DockingGuide,
    input: Input,
}

impl Controller {
    pub fn restore(ship_id: i64, observer_id: i64, mut state: State) -> Self {
        state.think_after = 0.0;
        Self {
            ship_id,
            observer_id,
            state,
            pilot: Pilot::default(),
            docking: DockingGuide::default(),
            input: Input::default(),
        }
    }

    /// Return true while the role is still active.
    pub fn update(
        &mut self,
        now: f64,
        catalog: &Catalog,
        environment: &mut impl CollectorEnvironment,
    ) -> bool {
        let Some(ship) = environment.ship(self.ship_id) else {
            environment.remove(self.ship_id, self.observer_id);
            return false;
        };
        if ship.dead || ship.docked {
            if ship.docked && !ship.dead {
                environment.sell_cargo(self.ship_id, &mut self.state.credits);
            }
            environment.remove(self.ship_id, self.observer_id);
            return false;
        }
        if now + 1e-9 >= self.state.think_after {
            self.state.think_after = now + catalog.npc_movement.decision_interval;
            self.input = self.input_for(now, catalog, &ship, environment);
            environment.set_state(self.ship_id, self.state.activity);
        }
        environment.set_input(self.observer_id, self.input);
        true
    }

    pub fn items_collected(&mut self, events: &[SimulationEvent]) {
        for event in events {
            if let SimulationEvent::ItemCollected { item_id, .. } = event {
                for item in self
                    .state
                    .items
                    .iter_mut()
                    .filter(|item| item.id == *item_id)
                {
                    item.taken = true;
                }
            }
        }
    }

    fn input_for(
        &mut self,
        now: f64,
        catalog: &Catalog,
        ship: &CollectorShip,
        environment: &mut impl CollectorEnvironment,
    ) -> Input {
        let rules = &catalog.collector_spec;
        let dialog = &catalog.collector_dialog;
        if ship.stranded {
            if self.state.activity != Activity::Stranded {
                self.state.activity = Activity::Stranded;
                environment.say(self.ship_id, &dialog.stranded, None);
            }
            return Input::default();
        }
        if self.state.activity == Activity::Stranded {
            self.state.activity = Activity::Returning;
        }
        if self.state.activity != Activity::Returning {
            let reason = if ship.cargo_contents.len() >= ship.cargo_space {
                Some(&dialog.cargo_full)
            } else if ship.hull_segments < self.state.hull_segments
                || ship.modules < self.state.modules
            {
                Some(&dialog.damaged)
            } else if ship
                .motion
                .position
                .distance_squared(self.state.home.position)
                > rules.operating_radius * rules.operating_radius
            {
                Some(&dialog.outside_radius)
            } else {
                None
            };
            if let Some(reason) = reason {
                self.return_home(reason, environment);
            }
        }
        if self.state.activity == Activity::Returning {
            return self.return_controls(rules.operating_radius, environment);
        }
        for &id in &ship.cargo_contents {
            self.finish(id);
        }
        if self.state.items.is_empty() {
            self.return_home(&dialog.finished, environment);
            return self.return_controls(rules.operating_radius, environment);
        }
        if ship.launching {
            return Input {
                thrust: 1.0,
                cargo_hatch: true,
                ..Input::default()
            };
        }
        if self.state.inspect.is_some() {
            return self.inspect_item(now, catalog, ship.motion, environment);
        }
        let (item, target) = self.pickup_target(now, ship.motion, environment);
        if now - self.state.attempt_started_at + 1e-9 >= rules.pickup_timeout {
            environment.say(self.ship_id, &dialog.unreachable, Some(&item.name));
            self.finish(item.id);
            return Input::default();
        }
        let distance_squared = ship.motion.position.distance_squared(item.position);
        self.notice(
            now,
            ship.motion.position,
            distance_squared.min(rules.inspection_range * rules.inspection_range),
            environment,
        );
        if self.state.inspect.is_some() {
            return self.inspect_item(now, catalog, ship.motion, environment);
        }
        let Some(velocity) = target else {
            if distance_squared > rules.arrival_distance * rules.arrival_distance {
                return self.steer(
                    Movement {
                        position: item.position,
                        ..Movement::default()
                    },
                    rules.operating_radius,
                    environment,
                );
            }
            self.state.missing += 1;
            let lines = [
                &dialog.missing_first,
                &dialog.missing_second,
                &dialog.missing_third,
                &dialog.missing_fourth,
                &dialog.missing_fifth,
                &dialog.missing_sixth,
            ];
            environment.say(
                self.ship_id,
                lines[self.state.missing.min(lines.len()) - 1],
                None,
            );
            self.finish(item.id);
            if self.state.items.is_empty() {
                self.state.activity = Activity::Returning;
            }
            return Input::default();
        };
        let mut next_positions: Vec<_> = self
            .state
            .items
            .iter()
            .filter(|position| position.id != item.id && !position.taken)
            .filter_map(|position| environment.item(position.id).filter(|item| eligible(item)))
            .map(|item| item.position)
            .collect();
        if next_positions.is_empty() {
            let elapsed = (ship.motion.position.distance(item.position) + ship.motion.model_radius)
                / ship.motion.maximum_speed.max(1.0);
            next_positions = return_waypoints(
                ship.motion,
                self.state.home.position,
                environment.return_station(self.state.home.position),
                elapsed,
                Some(item.position),
            );
        }
        self.steer(
            Movement {
                position: item.position,
                velocity,
                ignore_id: item.id,
                collect: true,
                next_positions,
                ..Movement::default()
            },
            rules.operating_radius,
            environment,
        )
    }

    fn finish(&mut self, id: i64) {
        self.state.inspected.insert(id);
        self.state.attempts.remove(&id);
        self.state.items.retain(|item| item.id != id);
        if self.state.target_id == Some(id) {
            self.state.target_id = None;
            self.state.attempt_started_at = 0.0;
        }
    }

    fn pickup_target(
        &mut self,
        now: f64,
        ship: ShipMotion,
        environment: &impl CollectorEnvironment,
    ) -> (PickupItem, Option<Vector>) {
        let items = &mut self.state.items;
        let positions: Vec<(Vector, Option<Vector>)> = items
            .iter()
            .map(|item| {
                if !item.taken
                    && let Some(target) =
                        environment.item(item.id).filter(|target| eligible(target))
                {
                    return (target.position, Some(target.velocity));
                }
                (item.position, None)
            })
            .collect();
        let current = items
            .iter()
            .position(|item| Some(item.id) == self.state.target_id);
        let mut selected = if let Some(current) = current {
            items[current].position = positions[current].0;
            current
        } else {
            let points: Vec<_> = positions.iter().map(|&(position, _)| position).collect();
            pickup_route(
                ship,
                self.state.home.position,
                environment.return_station(self.state.home.position),
                &points,
            )
            .expect("pickup requires an assigned item")
        };
        if let Some(current) = current
            && positions[current].1.is_some()
        {
            let distance = ship.position.distance(positions[current].0);
            if distance > 300.0_f64.max(ship.model_radius * 6.0) {
                let mut best = pickup_departure(ship, positions[current].0) / 1.3;
                for (index, &(position, target)) in positions.iter().enumerate() {
                    if index == current
                        || target.is_none()
                        || distance < ship.position.distance(position) * 1.8 + 120.0
                    {
                        continue;
                    }
                    let duration = pickup_departure(ship, position);
                    if duration < best {
                        selected = index;
                        best = duration;
                    }
                }
            }
        }
        let id = items[selected].id;
        if self.state.target_id != Some(id) {
            if let Some(previous) = self.state.target_id {
                self.state
                    .attempts
                    .insert(previous, now - self.state.attempt_started_at);
            }
            self.state.target_id = Some(id);
            self.state.attempt_started_at =
                now - self.state.attempts.get(&id).copied().unwrap_or_default();
        }
        items[selected].position = positions[selected].0;
        (items[selected].clone(), positions[selected].1)
    }

    fn notice(
        &mut self,
        now: f64,
        position: Vector,
        mut distance_squared: f64,
        environment: &impl CollectorEnvironment,
    ) {
        let mut nearest = None;
        for object in environment.live_items() {
            if !eligible(object)
                || self.state.inspected.contains(&object.id)
                || self
                    .state
                    .items
                    .iter()
                    .any(|item| item.id == object.id && !item.taken)
            {
                continue;
            }
            let distance = position.distance_squared(object.position);
            if distance < distance_squared {
                nearest = Some(object);
                distance_squared = distance;
            }
        }
        if let Some(object) = nearest {
            self.state.inspect = Some(Inspection {
                item: object.into(),
                arrived_at: 0.0,
                started_at: now,
                announced: false,
            });
            self.state.inspected.insert(object.id);
            self.state.activity = Activity::Inspecting;
        }
    }

    fn inspect_item(
        &mut self,
        now: f64,
        catalog: &Catalog,
        ship: ShipMotion,
        environment: &mut impl CollectorEnvironment,
    ) -> Input {
        let rules = &catalog.collector_spec;
        let inspection = self.state.inspect.as_mut().expect("inspection is active");
        let mut distance = ship.model_radius + rules.inspection_distance;
        let mut velocity = Vector::ZERO;
        if inspection.arrived_at == 0.0
            && now - inspection.started_at + 1e-9 >= rules.pickup_timeout
        {
            environment.say(
                self.ship_id,
                &catalog.collector_dialog.unreachable,
                Some(&inspection.item.name),
            );
            self.state.attempt_started_at += now - inspection.started_at;
            self.state.inspect = None;
            self.state.activity = Activity::Collecting;
            return Input::default();
        }
        if let Some(object) = environment
            .item(inspection.item.id)
            .filter(|object| eligible(object))
        {
            inspection.item.position = object.position;
            distance += object.radius;
            velocity = object.velocity;
        }
        if inspection.arrived_at == 0.0
            && ship.position.distance(inspection.item.position) <= distance + 5.0
            && (ship.velocity - velocity).length() < 10.0
        {
            inspection.arrived_at = now;
        }
        if inspection.arrived_at > 0.0 {
            let elapsed = now - inspection.arrived_at + 1e-9;
            if !inspection.announced && elapsed >= rules.inspection_delay {
                inspection.announced = true;
                environment.say(self.ship_id, &catalog.collector_dialog.unlisted, None);
            }
            if elapsed >= rules.inspection_duration {
                if self.state.target_id.is_some() {
                    self.state.attempt_started_at += now - inspection.started_at;
                }
                self.state.inspect = None;
                self.state.activity = Activity::Collecting;
                return Input::default();
            }
        }
        let movement = Movement {
            position: inspection.item.position,
            velocity,
            follow_distance: distance,
            target_id: inspection.item.id,
            waiting: inspection.arrived_at > 0.0,
            ..Movement::default()
        };
        self.steer(movement, rules.operating_radius, environment)
    }

    fn return_home(&mut self, reason: &[String], environment: &mut impl CollectorEnvironment) {
        self.state.activity = Activity::Returning;
        self.state.inspect = None;
        environment.say(self.ship_id, reason, None);
    }

    fn return_controls(
        &mut self,
        radius: f64,
        environment: &mut impl CollectorEnvironment,
    ) -> Input {
        let movement = environment.return_movement(
            self.ship_id,
            &self.state.home,
            self.state.home_id,
            &mut self.docking,
        );
        self.steer(movement, radius, environment)
    }

    fn steer(
        &mut self,
        movement: Movement,
        radius: f64,
        environment: &mut impl CollectorEnvironment,
    ) -> Input {
        let area = (self.state.activity != Activity::Returning)
            .then_some((self.state.home.position, radius));
        environment.steer(self.ship_id, &mut self.pilot, movement, area)
    }
}
