//! Detached pickup and docking forecasts using the real rigid-body solver.

use crate::gameplay::collision_world::{ObjectCollider, PreparedCollisionBody};
use crate::gameplay::game_collisions::{GameplayCollider, Pose};
use crate::physics::{
    BodyId, ContactContext, ContactListener, Fixture, FixtureOptions, PhysicsRules, World,
};
use crate::simulation::game_object::{GameObject, MotionContext};
use crate::simulation::geometry::move_point;
use crate::simulation::local_movement::MovementParent;
use crate::specs::Catalog;
use crate::utilities::vector::Vector;
use crate::utilities::vector_math::RotValue;

use super::flight::direction_of;
use super::navigation::{DockingForecast, DockingStation, docking_position};
use super::prediction::ShipMotion;
use super::steering::{heading_error, turn_command};

pub const COLLECTION_TURN_GAIN: f64 = 3.5;

#[derive(Clone, Copy, Debug)]
pub enum ForecastKind {
    Ship,
    Station { local_movement_radius: f64 },
    Asteroid,
    GameObject,
}

pub struct ForecastSource<'a> {
    pub object: &'a GameObject,
    pub kind: ForecastKind,
    pub prepared: Option<PreparedCollisionBody<'a, ObjectCollider>>,
}

pub struct ForecastOptions<'a> {
    pub catalog: &'a Catalog,
    pub ship_motion: ShipMotion,
    pub tick: u64,
    pub docking: bool,
    pub can_dock: bool,
    pub can_collect: bool,
    pub centers: &'a [Vector],
}

struct ForecastBody {
    object: GameObject,
    id: BodyId,
    velocity: Vector,
    spin: f64,
}

pub struct ContactPrediction {
    pub safe: bool,
    pub arrived: bool,
    pub seconds: f64,
    pub distance: f64,
    pub ship: GameObject,
    pub target: GameObject,
}

pub struct ContactForecast<'a> {
    sources: Vec<ForecastSource<'a>>,
    options: ForecastOptions<'a>,
    pub rocks: bool,
}

impl<'a> ContactForecast<'a> {
    pub fn new(
        options: ForecastOptions<'a>,
        ship: ForecastSource<'a>,
        target: ForecastSource<'a>,
        nearby: impl IntoIterator<Item = ForecastSource<'a>>,
    ) -> Self {
        let mut sources = vec![ship, target];
        let mut rocks = false;
        for source in nearby {
            let object = source.object;
            if object.dead || object.id == sources[1].object.id || object.id == sources[0].object.id
            {
                continue;
            }
            let padding = match source.kind {
                ForecastKind::Station { .. } => options.ship_motion.maximum_speed * 6.0,
                ForecastKind::Asteroid
                    if source
                        .prepared
                        .as_ref()
                        .is_some_and(|body| body.fixtures().next().is_some()) =>
                {
                    60.0
                }
                _ => continue,
            };
            let reach = object.radius + options.ship_motion.radius + padding;
            if sources[0].object.position.distance_squared(object.position) < reach * reach
                || sources[1].object.position.distance_squared(object.position) < reach * reach
            {
                rocks |= matches!(source.kind, ForecastKind::Asteroid);
                sources.push(source);
            }
        }
        Self {
            sources,
            options,
            rocks,
        }
    }

    pub fn target(&self) -> &GameObject {
        self.sources[1].object
    }

    pub fn centers(&self) -> &[Vector] {
        self.options.centers
    }

    pub fn source_ids(&self) -> impl Iterator<Item = i64> + '_ {
        self.sources.iter().map(|source| source.object.id)
    }

    pub fn predict(
        &self,
        mut thrust: f64,
        mut turn: f64,
        horizon: f64,
        bay: f64,
    ) -> Option<ContactPrediction> {
        let rules = &self.options.catalog.simulation;
        let motion = self.options.ship_motion;
        let mut world = World::new(rules);
        let mut bodies = Vec::with_capacity(self.sources.len());
        for (index, source) in self.sources.iter().enumerate() {
            let prepared = source.prepared.as_ref()?;
            let mut object = source.object.clone();
            object.speed_limit = if index == 0 {
                motion.maximum_speed
            } else {
                source.object.max_speed()
            };
            let id = world.create_body();
            world.set_transform(id, object.position, object.rotation);
            world.set_inverse_mass(
                id,
                prepared.body.inverse_mass(),
                prepared.body.inverse_inertia(),
            );
            for fixture in prepared.fixtures() {
                world.create_fixture(
                    id,
                    fixture.shape.clone(),
                    FixtureOptions {
                        user_data: fixture.user_data,
                        physical: fixture.physical,
                    },
                );
            }
            world.set_proxy_radius(id, prepared.radius);
            bodies.push(ForecastBody {
                object,
                id,
                velocity: Vector::ZERO,
                spin: 0.0,
            });
        }
        let mut listener = ForecastContacts {
            options: &self.options,
            sources: &self.sources,
            rules: rules.into(),
            frame_tick: self.options.tick,
            safe: true,
            arrived: false,
            target_dead: false,
        };
        let dt = rules.simulation_step;
        let substeps = rules.update_tiers["visible"].substeps;
        let drift_substeps = rules.update_tiers["drift"].substeps;
        let interval =
            1.max((self.options.catalog.npc_movement.decision_interval / dt).round() as u64);
        let mut parents = Vec::new();
        let mut seconds = 0.0;
        for tick in 0..(horizon / dt).ceil() as u64 {
            if tick > 0 && tick % interval == 0 {
                (thrust, turn) = self.controls_for(&bodies[0].object, &bodies[1].object, bay);
            }
            for index in 0..bodies.len() {
                parents.clear();
                for (body, source) in bodies.iter().zip(&self.sources) {
                    if let ForecastKind::Station {
                        local_movement_radius,
                    } = source.kind
                    {
                        let object = &body.object;
                        let mut parent = MovementParent::radial(
                            object.id,
                            object.position,
                            object.spin,
                            local_movement_radius,
                        );
                        parent.dead = object.dead;
                        parents.push(parent);
                    }
                }
                let future = &mut bodies[index];
                let object = &mut future.object;
                let start = Pose {
                    position: object.position,
                    rotation: object.rotation,
                };
                let craft = matches!(
                    self.sources[index].kind,
                    ForecastKind::Ship | ForecastKind::Station { .. }
                );
                let steps = if !craft && object.velocity == Vector::ZERO {
                    drift_substeps
                } else {
                    substeps
                };
                let step = dt / f64::from(steps);
                for _ in 0..steps {
                    if index == 0 {
                        let turn_acceleration = motion.angular_acceleration * step;
                        object.spin += (turn * motion.maximum_turn_rate - object.spin)
                            .clamp(-turn_acceleration, turn_acceleration);
                        object.velocity = move_point(
                            object.velocity,
                            object.rotation + object.spin * step,
                            motion.acceleration * thrust * step,
                        );
                    }
                    object.update(
                        step,
                        MotionContext {
                            parents: &parents,
                            ..MotionContext::default()
                        },
                    );
                }
                future.velocity = (object.position - start.position) * (1.0 / dt);
                future.spin = (object.rotation - start.rotation) / dt;
                world.set_transform(future.id, start.position, start.rotation);
                let body = world.body_mut(future.id).expect("forecast body is live");
                body.linear_velocity = future.velocity;
                body.angular_velocity = future.spin;
            }
            listener.frame_tick = self.options.tick + tick;
            listener.target_dead = bodies[1].object.dead;
            world.step_with(
                dt,
                rules.physics.velocity_iterations,
                rules.physics.position_iterations,
                &mut listener,
            );
            for future in &mut bodies {
                let body = world.body(future.id).expect("forecast body is live");
                future.object.position = body.position();
                future.object.rotation = body.angle();
                future.object.velocity += body.linear_velocity - future.velocity;
                future.object.spin += body.angular_velocity - future.spin;
                future.object.round_motion();
            }
            seconds = (tick + 1) as f64 * dt;
            if listener.arrived || !listener.safe {
                break;
            }
        }
        let mut objects = bodies.into_iter().map(|body| body.object);
        let ship = objects.next().expect("forecast created the ship");
        let target = objects.next().expect("forecast created the target");
        let (sin, cos) = (-ship.rotation).sin_cos();
        let local = RotValue { sin, cos }.rotate(target.position - ship.position);
        let distance = self
            .options
            .centers
            .iter()
            .map(|&center| local.distance(center))
            .fold(f64::INFINITY, f64::min);
        Some(ContactPrediction {
            safe: listener.safe,
            arrived: listener.arrived,
            seconds,
            distance,
            ship,
            target,
        })
    }

    pub fn controls_for(&self, ship: &GameObject, target: &GameObject, bay: f64) -> (f64, f64) {
        let motion = self.options.ship_motion;
        let docking = self.options.docking;
        let station = DockingStation {
            id: target.id,
            position: target.position,
            velocity: target.velocity,
            rotation: target.rotation,
            spin: target.spin,
            radius: target.radius,
            bays: &[],
        };
        let position = if docking {
            let ship_motion = ShipMotion {
                position: ship.position,
                velocity: ship.velocity,
                model_radius: ship.radius,
                ..motion
            };
            let parent_rate =
                (ship.local_movement.parent == Some(target.id)).then_some(ship.local_movement.rate);
            docking_position(ship_motion, station, bay, parent_rate)
        } else {
            target.position
        };
        let direction = (position - ship.position).normalized();
        let drift = ship.velocity - target.velocity;
        let lateral = drift - direction * drift.dot(direction);
        let mut course = direction * motion.maximum_speed.max(80.0) - lateral * 1.2;
        let mut gain = COLLECTION_TURN_GAIN;
        let mut thrust = 1.0;
        if self.rocks && !docking {
            gain = 1.8;
            let speed = motion
                .maximum_speed
                .min(40.0 + ship.position.distance(target.position) * ship.drag * 0.8);
            course = target.velocity + (direction * speed.max(80.0) - lateral * 1.2);
            let desired = target.velocity + direction * speed;
            let response = self.options.catalog.npc_movement.response_time;
            let acceleration = desired * ship.drag + (desired - ship.velocity) * (1.0 / response);
            thrust = if motion.acceleration > 0.0 {
                (acceleration.dot(direction_of(ship.rotation)) / motion.acceleration)
                    .clamp(0.0, 1.0)
            } else {
                0.0
            };
        }
        if docking {
            course += target.velocity;
            gain = 1.8;
        }
        let angle = heading_error(course.y.atan2(course.x) - ship.rotation);
        if docking && angle.abs() >= 1.65 {
            thrust = 0.0;
        }
        (thrust, turn_command(angle, motion.maximum_turn_rate, gain))
    }
}

impl DockingForecast for ContactForecast<'_> {
    fn controls(&mut self, bay: f64) -> (f64, f64) {
        self.controls_for(self.sources[0].object, self.sources[1].object, bay)
    }

    fn reaches_bay(&mut self, bay: f64, thrust: f64, turn: f64, horizon: f64) -> bool {
        self.predict(thrust, turn, horizon, bay)
            .is_some_and(|prediction| prediction.safe && prediction.arrived)
    }
}

struct ForecastContacts<'a> {
    options: &'a ForecastOptions<'a>,
    sources: &'a [ForecastSource<'a>],
    rules: PhysicsRules,
    frame_tick: u64,
    safe: bool,
    arrived: bool,
    target_dead: bool,
}

impl ContactListener<ObjectCollider> for ForecastContacts<'_> {
    fn can_contact(&mut self, a: &Fixture<ObjectCollider>, b: &Fixture<ObjectCollider>) -> bool {
        a.user_data.can_contact(b.user_data) && b.user_data.can_contact(a.user_data)
    }

    fn pre_solve(&mut self, context: ContactContext<'_, ObjectCollider>) {
        let (a, b) = (context.fixture_a.user_data, context.fixture_b.user_data);
        let ship = self.sources[0].object;
        let target = self.sources[1].object;
        let docking = self.options.docking;
        let ship_and_target = a.owner == ship.id && b.owner == target.id
            || a.owner == target.id && b.owner == ship.id;
        if docking
            && self.options.can_dock
            && ship_and_target
            && (a.owner == target.id && a.dock_segment || b.owner == target.id && b.dock_segment)
        {
            self.arrived = true;
        }
        if !docking && ship_and_target && a.cargo_contact_allowed(b) {
            let dropped = target.dropped_by.is_some()
                && target.dropped_by == ship.player_number
                && self.frame_tick < target.pickup_after;
            if self.options.can_collect && !dropped && !self.target_dead {
                self.arrived = true;
            }
            return;
        }
        if !context.contact.physical {
            return;
        }
        let a_source = self
            .sources
            .iter()
            .find(|source| source.object.id == a.owner)
            .expect("forecast collider belongs to a source");
        let b_source = self
            .sources
            .iter()
            .find(|source| source.object.id == b.owner)
            .expect("forecast collider belongs to a source");
        if matches!(a_source.kind, ForecastKind::Station { .. })
            && b.owner == ship.id
            && !a.dock_segment
            || matches!(b_source.kind, ForecastKind::Station { .. })
                && a.owner == ship.id
                && !b.dock_segment
        {
            self.safe = false;
        }
        let manifold = context.world_manifold();
        let va = context
            .body_a
            .linear_velocity_from_world_point(manifold.points[0]);
        let vb = context
            .body_b
            .linear_velocity_from_world_point(manifold.points[0]);
        let speed = a.material.speed + b.material.speed;
        let impact = speed - (vb - va).dot(manifold.normal);
        let inverse_mass = 1.0 / a_source.object.force_mass() + 1.0 / b_source.object.force_mass();
        if (impact / inverse_mass - self.rules.physics.damage_base)
            / self.rules.physics.damage_scale
            >= 0.5
        {
            self.safe = false;
        }
        context.contact.surface_speed = speed;
        context.contact.friction = (a.material.friction * b.material.friction).sqrt();
        context.contact.restitution = if impact >= self.rules.contact_speed_threshold {
            ((a.material.bounciness + b.material.bounciness) / 2.0).max(0.0)
        } else {
            0.0
        };
    }
}
