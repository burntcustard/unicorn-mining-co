//! Station bay approaches and expanding spiral searches.

use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

use crate::protocol::Input;
use crate::utilities::vector::Vector;

use super::flight::{FlightContext, Movement, direction_of};
use super::perception::clear_segment;
use super::prediction::{PREDICTION_STEP, PredictionOptions, Predictor, ShipMotion};
use super::steering::{heading_error, turn_command};

#[derive(Clone, Copy, Debug)]
pub struct DockingStation<'a> {
    pub id: i64,
    pub position: Vector,
    pub velocity: Vector,
    pub rotation: f64,
    pub spin: f64,
    pub radius: f64,
    pub bays: &'a [f64],
}

pub trait DockingForecast {
    fn controls(&mut self, bay: f64) -> (f64, f64);
    fn reaches_bay(&mut self, bay: f64, thrust: f64, turn: f64, horizon: f64) -> bool;
}

#[derive(Default)]
pub struct DockingGuide {
    station: Option<i64>,
    bay: usize,
    predictor: Predictor,
}

impl DockingGuide {
    pub fn movement(
        &mut self,
        context: FlightContext<'_>,
        station: DockingStation<'_>,
        parent_rate: Option<f64>,
        forecast: &mut impl DockingForecast,
    ) -> Movement {
        let ship = context.ship;
        if station.bays.is_empty() {
            return Movement {
                position: station.position,
                ignore_id: station.id,
                ..Movement::default()
            };
        }
        if self.station != Some(station.id) || self.bay >= station.bays.len() {
            self.station = Some(station.id);
            let mut best = f64::INFINITY;
            for (index, &bay) in station.bays.iter().enumerate() {
                let point = station
                    .position
                    .add_scaled(direction_of(station.rotation + bay), station.radius);
                let distance = ship.position.distance_squared(point);
                if distance < best {
                    self.bay = index;
                    best = distance;
                }
            }
        }
        let bay = station.bays[self.bay];
        if let Some(control) = self.direct_dock(context, station, bay, parent_rate, forecast) {
            return Movement {
                controls: Some(control),
                ..Movement::default()
            };
        }
        let relative = ship.position - station.position;
        let spin = station.spin * (1.0 - parent_rate.unwrap_or(0.0));
        let angle = station.rotation + bay;
        let direction = direction_of(angle);
        let (cross, along) = (relative.cross(direction), relative.dot(direction));
        let across = cross.abs();
        let velocity = station.velocity + Vector::new(-relative.y, relative.x) * spin;
        let drift = ship.velocity - velocity;
        let coast_across =
            across.max((cross + drift.cross(direction) / ship.drag.max(0.001)).abs());
        if coast_across < 35.0 && along > 0.0 && along < station.radius + 240.0 {
            let offset = station.position - ship.position;
            let angle = heading_error(offset.y.atan2(offset.x) - ship.rotation);
            let turn = turn_command(angle, ship.maximum_turn_rate, 1.8);
            return Movement {
                controls: Some(Input {
                    turn,
                    ..Input::default()
                }),
                ..Movement::default()
            };
        }
        let lead = 2.0_f64
            .min(ship.position.distance(station.position) / ship.velocity.length().max(70.0));
        let outside = station
            .position
            .add_scaled(direction_of(angle + spin * lead), station.radius);
        let mut approach_velocity =
            station.velocity + Vector::new(-direction.y, direction.x) * (spin * station.radius);
        if along > station.radius && across < 100.0 {
            approach_velocity = approach_velocity.add_scaled(direction, -(100.0 - across));
        }
        Movement {
            position: outside,
            velocity: approach_velocity,
            follow_distance: 10.0,
            target_id: station.id,
            ..Movement::default()
        }
    }

    fn direct_dock(
        &mut self,
        context: FlightContext<'_>,
        station: DockingStation<'_>,
        bay: f64,
        parent_rate: Option<f64>,
        forecast: &mut impl DockingForecast,
    ) -> Option<Input> {
        let ship = context.ship;
        let axis = direction_of(station.rotation + bay);
        let relative = ship.position - station.position;
        let along = relative.dot(axis);
        if along <= 0.0 || relative.cross(axis).abs() > along.max(80.0) {
            return None;
        }
        let obstacles: Vec<_> = context
            .obstacles
            .iter()
            .filter(|object| object.entity_id != station.id)
            .cloned()
            .collect();
        let rules = context.rules;
        if !clear_segment(
            ship.position,
            station.position,
            ship.radius + rules.clearance_distance,
            &obstacles,
            true,
        ) {
            return None;
        }
        let position = docking_position(ship, station, bay, parent_rate);
        for attempt in 0..2 {
            let (mut thrust, mut turn) = forecast.controls(bay);
            if attempt == 0 && thrust == 0.0 {
                continue;
            }
            if attempt == 1 {
                thrust = 0.0;
                let offset = position - ship.position;
                turn = turn_command(
                    heading_error(offset.y.atan2(offset.x) - ship.rotation),
                    ship.maximum_turn_rate,
                    1.8,
                );
            }
            if forecast.reaches_bay(bay, thrust, turn, 6.0) {
                let steps = 1.max((rules.decision_interval / PREDICTION_STEP).ceil() as usize);
                self.predictor.reset(
                    ship,
                    rules,
                    PredictionOptions {
                        radius: ship.radius,
                        obstacles: &obstacles,
                        steps,
                        ..PredictionOptions::default()
                    },
                );
                if self.predictor.predict(ship.rotation, thrust, turn).safe {
                    return Some(Input {
                        thrust,
                        turn,
                        ..Input::default()
                    });
                }
            }
        }
        None
    }
}

pub fn docking_position(
    ship: ShipMotion,
    station: DockingStation<'_>,
    bay: f64,
    parent_rate: Option<f64>,
) -> Vector {
    let relative = ship.position - station.position;
    let spin = station.spin * (1.0 - parent_rate.unwrap_or(0.0));
    let lead = 2.0_f64.min(
        0.0_f64.max(relative.length() - station.radius * 0.6) / ship.velocity.length().max(80.0),
    );
    let direction = direction_of(station.rotation + bay + spin * lead);
    let along = relative.dot(direction);
    station.position.add_scaled(
        direction,
        (station.radius * 0.6)
            .min(along - 80.0_f64.max(ship.model_radius * 2.0))
            .max(0.0),
    )
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct Search {
    pub origin: Vector,
    pub heading: f64,
    pub angle: f64,
}

impl Search {
    pub fn movement(&mut self, context: FlightContext<'_>) -> Movement {
        let ship = context.ship;
        let mut lookahead = ship.velocity.length() * context.rules.decision_interval;
        if ship.maximum_turn_rate > 0.0 {
            lookahead += ship.velocity.length() / ship.maximum_turn_rate;
        }
        lookahead = lookahead.max(70.0);
        let radius = ship.radius + context.rules.clearance_distance;
        loop {
            let target = self.origin.add_scaled(
                direction_of(self.heading + self.angle),
                120.0 + 55.0 * self.angle,
            );
            if ship.position.distance(target) >= lookahead
                && clear_segment(target, target, radius, context.obstacles, false)
            {
                return Movement {
                    position: target,
                    ..Movement::default()
                };
            }
            self.angle += PI / 32.0;
        }
    }
}
