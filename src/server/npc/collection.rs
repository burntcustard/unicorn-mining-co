//! Cargo pickup recovery, candidate forecasts, and departure scoring.

use crate::specs::NpcMovement;
use crate::utilities::vector::Vector;

use super::contact_forecast::{COLLECTION_TURN_GAIN, ContactForecast};
use super::flight::{FlightContext, Movement, direction_of};
use super::perception::Obstacle;
use super::prediction::{PREDICTION_STEP, PredictionOptions, Predictor, ShipMotion};
use super::steering::{Avoidance, heading_error, turn_command};

pub const COLLECTION_APPROACH_TIME: f64 = 4.0;
const COLLECTION_PREDICTION_TIME: f64 = 2.1;

#[derive(Default)]
pub(super) struct CollectionProgress {
    item_id: i64,
    checked_at: u64,
    distance: f64,
    predictor: Predictor,
}

impl CollectionProgress {
    pub fn update(&mut self, context: FlightContext<'_>, movement: &Movement) {
        if !movement.collect {
            self.item_id = 0;
            self.checked_at = 0;
            self.distance = 0.0;
            return;
        }
        let ship = context.ship;
        let distance = ship.position.distance(movement.position);
        if self.item_id != movement.ignore_id {
            self.item_id = movement.ignore_id;
            self.checked_at = context.tick;
            self.distance = distance;
        }
        if distance < self.distance - 2.0
            || distance > 2.0 * ship.radius
                && ship.velocity.length_squared() >= ship.minimum_speed_squared
            || distance > 4.0 * ship.radius
            || context.tick.wrapping_sub(self.checked_at) as f64 * context.simulation_step >= 2.0
        {
            self.checked_at = context.tick;
            self.distance = distance;
        }
    }

    pub fn wiggle(
        &mut self,
        context: FlightContext<'_>,
        obstacles: &[Obstacle],
        forecast: Option<&ContactForecast<'_>>,
    ) -> Option<f64> {
        let elapsed = context.tick.wrapping_sub(self.checked_at) as f64 * context.simulation_step;
        if self.item_id == 0 || !(0.6..1.4).contains(&elapsed) {
            return None;
        }
        let target = forecast?.target();
        let (ship, rules) = (context.ship, context.rules);
        if target.id != self.item_id || recovery_constrained(ship, target.position, obstacles) {
            return None;
        }
        let mut turn = if ship.maximum_turn_rate > 0.0 {
            1.0_f64.min(1.5 / ship.maximum_turn_rate)
        } else {
            0.0
        };
        if elapsed >= 1.0 {
            turn = -turn;
        }
        let steps = 1.max((rules.decision_interval / PREDICTION_STEP).ceil() as usize);
        self.predictor.reset(
            ship,
            rules,
            PredictionOptions {
                radius: ship.radius,
                obstacles,
                steps,
                ..PredictionOptions::default()
            },
        );
        if !self.predictor.predict(ship.rotation, 0.0, turn).safe {
            turn = 0.0;
        }
        Some(turn)
    }
}

fn recovery_constrained(ship: ShipMotion, target: Vector, obstacles: &[Obstacle]) -> bool {
    let reach = ship.radius + 60.0;
    obstacles.iter().any(|object| {
        !object.station
            && (object.distance(ship.position) < reach || object.distance(target) < reach)
    })
}

pub(super) fn collect_controls(
    avoidance: &mut Avoidance,
    ship: ShipMotion,
    rules: NpcMovement,
    movement: &Movement,
    obstacles: &[Obstacle],
    forecast: &ContactForecast<'_>,
) -> (f64, f64) {
    let target = forecast.target();
    let offset = target.position - ship.position;
    let bearing = offset.y.atan2(offset.x);
    let gain = if forecast.rocks {
        1.8
    } else {
        COLLECTION_TURN_GAIN
    };
    let desired = turn_command(
        heading_error(bearing - ship.rotation),
        ship.maximum_turn_rate,
        gain,
    );
    let turns = [desired, 0.0, -1.0, 1.0];
    let (mut best, mut best_thrust, mut best_turn) = (f64::INFINITY, 0.0, desired);
    for (index, turn) in turns.into_iter().enumerate() {
        if turns[..index]
            .iter()
            .any(|&previous| (previous - turn).abs() < 0.001)
        {
            continue;
        }
        for thrust in [1.0, 0.0] {
            let horizon = COLLECTION_PREDICTION_TIME.min(best);
            let Some(prediction) = forecast.predict(thrust, turn, horizon, 0.0) else {
                let thrust = if recovery_constrained(ship, target.position, obstacles) {
                    0.0
                } else {
                    1.0
                };
                return avoidance.avoid(
                    ship,
                    rules,
                    direction_of(bearing),
                    thrust,
                    desired,
                    obstacles,
                );
            };
            if !prediction.safe {
                continue;
            }
            let score = if prediction.arrived {
                let future = ShipMotion {
                    position: prediction.ship.position,
                    velocity: prediction.ship.velocity,
                    rotation: prediction.ship.rotation,
                    ..ship
                };
                let departure = movement
                    .next_positions
                    .iter()
                    .map(|&position| pickup_departure(future, position))
                    .reduce(f64::min)
                    .unwrap_or(0.0);
                prediction.seconds + 0.25 * departure
            } else {
                1000.0 + prediction.distance
            };
            if score < best {
                best = score;
                best_thrust = thrust;
                best_turn = turn;
            }
        }
    }
    if best.is_infinite() {
        return avoidance.avoid(ship, rules, direction_of(bearing), 0.0, desired, obstacles);
    }
    let remaining: Vec<_> = obstacles
        .iter()
        .filter(|obstacle| !forecast.source_ids().any(|id| id == obstacle.entity_id))
        .cloned()
        .collect();
    let heading = ship.rotation + best_turn * ship.maximum_turn_rate / gain;
    avoidance.avoid(
        ship,
        rules,
        direction_of(heading),
        best_thrust,
        best_turn,
        &remaining,
    )
}

pub fn collection_hatch(ship: ShipMotion, base_radius: f64, position: Vector) -> bool {
    let reach = base_radius + 300.0_f64.max(ship.maximum_speed * COLLECTION_APPROACH_TIME);
    ship.position.distance_squared(position) <= reach * reach
}

pub fn pickup_departure(ship: ShipMotion, position: Vector) -> f64 {
    let offset = position - ship.position;
    let maximum = ship.maximum_speed.max(1.0);
    let mut duration = offset.length() / maximum;
    duration += 2.0 * (ship.velocity.length() - ship.velocity.dot(offset.normalized()))
        / (ship.drag.max(0.001) * maximum);
    if ship.maximum_turn_rate > 0.0 {
        duration +=
            heading_error(offset.y.atan2(offset.x) - ship.rotation).abs() / ship.maximum_turn_rate;
    }
    duration
}

/// The authored pickup throat centers expressed in ship-local coordinates.
pub fn collection_centers(ship: &crate::objects::ship::Ship, centers: &mut Vec<Vector>) {
    use crate::gameplay::collision_world::{ColliderPart, CollisionEntity};
    use crate::utilities::vector_math::RotValue;

    let object = &ship.craft.object;
    let (sin, cos) = (-object.rotation).sin_cos();
    let inverse = RotValue { sin, cos };
    ship.with_colliders(|colliders| {
        centers.extend(
            colliders
                .iter()
                .filter(|collider| {
                    collider.catches
                        && matches!(collider.user_data.part, ColliderPart::Module { mount, .. }
                if ship.craft.mounts.get(mount).is_some_and(|mount| mount.health >= 1.0))
                })
                .map(|collider| inverse.rotate(collider.pose.position - object.position)),
        );
    });
}
