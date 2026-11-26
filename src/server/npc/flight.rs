//! Persistent pilot decisions for arrivals, detours, and passing attacks.

use crate::protocol::Input;
use crate::specs::NpcMovement;
use crate::utilities::seeded_random::SeededRandom;
use crate::utilities::vector::Vector;

use super::collection::{COLLECTION_APPROACH_TIME, CollectionProgress, collect_controls};
use super::contact_forecast::ContactForecast;
use super::perception::{MotionObservation, Obstacle, clear_segment};
use super::prediction::ShipMotion;
use super::route::{RouteOptions, RoutePlan};
use super::steering::{Avoidance, arrival_thrust, braking_controls, heading_error, turn_command};

#[derive(Clone, Debug, Default)]
pub struct Movement {
    pub next_positions: Vec<Vector>,
    pub collect: bool,
    pub position: Vector,
    pub velocity: Vector,
    pub follow_distance: f64,
    pub pass_distance: f64,
    pub ignore_id: i64,
    pub target_id: i64,
    pub waiting: bool,
    pub controls: Option<Input>,
}

#[derive(Clone, Copy)]
pub struct FlightTarget {
    pub entity_id: i64,
    pub position: Vector,
    pub velocity: Vector,
    pub radius: f64,
    pub is_ship: bool,
}

#[derive(Clone, Copy)]
pub struct FlightContext<'a> {
    pub ship: ShipMotion,
    pub rules: NpcMovement,
    pub tick: u64,
    pub simulation_step: f64,
    pub launching: bool,
    pub obstacles: &'a [Obstacle],
    pub target: Option<FlightTarget>,
}

#[derive(Clone, Copy, Debug)]
pub struct AttackOptions {
    pub pass_distance: f64,
    pub aim_tolerance: f64,
    pub weapon: AttackWeapon,
    pub aim_prediction_time: f64,
    pub can_fire: bool,
}

#[derive(Clone, Copy, Debug, Default)]
pub enum AttackWeapon {
    Beam {
        range: f64,
    },
    Projectile {
        speed: f64,
        cannon: bool,
    },
    #[default]
    None,
}

#[derive(Clone, Copy)]
struct AttackAim {
    offset: Vector,
    bearing_rate: f64,
    armed: bool,
    firing: bool,
}

#[derive(Clone, Copy)]
struct Pass {
    offset: Vector,
    direction: Vector,
    ends_at: u64,
}

#[derive(Clone, Copy)]
struct CombatTurn {
    direction: f64,
    change_at: u64,
    last_tick: u64,
    reversing: bool,
}

#[derive(Default)]
pub struct Pilot {
    scene: Vec<Obstacle>,
    avoidance: Avoidance,
    navigation: RoutePlan,
    passing: Option<Pass>,
    combat_turn: Option<CombatTurn>,
    chase_until: u64,
    target_id: i64,
    target_motion: MotionObservation,
    collection: CollectionProgress,
}

impl Pilot {
    pub fn steer(&mut self, context: FlightContext<'_>, destination: &Movement) -> (f64, f64) {
        self.steer_with_pickup(context, destination, None)
    }

    pub fn steer_with_pickup(
        &mut self,
        context: FlightContext<'_>,
        destination: &Movement,
        forecast: Option<&ContactForecast<'_>>,
    ) -> (f64, f64) {
        self.steer_with_aim(context, destination, forecast, None)
    }

    fn steer_with_aim(
        &mut self,
        context: FlightContext<'_>,
        destination: &Movement,
        forecast: Option<&ContactForecast<'_>>,
        aim: Option<AttackAim>,
    ) -> (f64, f64) {
        let ship = context.ship;
        if let Some(controls) = destination.controls {
            self.passing = None;
            return (controls.thrust, controls.turn);
        }
        if destination.waiting {
            self.passing = None;
            let offset = destination.position - ship.position;
            let angle = heading_error(offset.y.atan2(offset.x) - ship.rotation);
            let turn = turn_command(angle, ship.maximum_turn_rate, 1.8);
            return self
                .avoidance
                .avoid(ship, context.rules, offset, 0.0, turn, context.obstacles);
        }
        if context.launching {
            return (1.0, 0.0);
        }
        let target = context
            .target
            .filter(|target| target.entity_id == destination.target_id);
        let ignore_id = if target.is_some_and(|target| target.is_ship)
            && (destination.pass_distance > 0.0 || destination.follow_distance > 0.0)
        {
            destination.target_id
        } else {
            destination.ignore_id
        };
        let mut scene = std::mem::take(&mut self.scene);
        scene.clear();
        scene.extend(
            context
                .obstacles
                .iter()
                .filter(|obstacle| ignore_id == 0 || obstacle.entity_id != ignore_id)
                .cloned(),
        );
        let result = self.steer_scene(context, destination, &mut scene, target, forecast, aim);
        self.scene = scene;
        result
    }

    fn steer_scene(
        &mut self,
        context: FlightContext<'_>,
        destination: &Movement,
        obstacles: &mut Vec<Obstacle>,
        target_entity: Option<FlightTarget>,
        forecast: Option<&ContactForecast<'_>>,
        aim: Option<AttackAim>,
    ) -> (f64, f64) {
        self.collection.update(context, destination);
        if let Some(turn) = self.collection.wiggle(context, obstacles, forecast) {
            return (0.0, turn);
        }
        let (ship, rules) = (context.ship, context.rules);
        let (follow, pass, chasing) = self.combat_movement(context, destination);
        let target_acceleration = self.observe_target(context, destination);
        let target = if pass > 0.0 {
            self.attack_run(
                context,
                destination,
                target_entity.map_or(0.0, |target| target.radius),
            )
        } else {
            self.passing = None;
            destination.position
        };
        let distance = (target - ship.position).length();
        let mut direction = (target - ship.position).normalized();
        let target_direction = direction;
        let mut speed = ship
            .maximum_speed
            .min(0.0_f64.max(distance - follow) * ship.drag);
        if pass > 0.0 {
            speed = ship.maximum_speed;
        }
        let mut route_target = target;
        if chasing
            && self.passing.is_none()
            && !clear_segment(
                ship.position,
                target,
                ship.radius + rules.clearance_distance,
                obstacles.iter(),
                true,
            )
        {
            let radius = target_entity.map_or(ship.radius, |target| target.radius);
            route_target = intercept_position(context, destination, radius, obstacles);
        }
        let (waypoint, detour) = self.navigation.waypoint(
            RouteOptions {
                position: ship.position,
                target: route_target,
                ship_radius: ship.radius,
                minimum_speed_squared: ship.minimum_speed_squared,
                simulation_step: context.simulation_step,
                tick: context.tick,
                rules,
            },
            obstacles,
        );
        let mut velocity = destination.velocity;
        if route_target != target && !detour {
            direction = (waypoint - ship.position).normalized();
        }
        if detour {
            direction = (waypoint - ship.position).normalized();
            speed = ship.maximum_speed.min(speed + velocity.length());
            velocity = Vector::ZERO;
        }
        if !destination.collect
            && aim.is_none()
            && pass == 0.0
            && !detour
            && distance <= follow + 5.0
            && velocity.length_squared() < ship.minimum_speed_squared
            && (ship.velocity - velocity).length() < 3.0
        {
            return self
                .avoidance
                .avoid(ship, rules, direction, 0.0, 0.0, obstacles);
        }
        let collecting = destination.collect
            && (!detour || distance < ship.radius * 3.0)
            && distance < ship.maximum_speed * COLLECTION_APPROACH_TIME;
        if collecting {
            let Some(forecast) = forecast.filter(|forecast| !forecast.centers().is_empty()) else {
                return (0.0, 0.0);
            };
            return collect_controls(
                &mut self.avoidance,
                ship,
                rules,
                destination,
                obstacles,
                forecast,
            );
        }
        let tracking = aim
            .filter(|aim| !detour && self.passing.is_none() && aim.offset.length_squared() > 0.0);
        let repositioning =
            !detour && aim.is_some_and(|aim| aim.armed && (!aim.firing || tracking.is_none()));
        let (mut heading, mut thrust, mut turn) = if let Some(aim) = tracking {
            let angle = heading_error(aim.offset.y.atan2(aim.offset.x) - ship.rotation);
            let thrust = if ship.acceleration <= 0.0
                || !repositioning && (angle.abs() >= 1.3 || distance <= follow)
            {
                0.0
            } else if repositioning || pass > 0.0 {
                1.0
            } else {
                arrival_thrust(
                    ship,
                    rules,
                    target_direction,
                    destination.velocity,
                    target_acceleration,
                    distance - follow,
                )
            };
            (aim.offset, thrust, aim_turn(ship, angle, aim.bearing_rate))
        } else {
            let relative = ship.velocity - velocity;
            let lateral = relative - direction * relative.dot(direction);
            let mut heading = velocity + (direction * 80.0_f64.max(speed) - lateral * 1.2);
            let mut desired = velocity + direction * speed;
            if chasing && !detour {
                let wanted = velocity.dot(direction) + (distance - follow) * ship.drag;
                desired = direction * wanted.min(ship.maximum_speed).max(0.0);
            }
            let mut acceleration =
                desired * ship.drag + (desired - ship.velocity) * (1.0 / rules.response_time);
            if chasing && !detour {
                acceleration += target_acceleration;
            }
            if detour || follow > 0.0 && acceleration.dot(direction) > 0.0 {
                heading = acceleration;
            }
            let mut angle = heading_error(heading.y.atan2(heading.x) - ship.rotation);
            let mut thrust = 0.0;
            if ship.acceleration > 0.0 && (repositioning || angle.abs() < 1.65) {
                thrust = 1.0;
                if !repositioning && (!detour && pass == 0.0 || detour && follow > 0.0) {
                    thrust = arrival_thrust(
                        ship,
                        rules,
                        target_direction,
                        destination.velocity,
                        target_acceleration,
                        distance - follow,
                    );
                }
            }
            if detour {
                thrust *= 0.0_f64.max(angle.cos());
            }
            if !repositioning
                && follow > 0.0
                && let Some((braking_heading, braking_thrust)) = braking_controls(
                    ship,
                    rules,
                    acceleration,
                    target_direction,
                    destination.velocity,
                )
            {
                heading = braking_heading;
                thrust = braking_thrust;
                angle = heading_error(heading.y.atan2(heading.x) - ship.rotation);
            }
            (
                heading,
                thrust,
                turn_command(angle, ship.maximum_turn_rate, 1.8),
            )
        };
        if let Some(target) = target_entity
            && target.is_ship
            && (destination.pass_distance > 0.0 || follow > 0.0)
        {
            obstacles.push(Obstacle {
                entity_id: target.entity_id,
                velocity: target.velocity,
                acceleration: target_acceleration,
                ..Obstacle::circle(target.position, target.radius)
            });
        }
        if aim.is_some()
            && let Some(direction) = self.reverse_combat_turn(context, destination.target_id, turn)
        {
            heading = direction_of(ship.rotation + direction * 1.4);
            turn = direction;
            thrust = 1.0;
        } else if tracking.is_some() && ship.maximum_turn_rate > 0.0 {
            // Brake toward sharp changes in the target bearing before countersteering.
            let current = (ship.spin / ship.maximum_turn_rate).clamp(-1.0, 1.0);
            turn = turn.clamp(current - 0.35, current + 0.35);
            if turn.abs() < 0.02 {
                turn = 0.0;
            }
        }
        self.avoidance
            .avoid(ship, rules, heading, thrust, turn, obstacles)
    }

    pub fn steer_within(
        &mut self,
        context: FlightContext<'_>,
        movement: &Movement,
        center: Vector,
        radius: f64,
    ) -> (f64, f64) {
        self.steer_within_with_pickup(context, movement, center, radius, None)
    }

    pub fn steer_within_with_pickup(
        &mut self,
        context: FlightContext<'_>,
        movement: &Movement,
        center: Vector,
        radius: f64,
        forecast: Option<&ContactForecast<'_>>,
    ) -> (f64, f64) {
        let control = self.steer_with_pickup(context, movement, forecast);
        if context.launching {
            return control;
        }
        let ship = context.ship;
        let interval = context.rules.decision_interval;
        let travel =
            (ship.velocity.length() + ship.acceleration * interval) * (interval + 1.0 / ship.drag);
        let interior = radius - travel;
        if interior > 0.0 && ship.position.distance_squared(center) < interior * interior {
            return control;
        }
        let stopping = self
            .avoidance
            .stopping_position(ship, context.rules, control.0, control.1);
        if stopping.distance_squared(center) <= radius * radius {
            return control;
        }
        let (mut thrust, turn) = self.steer(
            context,
            &Movement {
                position: center,
                ..Movement::default()
            },
        );
        if direction_of(ship.rotation).dot(center - ship.position) <= 0.0 {
            thrust = 0.0;
        }
        (thrust, turn)
    }

    pub fn attack(
        &mut self,
        mut context: FlightContext<'_>,
        target: FlightTarget,
        options: AttackOptions,
    ) -> (f64, f64, bool) {
        let ship = context.ship;
        let target_offset = target.position - ship.position;
        let distance_squared = target_offset.length_squared();
        let distance = distance_squared.sqrt();
        let relative_velocity = target.velocity - ship.velocity;
        let mut offset = target_offset;
        let mut pass_distance = options.pass_distance;
        let mut follow_distance = 0.0;
        let mut tolerance = options.aim_tolerance;
        match options.weapon {
            AttackWeapon::Beam { range } => {
                pass_distance = 0.0;
                let clearance = ship.radius + target.radius + context.rules.clearance_distance;
                follow_distance = (range * 0.32).max(clearance);
                let angular_width = target.radius.atan2(distance);
                tolerance = tolerance.max((angular_width + 0.12).clamp(0.20, 0.40));
            }
            AttackWeapon::Projectile { speed, cannon } if speed > 0.0 => {
                // Solve |target_offset + relative_velocity * flight| = speed * flight.
                let along = target_offset.dot(relative_velocity);
                let across = target_offset.cross(relative_velocity);
                let denominator =
                    (speed * speed * distance_squared - across * across).sqrt() - along;
                let flight = if denominator > 0.0 {
                    distance_squared / denominator
                } else {
                    (distance / speed).min(options.aim_prediction_time)
                };
                offset = offset.add_scaled(relative_velocity, flight);
                if cannon {
                    tolerance = tolerance.max(0.20);
                }
            }
            _ => {}
        }
        if self.target_id != target.entity_id {
            self.combat_turn = None;
        }
        let angle = heading_error(offset.y.atan2(offset.x) - ship.rotation);
        let bearing_rate = offset.cross(relative_velocity) / offset.length_squared().max(1.0);
        let fire = options.can_fire && angle.abs() <= tolerance;
        context.target = Some(target);
        let (thrust, turn) = self.steer_with_aim(
            context,
            &Movement {
                position: target.position,
                velocity: target.velocity,
                pass_distance,
                follow_distance,
                target_id: target.entity_id,
                ..Movement::default()
            },
            None,
            Some(AttackAim {
                offset,
                bearing_rate,
                armed: !matches!(options.weapon, AttackWeapon::None),
                firing: fire,
            }),
        );
        (thrust, turn, fire)
    }

    fn reverse_combat_turn(
        &mut self,
        context: FlightContext<'_>,
        target_id: i64,
        turn: f64,
    ) -> Option<f64> {
        let tick = context.tick;
        let ticks = |seconds: f64| (seconds / context.simulation_step).ceil() as u64;
        let recent = self.combat_turn.filter(|previous| {
            tick.saturating_sub(previous.last_tick) <= ticks(context.rules.decision_interval * 2.0)
        });
        if let Some(mut previous) =
            recent.filter(|previous| previous.reversing && tick < previous.change_at)
        {
            previous.last_tick = tick;
            self.combat_turn = Some(previous);
            return Some(previous.direction);
        }
        if turn.abs() < 0.06 {
            self.combat_turn = None;
            return None;
        }
        let direction = turn.signum();
        if let Some(mut previous) =
            recent.filter(|previous| !previous.reversing && previous.direction == direction)
        {
            previous.last_tick = tick;
            if tick >= previous.change_at {
                previous.reversing = true;
                previous.direction = -direction;
                previous.change_at = tick + ticks(1.0);
                self.passing = None;
            }
            self.combat_turn = Some(previous);
            return previous.reversing.then_some(previous.direction);
        }
        let seed = context.ship.position.x.to_bits()
            ^ context.ship.position.y.to_bits().rotate_left(21)
            ^ (target_id as u64).rotate_left(43)
            ^ tick.rotate_left(11);
        let mut random = SeededRandom::new(f64::from((seed ^ (seed >> 32)) as u32));
        self.combat_turn = Some(CombatTurn {
            direction,
            change_at: tick + ticks(3.5 + 2.5 * random.next_float()),
            last_tick: tick,
            reversing: false,
        });
        None
    }

    fn observe_target(&mut self, context: FlightContext<'_>, destination: &Movement) -> Vector {
        let mut acceleration = Vector::ZERO;
        if self.target_id == destination.target_id {
            acceleration = self.target_motion.acceleration_at(
                destination.velocity,
                context.tick,
                context.simulation_step,
                context.rules.decision_interval,
            );
            let length = acceleration.length();
            if length > context.ship.acceleration {
                acceleration = acceleration * (context.ship.acceleration / length);
            }
        }
        self.target_id = destination.target_id;
        self.target_motion = MotionObservation {
            velocity: destination.velocity,
            tick: context.tick,
            ..MotionObservation::default()
        };
        acceleration
    }

    fn combat_movement(
        &mut self,
        context: FlightContext<'_>,
        destination: &Movement,
    ) -> (f64, f64, bool) {
        if destination.pass_distance == 0.0 || self.target_id != destination.target_id {
            self.chase_until = 0;
            self.passing = None;
        }
        if destination.pass_distance == 0.0 {
            return (
                destination.follow_distance,
                destination.pass_distance,
                false,
            );
        }
        let ship = context.ship;
        let speed = destination.velocity.length();
        let away = destination
            .velocity
            .dot(destination.position - ship.position)
            > speed * destination.pass_distance * 2.0;
        if speed > ship.maximum_speed * 0.25 && away
            || self.chase_until != 0 && speed > ship.maximum_speed * 0.1
        {
            self.chase_until =
                context.tick + (context.rules.prediction_time / context.simulation_step) as u64;
        }
        if context.tick > self.chase_until {
            self.chase_until = 0;
        }
        if self.chase_until == 0 {
            (
                destination.follow_distance,
                destination.pass_distance,
                false,
            )
        } else {
            (destination.pass_distance * 2.0, 0.0, true)
        }
    }

    fn attack_run(
        &mut self,
        context: FlightContext<'_>,
        destination: &Movement,
        target_radius: f64,
    ) -> Vector {
        let ship = context.ship;
        if let Some(passing) = self.passing {
            let end = destination.position + passing.offset;
            let remaining = end - ship.position;
            if context.tick >= passing.ends_at
                || remaining.length() < 60.0
                || remaining.dot(passing.direction) < 0.0
                || ship.position.distance(destination.position) > 450.0
            {
                self.passing = None;
            } else {
                return end;
            }
        }
        let offset = destination.position - ship.position;
        let mut direction = offset.normalized();
        let drift = ship.velocity - destination.velocity;
        let closing = drift.dot(direction);
        let clearance = ship.radius + target_radius + context.rules.clearance_distance;
        if closing >= 0.0 && offset.length() < clearance + closing * 0.40 {
            if direction.length_squared() == 0.0 {
                direction = direction_of(ship.rotation);
            }
            let mut side = Vector::new(-direction.y, direction.x);
            if drift.dot(side) < 0.0 {
                side = side * -1.0;
            }
            let turn_radius = if ship.maximum_turn_rate > 0.0 {
                ship.velocity.length() / ship.maximum_turn_rate
            } else {
                0.0
            };
            let lateral = destination.pass_distance.max(clearance) + turn_radius * 0.5;
            let offset = direction * (140.0_f64.max(turn_radius * 0.75)) + side * lateral;
            let end = destination.position + offset;
            self.passing = Some(Pass {
                offset,
                direction: (end - ship.position).normalized(),
                ends_at: context.tick + (1.8 / context.simulation_step).ceil() as u64,
            });
            return end;
        }
        destination.position
    }
}

fn aim_turn(ship: ShipMotion, angle: f64, bearing_rate: f64) -> f64 {
    if ship.maximum_turn_rate <= 0.0 {
        return 0.0;
    }
    let desired_rate = bearing_rate + angle * 3.5;
    (desired_rate / ship.maximum_turn_rate).clamp(-1.0, 1.0)
}

pub fn intercept_position(
    context: FlightContext<'_>,
    target: &Movement,
    radius: f64,
    obstacles: &[Obstacle],
) -> Vector {
    let ship = context.ship;
    let lead = (context.rules.response_time * 2.0)
        .min(ship.position.distance(target.position) / ship.maximum_speed.max(1.0));
    let interval = context.rules.decision_interval;
    let mut elapsed = interval.min(lead);
    let mut position = target.position;
    while elapsed > 0.0 {
        let next = target.position.add_scaled(target.velocity, elapsed);
        if !clear_segment(position, next, radius, obstacles, false) {
            break;
        }
        position = next;
        if elapsed == lead {
            break;
        }
        elapsed = (elapsed + interval).min(lead);
    }
    position
}

pub(super) fn direction_of(angle: f64) -> Vector {
    let (sin, cos) = angle.sin_cos();
    Vector::new(cos, sin)
}
