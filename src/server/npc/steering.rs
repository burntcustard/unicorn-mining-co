//! Arrival braking and candidate control selection.

use std::f64::consts::{PI, TAU};

use crate::specs::NpcMovement;
use crate::utilities::vector::Vector;

use super::perception::Obstacle;
use super::prediction::{PredictionOptions, Predictor, ShipMotion};

pub fn heading_error(error: f64) -> f64 {
    if error == 0.0 {
        return error;
    }
    let mut wrapped = error.abs() % (TAU + TAU);
    if wrapped > PI {
        wrapped -= TAU;
        if wrapped >= PI {
            wrapped -= TAU;
        }
    }
    if error < 0.0 { -wrapped } else { wrapped }
}

pub fn turn_command(angle: f64, max_spin: f64, gain: f64) -> f64 {
    if max_spin > 0.0 && angle.abs() > 0.02 {
        (angle * gain / max_spin).clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

pub fn arrival_thrust(
    ship: ShipMotion,
    rules: NpcMovement,
    direction: Vector,
    target_velocity: Vector,
    target_acceleration: Vector,
    gap: f64,
) -> f64 {
    if ship.drag <= 0.0 {
        return 1.0;
    }
    let speed = ship.velocity.dot(direction);
    let target_speed = 0.0_f64.max(target_velocity.dot(direction));
    let step = ship.visible_substep;
    let minimum = ship.minimum_speed_squared.sqrt();
    let interval = rules.decision_interval;
    let mut target_drag = 0.0;
    if target_speed > minimum {
        target_drag = (0.0_f64.max(-target_acceleration.dot(direction) / target_speed) * interval)
            .ln_1p()
            / interval;
    }
    if target_speed > minimum
        && gap.abs() <= target_speed * interval
        && (speed - target_speed).abs() <= target_speed * ship.drag * interval
    {
        let desired = ship
            .maximum_speed
            .min(target_speed + gap * ship.drag)
            .max(0.0);
        return ((desired * ship.drag + (desired - speed) / rules.response_time)
            / ship.acceleration)
            .clamp(0.0, 1.0);
    }
    let coast = |speed: f64, target_speed: f64| {
        if speed <= minimum || target_drag == 0.0 && speed <= target_speed {
            return 0.0;
        }
        if target_speed > minimum && target_drag > 0.0 {
            let mut closing = 0.0_f64.max(speed / ship.drag - target_speed / target_drag);
            if ship.drag > target_drag && speed > target_speed {
                let time = (speed / target_speed).ln() / (ship.drag - target_drag);
                closing = closing.max(
                    speed * -(-ship.drag * time).exp_m1() / ship.drag
                        - target_speed * -(-target_drag * time).exp_m1() / target_drag,
                );
            }
            return closing;
        }
        if target_speed > minimum {
            return (speed - target_speed - target_speed * (speed / target_speed).ln()) / ship.drag;
        }
        let steps = ((speed / minimum).ln() / (ship.drag * step)).floor() + 1.0;
        speed * step * (1.0 - (-ship.drag * step * steps).exp()) / (ship.drag * step).exp_m1()
    };
    if gap <= coast(speed, target_speed) + 3.0 {
        return 0.0;
    }
    let (sin, cos) = ship.rotation.sin_cos();
    let forward = Vector::new(cos, sin);
    let acceleration = ship.acceleration * 0.0_f64.max(forward.dot(direction));
    let drag = (-ship.drag * step).exp();
    let target_decay = (-target_drag * step).exp();
    let steps = (interval / step).round() as usize;
    let endpoint = |thrust| {
        let (mut velocity, mut target, mut distance) = (speed, target_speed, 0.0);
        for _ in 0..steps {
            velocity += acceleration * thrust * step;
            velocity = if velocity.abs() < minimum {
                0.0
            } else {
                ship.maximum_speed.min(velocity * drag)
            };
            target *= target_decay;
            distance += (velocity - target) * step;
        }
        distance + coast(velocity, target)
    };
    if endpoint(1.0) < gap {
        return 1.0;
    }
    let (mut low, mut high) = (0.0, 1.0);
    for _ in 0..10 {
        let middle = (low + high) * 0.5;
        if endpoint(middle) < gap {
            low = middle;
        } else {
            high = middle;
        }
    }
    low
}

pub fn braking_controls(
    ship: ShipMotion,
    rules: NpcMovement,
    acceleration: Vector,
    direction: Vector,
    target_velocity: Vector,
) -> Option<(Vector, f64)> {
    let relative = ship.velocity - target_velocity;
    let tolerance = ship.minimum_speed_squared.sqrt()
        + 0.0_f64.max(target_velocity.dot(direction)) * ship.drag * rules.decision_interval;
    let maximum = ship.acceleration;
    if maximum <= 0.0 || relative.dot(direction) <= tolerance || acceleration.dot(direction) >= 0.0
    {
        return None;
    }
    let (sin, cos) = ship.rotation.sin_cos();
    let forward = Vector::new(cos, sin);
    let thrust = (acceleration.dot(forward) / maximum)
        .clamp(0.0, 1.0)
        .min(0.0_f64.max(-relative.dot(forward)) / (maximum * rules.decision_interval));
    Some((acceleration, thrust))
}

pub fn restart_thrust(ship: ShipMotion, thrust: f64) -> f64 {
    if thrust <= 0.0
        || ship.velocity.length_squared() >= ship.minimum_speed_squared
        || ship.acceleration <= 0.0
    {
        return thrust;
    }
    thrust.max(
        1.0_f64.min(
            ship.minimum_speed_squared.sqrt() / (ship.acceleration * ship.visible_substep) * 1.2,
        ),
    )
}

#[derive(Default)]
pub struct Avoidance {
    nearby: Vec<Obstacle>,
    forecast: Predictor,
}

impl Avoidance {
    pub fn avoid(
        &mut self,
        ship: ShipMotion,
        rules: NpcMovement,
        heading: Vector,
        thrust: f64,
        turn: f64,
        obstacles: &[Obstacle],
    ) -> (f64, f64) {
        let thrust = restart_thrust(ship, thrust);
        let reach = ship.maximum_speed.max(ship.velocity.length()) * rules.prediction_time
            + ship.radius
            + rules.clearance_distance;
        self.nearby.clear();
        self.nearby.extend(
            obstacles
                .iter()
                .filter(|object| {
                    let travel = object.velocity.length() * rules.prediction_time
                        + object.acceleration.length()
                            * rules.prediction_time
                            * rules.prediction_time
                            * 0.5;
                    let within = object.radius + reach + travel;
                    ship.position.distance_squared(object.position) < within * within
                })
                .cloned(),
        );
        if self.nearby.is_empty() {
            return (thrust, turn);
        }
        self.forecast.reset(
            ship,
            rules,
            PredictionOptions {
                radius: ship.radius,
                obstacles: &self.nearby,
                ..PredictionOptions::default()
            },
        );
        self.forecast
            .avoid_controls(heading.y.atan2(heading.x), thrust, turn)
    }

    pub fn stopping_position(
        &mut self,
        ship: ShipMotion,
        rules: NpcMovement,
        thrust: f64,
        turn: f64,
    ) -> Vector {
        self.forecast.stopping_position(ship, rules, thrust, turn)
    }
}

impl Predictor {
    pub fn avoid_controls(&mut self, heading_angle: f64, thrust: f64, turn: f64) -> (f64, f64) {
        let nominal = self.predict(heading_angle, thrust, turn);
        if nominal.safe {
            return (thrust, turn);
        }
        let mut best = nominal;
        let (mut best_thrust, mut best_turn) = (thrust, turn);
        for offset in [
            0.0, -0.15, 0.15, -0.35, 0.35, -0.7, 0.7, -1.2, 1.2, -2.0, 2.0, PI,
        ] {
            let angle = heading_angle + offset;
            let candidate_turn = turn_command(
                heading_error(angle - self.ship.rotation),
                self.ship.maximum_turn_rate,
                1.8,
            );
            for candidate_thrust in [0.0, 0.4, 0.7, 1.0] {
                let candidate_thrust = restart_thrust(self.ship, candidate_thrust);
                let candidate = self.project(angle, candidate_thrust, candidate_turn);
                let penalty = candidate.position.distance(nominal.position)
                    + candidate.velocity.distance(nominal.velocity) * self.rules.response_time;
                if best.safe && -penalty <= best.score {
                    continue;
                }
                let mut candidate = self.inspect(candidate);
                candidate.score -= penalty;
                if candidate.safe && !best.safe
                    || candidate.safe == best.safe && candidate.score > best.score + 0.001
                {
                    best = candidate;
                    best_thrust = candidate_thrust;
                    best_turn = candidate_turn;
                }
            }
        }
        (best_thrust, best_turn)
    }
}
