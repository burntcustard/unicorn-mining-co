//! Collector assignment clocks and pickup route scoring.

use std::collections::{HashMap, HashSet, VecDeque};
use std::f64::consts::SQRT_2;

use serde::{Deserialize, Serialize};

use crate::protocol::{SimulationEvent, StationDescription};
use crate::simulation::game_object::GameObject;
use crate::specs::{Catalog, Collector};
use crate::utilities::vector::Vector;
use crate::utilities::{TickTimerOptions, next_tick, tick_due};

use super::collection::pickup_departure;
use super::flight::direction_of;
use super::navigation::DockingStation;
use super::prediction::ShipMotion;
use super::steering::heading_error;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PickupItem {
    pub id: i64,
    pub position: Vector,
    pub name: String,
    pub taken: bool,
}

impl From<&GameObject> for PickupItem {
    fn from(item: &GameObject) -> Self {
        Self {
            id: item.id,
            position: item.position,
            name: item.name.clone(),
            taken: false,
        }
    }
}

pub fn eligible(item: &GameObject) -> bool {
    item.item && !item.dead && !item.buried && item.message.is_none() && item.unlock.is_empty()
}

fn dispatchable(item: &GameObject) -> bool {
    eligible(item) && item.velocity == Vector::ZERO
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct StationDispatch {
    pub home: StationDescription,
    pub home_id: i64,
    pub check_at: u64,
    pub seen: HashSet<i64>,
    pub queue: VecDeque<Vec<PickupItem>>,
    pub launch_at: u64,
}

pub trait CollectorDispatchEnvironment {
    /// Iterate live objects first, then sleeping objects, using their world IDs.
    fn items(&self) -> impl Iterator<Item = &GameObject>;
    fn stations(&mut self, origin: Vector, marker_radius: f64) -> Vec<(i64, StationDescription)>;
    /// Return the active collecting and inspecting assignments for this home.
    fn assigned(&self, home_id: i64) -> impl Iterator<Item = &PickupItem>;
    fn sample(&mut self) -> f64;
    fn launch(&mut self, home: &StationDescription, home_id: i64, items: Vec<PickupItem>);
}

#[derive(Default)]
pub struct CollectorDispatch {
    pub discover_at: u64,
    stations: Vec<StationDispatch>,
    station_ids: HashSet<i64>,
    regions: HashSet<(i64, i64)>,
}

impl CollectorDispatch {
    pub fn stations(&self) -> &[StationDispatch] {
        &self.stations
    }

    pub fn restore(&mut self, stations: Vec<StationDispatch>) {
        self.station_ids.clear();
        self.station_ids
            .extend(stations.iter().map(|station| station.home_id));
        self.stations = stations;
        self.regions.clear();
    }

    pub fn update(
        &mut self,
        tick: u64,
        catalog: &Catalog,
        environment: &mut impl CollectorDispatchEnvironment,
    ) {
        let rules = &catalog.collector_spec;
        let step = catalog.simulation.simulation_step;
        self.discover(tick, catalog, environment);
        let capacity = catalog
            .ship_specs
            .get(&rules.ship)
            .map_or(0, |ship| ship.cargo_space);
        if capacity == 0 {
            return;
        }
        for station in &mut self.stations {
            if tick >= station.check_at {
                let mut items = observe_items(station, rules, environment.items());
                station.check_at = station_check(tick, step, rules, || environment.sample());
                if items.len() >= rules.minimum_items {
                    let mut assigned: HashSet<i64> = environment
                        .assigned(station.home_id)
                        .filter(|item| !item.taken)
                        .map(|item| item.id)
                        .collect();
                    assigned.extend(
                        station
                            .queue
                            .iter()
                            .flatten()
                            .filter(|item| !item.taken)
                            .map(|item| item.id),
                    );
                    items.retain(|item| !assigned.contains(&item.id));
                    let home = station.home.position;
                    items.sort_unstable_by(|a, b| {
                        home.distance_squared(a.position)
                            .total_cmp(&home.distance_squared(b.position))
                            .then_with(|| a.id.cmp(&b.id))
                    });
                    let mut items = items.into_iter();
                    loop {
                        let trip: Vec<_> = items.by_ref().take(capacity).collect();
                        if trip.is_empty() {
                            break;
                        }
                        station.queue.push_back(trip);
                    }
                }
            }
            if tick >= station.launch_at
                && let Some(trip) = station.queue.pop_front()
            {
                environment.launch(&station.home, station.home_id, trip);
                station.launch_at = tick + 1.max((rules.launch_interval / step) as u64);
            }
        }
    }

    fn discover(
        &mut self,
        tick: u64,
        catalog: &Catalog,
        environment: &mut impl CollectorDispatchEnvironment,
    ) {
        let rules = &catalog.collector_spec;
        let step = catalog.simulation.simulation_step;
        let timer = TickTimerOptions {
            tick,
            step,
            interval: rules.discovery_interval,
            interval_max: 0.0,
        };
        if !tick_due(&mut self.discover_at, timer, || unreachable!()) {
            return;
        }
        let size = catalog.simulation.region_size;
        let mut pending = Vec::new();
        for item in environment.items().filter(|item| dispatchable(item)) {
            let region = cell_at(item.position, size);
            if self.regions.insert(region) {
                pending.push(region);
            }
        }
        let range = rules.operating_radius + SQRT_2 * size;
        for (x, y) in pending {
            for (id, home) in
                environment.stations(Vector::new(x as f64 * size, y as f64 * size), range)
            {
                if self.station_ids.insert(id) {
                    self.stations.push(StationDispatch {
                        home,
                        home_id: id,
                        check_at: station_check(tick, step, rules, || environment.sample()),
                        ..StationDispatch::default()
                    });
                }
            }
        }
    }

    pub fn items_collected(&mut self, events: &[SimulationEvent]) {
        for event in events {
            if let SimulationEvent::ItemCollected { item_id, .. } = event {
                for station in &mut self.stations {
                    station.seen.remove(item_id);
                    for item in station
                        .queue
                        .iter_mut()
                        .flatten()
                        .filter(|item| item.id == *item_id)
                    {
                        item.taken = true;
                    }
                }
            }
        }
    }
}

fn station_check(tick: u64, step: f64, rules: &Collector, sample: impl FnOnce() -> f64) -> u64 {
    next_tick(
        TickTimerOptions {
            tick,
            step,
            interval: rules.check_interval_min,
            interval_max: rules.check_interval_max,
        },
        sample,
    )
}

fn cell_at(position: Vector, size: f64) -> (i64, i64) {
    (
        (position.x / size).floor() as i64,
        (position.y / size).floor() as i64,
    )
}

fn observe_items<'a>(
    station: &mut StationDispatch,
    rules: &Collector,
    objects: impl IntoIterator<Item = &'a GameObject>,
) -> Vec<PickupItem> {
    let radius = rules.nearby_item_radius;
    let mut seen = HashSet::new();
    let mut groups: HashMap<(i64, i64), Vec<Vector>> = HashMap::new();
    let mut items = Vec::new();
    for object in objects {
        if !dispatchable(object)
            || object.position.distance_squared(station.home.position)
                > rules.operating_radius * rules.operating_radius
            || !seen.insert(object.id)
        {
            continue;
        }
        items.push(object.into());
        if radius > 0.0 && station.seen.contains(&object.id) {
            groups
                .entry(cell_at(object.position, radius))
                .or_default()
                .push(object.position);
        }
    }
    items.retain(|item: &PickupItem| {
        if station.seen.contains(&item.id) {
            return true;
        }
        if groups.is_empty() {
            return false;
        }
        let (x, y) = cell_at(item.position, radius);
        for dx in -1..=1 {
            for dy in -1..=1 {
                if groups.get(&(x + dx, y + dy)).is_some_and(|group| {
                    group.iter().any(|&position| {
                        item.position.distance_squared(position) <= radius * radius
                    })
                }) {
                    return true;
                }
            }
        }
        false
    });
    station.seen = seen;
    items
}

pub fn return_waypoints(
    ship: ShipMotion,
    home: Vector,
    station: Option<DockingStation<'_>>,
    elapsed: f64,
    from: Option<Vector>,
) -> Vec<Vector> {
    let Some(station) = station.filter(|station| {
        !station.bays.is_empty() && station.position.distance_squared(home) < 1.0
    }) else {
        return vec![home];
    };
    station
        .bays
        .iter()
        .map(|&bay| {
            let mut angle = station.rotation + bay + station.spin * elapsed;
            if let Some(from) = from {
                let offset = from - station.position;
                let bearing = offset.y.atan2(offset.x);
                let limit = ((station.radius + ship.model_radius) / offset.length().max(1.0))
                    .min(1.0)
                    .acos();
                angle = bearing + heading_error(angle - bearing).clamp(-limit, limit);
            }
            station
                .position
                .add_scaled(direction_of(angle), station.radius + 150.0)
        })
        .collect()
}

pub fn pickup_route(
    ship: ShipMotion,
    home: Vector,
    station: Option<DockingStation<'_>>,
    positions: &[Vector],
) -> Option<usize> {
    let n = positions.len();
    if n == 0 {
        return None;
    }
    let speed = ship.maximum_speed.max(1.0);
    let mut elapsed = n as f64 * ship.model_radius / speed;
    for &position in positions {
        elapsed += home.distance(position) / speed;
    }
    let bays = return_waypoints(ship, home, station, elapsed, None);
    let mut selected = 0;
    let mut best = f64::INFINITY;
    if n > 12 {
        for (index, &position) in positions.iter().enumerate() {
            let cost = pickup_departure(ship, position);
            if cost < best {
                selected = index;
                best = cost;
            }
        }
        return Some(selected);
    }
    let count = 1 << n;
    let mut costs = vec![0.0; count * n];
    for mask in 1..count {
        for (index, &position) in positions.iter().enumerate() {
            let bit = 1 << index;
            if mask & bit == 0 {
                continue;
            }
            let remaining = mask ^ bit;
            let mut cost = f64::INFINITY;
            if remaining == 0 {
                for &bay in &bays {
                    cost = cost.min(position.distance(bay) / speed);
                }
            } else {
                for (next, &target) in positions.iter().enumerate() {
                    if remaining & (1 << next) != 0 {
                        cost = cost
                            .min(position.distance(target) / speed + costs[remaining * n + next]);
                    }
                }
            }
            costs[mask * n + index] = cost;
        }
    }
    for (index, &position) in positions.iter().enumerate() {
        let cost = pickup_departure(ship, position) + costs[(count - 1) * n + index];
        if cost < best {
            selected = index;
            best = cost;
        }
    }
    Some(selected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::simulation::game_object::ObjectProperties;

    #[test]
    fn first_check_ages_items_and_only_older_items_anchor_groups() {
        let catalog = Catalog::load().unwrap();
        let rules = &catalog.collector_spec;
        let radius = rules.nearby_item_radius;
        let item = |id, x, moving| {
            let props = ObjectProperties {
                position: Vector::new(x, 0.0),
                velocity: Vector::new(if moving { 0.01 } else { 0.0 }, 0.0),
                ..ObjectProperties::default()
            };
            let mut object = GameObject::new(id, props, &catalog.simulation);
            object.item = true;
            object
        };
        let old = item(1, 0.0, false);
        let fresh_near = item(2, radius * 0.75, false);
        let fresh_chain = item(3, radius * 1.5, false);
        let moving = item(4, radius * 0.25, true);
        let mut station = StationDispatch::default();
        assert!(observe_items(&mut station, rules, [&old]).is_empty());
        let observed = observe_items(
            &mut station,
            rules,
            [&old, &fresh_near, &fresh_chain, &moving],
        );
        assert_eq!(
            observed.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert!(station.seen.contains(&3));
        assert!(!station.seen.contains(&4));
    }

    #[test]
    fn projected_return_waypoints_clear_the_station_circle() {
        use super::super::perception::point_segment_distance_squared;
        use std::f64::consts::PI;

        let catalog = Catalog::load().unwrap();
        let station = DockingStation {
            id: 1,
            position: Vector::new(100.0, 200.0),
            velocity: Vector::ZERO,
            rotation: 0.4,
            spin: 0.03,
            radius: 400.0,
            bays: &catalog.station_specs["corral-5"].docking_bays,
        };
        let ship = ShipMotion {
            model_radius: 55.0,
            ..ShipMotion::default()
        };
        let elapsed = 7.0;
        let home = station.position;
        let waypoints = return_waypoints(ship, home, Some(station), elapsed, None);
        let expected = home.add_scaled(
            direction_of(station.rotation + station.bays[0] + station.spin * elapsed),
            station.radius + 150.0,
        );
        assert!(waypoints[0].distance(expected) <= 1e-7);
        for distance in [350.0_f64, 450.0, 800.0] {
            for index in 0..32 {
                let from = home.add_scaled(direction_of(f64::from(index) * PI / 16.0), distance);
                for to in return_waypoints(ship, home, Some(station), elapsed, Some(from)) {
                    let clearance = point_segment_distance_squared(home, from, to).sqrt();
                    assert!(clearance + 1e-7 >= distance.min(station.radius + ship.model_radius));
                }
            }
        }
    }
}
