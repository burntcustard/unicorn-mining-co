//! Forecast the same held thrust and angular controls against moving obstacles.

use crate::objects::ship::Ship;
use crate::specs::{Catalog, NpcMovement};
use crate::vector::{RotValue, Vector};

use super::perception::{Obstacle, point_segment_distance_squared};
use super::steering::{heading_error, turn_command};

pub const PREDICTION_STEP: f64 = 0.1;

#[derive(Clone, Copy, Debug, Default)]
pub struct ShipMotion {
    pub position: Vector,
    pub velocity: Vector,
    pub rotation: f64,
    pub spin: f64,
    pub radius: f64,
    pub model_radius: f64,
    pub acceleration: f64,
    pub angular_acceleration: f64,
    pub maximum_turn_rate: f64,
    pub maximum_speed: f64,
    pub drag: f64,
    pub angular_drag: f64,
    pub max_speed_drag: f64,
    pub minimum_speed_squared: f64,
    pub visible_substep: f64,
}

impl ShipMotion {
    pub fn from_ship(ship: &Ship, catalog: &Catalog, physical_radius: f64) -> Self {
        let object = &ship.craft.object;
        let rules = &catalog.simulation;
        let visible_substep =
            rules.simulation_step / f64::from(rules.update_tiers["visible"].substeps);
        Self {
            position: object.position,
            velocity: object.velocity,
            rotation: object.rotation,
            spin: object.spin,
            radius: physical_radius.max(1.0),
            model_radius: object.radius,
            acceleration: rules.flight.thrust_scale * ship.forward_thrust() / object.mass,
            angular_acceleration: ship.angular_acceleration(),
            maximum_turn_rate: ship.maximum_turn_rate(),
            maximum_speed: ship.max_speed(),
            drag: object.drag,
            angular_drag: object.angular_drag,
            max_speed_drag: rules.motion.max_speed_drag,
            minimum_speed_squared: rules.motion.minimum_speed_squared,
            visible_substep,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Prediction {
    pub safe: bool,
    pub score: f64,
    pub position: Vector,
    pub velocity: Vector,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct PredictionOptions<'a> {
    pub obstacles: &'a [Obstacle],
    pub radius: f64,
    pub step: f64,
    pub steps: usize,
    pub coast: bool,
}

struct ObstacleForecast {
    obstacle: Obstacle,
    limit: f64,
    reach_squared: f64,
}

#[derive(Clone, Copy, Default)]
struct ObstacleMotion {
    from: Vector,
    to: Vector,
    from_rotation: Option<RotValue>,
    to_rotation: Option<RotValue>,
}

#[derive(Default)]
pub struct Predictor {
    pub(super) ship: ShipMotion,
    pub(super) rules: NpcMovement,
    coast: bool,
    clearance: f64,
    drag: f64,
    angular_drag: f64,
    speed_drag: f64,
    obstacles: Vec<ObstacleForecast>,
    motion: Vec<ObstacleMotion>,
    path: Vec<Vector>,
    directions: Vec<Vector>,
    step: f64,
    steering: Option<(f64, f64)>,
}

impl Predictor {
    pub fn reset(&mut self, ship: ShipMotion, rules: NpcMovement, options: PredictionOptions<'_>) {
        let step = if options.step == 0.0 {
            PREDICTION_STEP
        } else {
            options.step
        };
        let steps = if options.steps == 0 {
            ((rules.prediction_time + 0.001) / step) as usize
        } else {
            options.steps
        };
        self.ship = ship;
        self.rules = rules;
        self.step = step;
        self.coast = options.coast;
        self.clearance = options.radius + rules.clearance_distance * 0.5;
        self.drag = (-ship.drag * step).exp();
        self.angular_drag = (-ship.angular_drag * step).exp();
        self.speed_drag = ship.max_speed_drag.powf(step * 60.0);
        self.steering = None;
        self.obstacles.clear();
        self.motion
            .resize(steps * options.obstacles.len(), ObstacleMotion::default());
        self.path.resize(steps + 1, Vector::ZERO);
        self.directions.resize(steps, Vector::ZERO);
        for obstacle in options.obstacles {
            let mut limit = self.clearance;
            let initial_radius = obstacle.radius + limit;
            if ship.position.distance_squared(obstacle.position) < initial_radius * initial_radius {
                let initial = obstacle.distance(ship.position);
                if initial < limit {
                    limit = initial - 1.0;
                }
            }
            let reach = obstacle.radius + self.clearance + rules.clearance_distance;
            self.obstacles.push(ObstacleForecast {
                obstacle: obstacle.clone(),
                limit,
                reach_squared: reach * reach,
            });
        }
        let mut elapsed = step;
        for index in 0..steps {
            let offset = index * options.obstacles.len();
            for (index, obstacle) in options.obstacles.iter().enumerate() {
                let from = obstacle.position_at(elapsed - step);
                let to = obstacle.position_at(elapsed);
                let (mut from_rotation, mut to_rotation) =
                    (obstacle.inverse_rotation, obstacle.inverse_rotation);
                if obstacle.spin != 0.0 && obstacle.polygon.is_some() {
                    let base = obstacle.inverse_rotation.unwrap_or_default();
                    from_rotation = Some(rotate_inverse(base, -obstacle.spin * (elapsed - step)));
                    to_rotation = Some(rotate_inverse(base, -obstacle.spin * elapsed));
                }
                self.motion[offset + index] = ObstacleMotion {
                    from,
                    to,
                    from_rotation,
                    to_rotation,
                };
            }
            elapsed += step;
        }
    }

    pub fn predict(&mut self, heading: f64, thrust: f64, turn: f64) -> Prediction {
        let prediction = self.project(heading, thrust, turn);
        self.inspect(prediction)
    }

    pub(super) fn project(&mut self, heading: f64, thrust: f64, turn: f64) -> Prediction {
        self.steer(heading, turn);
        let (mut position, mut velocity) = (self.ship.position, self.ship.velocity);
        self.path[0] = position;
        let dt = self.step;
        let mut acceleration = self.ship.acceleration * thrust * dt;
        for (index, &direction) in self.directions.iter().enumerate() {
            if self.coast && index as f64 * dt >= self.rules.decision_interval {
                acceleration = 0.0;
            }
            velocity = velocity.add_scaled(direction, acceleration);
            let mut kept = self.drag;
            let speed = velocity.length();
            if speed > self.ship.maximum_speed {
                kept = kept.min(self.ship.maximum_speed.max(speed * self.speed_drag) / speed);
            }
            velocity = velocity * kept;
            position = position.add_scaled(velocity, dt);
            self.path[index + 1] = position;
        }
        Prediction {
            position,
            velocity,
            ..Prediction::default()
        }
    }

    fn steer(&mut self, heading: f64, mut turn: f64) {
        if self.steering == Some((heading, turn)) {
            return;
        }
        self.steering = Some((heading, turn));
        let (mut rotation, mut spin) = (self.ship.rotation, self.ship.spin);
        let dt = self.step;
        let angular = self.ship.angular_acceleration * dt;
        for (index, direction) in self.directions.iter_mut().enumerate() {
            if (index + 1) as f64 * dt > self.rules.decision_interval + 0.001 {
                let error = heading_error(heading - rotation);
                turn = turn_command(error, self.ship.maximum_turn_rate, 1.8);
            }
            spin += (turn * self.ship.maximum_turn_rate - spin)
                .min(angular)
                .max(-angular);
            let (sin, cos) = (rotation + spin * dt).sin_cos();
            *direction = Vector::new(cos, sin);
            spin *= self.angular_drag;
            rotation += spin * dt;
        }
    }

    pub(super) fn inspect(&self, mut prediction: Prediction) -> Prediction {
        let (mut minimum, mut violation) = (f64::INFINITY, 0.0);
        let mut safe = true;
        for index in 0..self.directions.len() {
            let offset = index * self.obstacles.len();
            let (previous, position) = (self.path[index], self.path[index + 1]);
            for (index, forecast) in self.obstacles.iter().enumerate() {
                let obstacle = &forecast.obstacle;
                let pose = self.motion[offset + index];
                let mut from = previous - pose.from;
                let mut to = position - pose.to;
                let closest = point_segment_distance_squared(Vector::ZERO, from, to);
                if closest > forecast.reach_squared {
                    continue;
                }
                let reach = obstacle.radius + forecast.limit;
                let (distance, blocked) = if let Some(polygon) = &obstacle.polygon {
                    if let (Some(from_rotation), Some(to_rotation)) =
                        (pose.from_rotation, pose.to_rotation)
                    {
                        from = from_rotation.rotate(from);
                        to = to_rotation.rotate(to);
                    }
                    let distance = polygon.distance(to);
                    let blocked = forecast.limit > 0.0
                        && point_segment_distance_squared(Vector::ZERO, from, to) < reach * reach
                        && !polygon.clear(from, to, forecast.limit);
                    (distance, blocked)
                } else {
                    (
                        to.length() - obstacle.radius,
                        forecast.limit > 0.0 && closest < reach * reach,
                    )
                };
                minimum = minimum.min(distance);
                if distance < forecast.limit || blocked {
                    safe = false;
                    violation += 1.0_f64.max(forecast.limit - distance) * self.step;
                }
            }
        }
        let mut score =
            -0.0_f64.max(self.clearance + self.rules.clearance_distance - minimum) * 2.0;
        if !safe {
            score -= violation * 1000.0;
        }
        prediction.safe = safe;
        prediction.score = score;
        prediction
    }

    pub fn stopping_position(
        &mut self,
        ship: ShipMotion,
        rules: NpcMovement,
        thrust: f64,
        turn: f64,
    ) -> Vector {
        self.reset(
            ship,
            rules,
            PredictionOptions {
                coast: true,
                step: ship.visible_substep,
                ..PredictionOptions::default()
            },
        );
        let result = self.project(ship.rotation, thrust, turn);
        result.position.add_scaled(result.velocity, 1.0 / ship.drag)
    }
}

fn rotate_inverse(base: RotValue, angle: f64) -> RotValue {
    let (sin, cos) = angle.sin_cos();
    let composed = RotValue { sin, cos }.rotate(Vector::new(base.cos, base.sin));
    RotValue {
        sin: composed.y,
        cos: composed.x,
    }
}
