//! Ordered island solving and continuous collision detection.

use super::motion_sweep::Sweep;
use crate::collision::{BaseShape, ToiInput, find_time_of_impact};
use crate::utilities::vector::Vector;

use super::body::{Position, Velocity};
use super::contact::ToiQueue;
use super::{Body, BodyId, ContactId, ContactListener, PhysicsRules, World};

pub(super) const MAX_TOI_SUBSTEPS: u8 = 8;
const TOI_END_TOLERANCE: f64 = 1e-8;

#[derive(Clone, Copy)]
pub(super) struct TimeStep {
    pub dt: f64,
    pub velocity_iterations: i32,
    pub position_iterations: i32,
}

#[derive(Default)]
pub(super) struct Solver {
    stack: Vec<BodyId>,
    bodies: Vec<BodyId>,
    contacts: Vec<ContactId>,
    isolated: Vec<BodyId>,
}

impl Solver {
    fn clear(&mut self) {
        self.stack.clear();
        self.bodies.clear();
        self.contacts.clear();
    }

    pub fn solve_world<T>(&mut self, world: &mut World<T>, step: TimeStep) {
        self.isolated.clear();
        for index in (0..world.active_bodies.len()).rev() {
            let seed = world.active_bodies[index];
            let body = world.bodies.get_mut(&seed).expect("active body is live");
            if body.island || body.parked {
                continue;
            }
            body.island = true;
            if body.solver_contacts.is_empty() {
                self.isolated.push(seed);
                continue;
            }
            self.clear();
            self.stack.push(seed);
            while let Some(body) = self.stack.pop() {
                self.bodies.push(body);
                for index in 0..world.bodies[&body].solver_contacts.len() {
                    let id = world.bodies[&body].solver_contacts[index];
                    let contact = world.contacts.get_mut(&id).expect("solver contact is live");
                    if contact.island || !contact.enabled || !contact.touching || !contact.physical
                    {
                        continue;
                    }
                    self.contacts.push(id);
                    contact.island = true;
                    let other_id = contact.other(body);
                    let other = world
                        .bodies
                        .get_mut(&other_id)
                        .expect("contact body is live");
                    if !other.island {
                        self.stack.push(other_id);
                        other.island = true;
                    }
                }
            }
            self.solve_island(world, step);
        }
        self.clear();
        if !self.isolated.is_empty() {
            std::mem::swap(&mut self.bodies, &mut self.isolated);
            self.solve_island(world, step);
            std::mem::swap(&mut self.bodies, &mut self.isolated);
        }
    }

    fn prepare_island<T>(&self, world: &mut World<T>, toi: bool) {
        for id in &self.bodies {
            let body = world.bodies.get_mut(id).expect("island body is live");
            if !toi {
                body.sweep.c0 = body.sweep.c;
                body.sweep.a0 = body.sweep.a;
            }
            body.solver_position = Position {
                c: body.sweep.c,
                a: body.sweep.a,
            };
            body.solver_velocity = Velocity {
                v: body.linear_velocity,
                w: body.angular_velocity,
            };
        }
        for id in &self.contacts {
            let contact = world.contacts.get_mut(id).expect("island contact is live");
            contact.init_constraint(
                &world.fixtures[&contact.fixture_a],
                &world.bodies[&contact.body_a],
                &world.fixtures[&contact.fixture_b],
                &world.bodies[&contact.body_b],
            );
        }
    }

    fn solve_velocity<T>(&self, world: &mut World<T>, step: TimeStep) {
        for id in &self.contacts {
            let contact = world.contacts.get_mut(id).expect("island contact is live");
            contact.init_velocity(
                &world.bodies[&contact.body_a],
                &world.bodies[&contact.body_b],
                world.rules.contact_speed_threshold,
            );
        }
        for _ in 0..step.velocity_iterations {
            let mut converged = true;
            for id in &self.contacts {
                let contact = world.contacts.get_mut(id).expect("island contact is live");
                let [Some(a), Some(b)] = world
                    .bodies
                    .get_disjoint_mut([&contact.body_a, &contact.body_b])
                else {
                    unreachable!("two live bodies per contact");
                };
                if !contact.solve_velocity(a, b) {
                    converged = false;
                }
            }
            if converged {
                break;
            }
        }
    }

    fn solve_position<T>(&self, world: &mut World<T>, step: TimeStep, toi: Option<[BodyId; 2]>) {
        let slop = if toi.is_some() { -1.5 } else { -3.0 } * world.rules.linear_slop;
        for _ in 0..step.position_iterations {
            let mut min_separation = 0.0_f64;
            for id in &self.contacts {
                let contact = &world.contacts[id];
                let [Some(a), Some(b)] = world
                    .bodies
                    .get_disjoint_mut([&contact.body_a, &contact.body_b])
                else {
                    unreachable!("two live bodies per contact");
                };
                min_separation = min_separation.min(contact.solve_position(a, b, world.rules, toi));
            }
            if min_separation >= slop {
                break;
            }
        }
    }

    fn integrate_island<T>(&self, world: &mut World<T>, dt: f64) {
        for id in &self.bodies {
            let body = world.bodies.get_mut(id).expect("island body is live");
            integrate(body, dt, world.rules);
        }
    }

    fn finish_island<T>(&self, world: &mut World<T>) {
        for id in &self.bodies {
            let body = world.bodies.get_mut(id).expect("island body is live");
            body.sweep.c = body.solver_position.c;
            body.sweep.a = body.solver_position.a;
            body.linear_velocity = body.solver_velocity.v;
            body.angular_velocity = body.solver_velocity.w;
            body.synchronize_transform();
        }
    }

    fn solve_island<T>(&self, world: &mut World<T>, step: TimeStep) {
        self.prepare_island(world, false);
        self.solve_velocity(world, step);
        self.integrate_island(world, step.dt);
        self.solve_position(world, step, None);
        self.finish_island(world);
    }

    pub fn solve_world_toi<T>(
        &mut self,
        world: &mut World<T>,
        step: TimeStep,
        listener: &mut impl ContactListener<T>,
    ) {
        world.toi_revision += 1;
        world.toi_unsorted = false;
        world.toi_pending.clear();
        world.toi_ready.clear();
        world.collecting_toi = true;
        for id in world.active_bodies.iter().rev() {
            let body = world.bodies.get_mut(id).expect("active body is live");
            body.island = false;
            body.sweep.alpha0 = 0.0;
        }
        for index in (0..world.contact_order.len()).rev() {
            let Some(id) = world.contact_order[index] else {
                continue;
            };
            let contact = world
                .contacts
                .get_mut(&id)
                .expect("ordered contact is live");
            contact.toi_valid = false;
            contact.island = false;
            contact.toi_count = if contact.touching {
                MAX_TOI_SUBSTEPS + 1
            } else {
                0
            };
            contact.toi = 1.0;
            contact.toi_queue = ToiQueue::None;
            if !world.allows_collision(id) {
                let contact = world
                    .contacts
                    .get_mut(&id)
                    .expect("ordered contact is live");
                contact.enabled = false;
                contact.touching = false;
                continue;
            }
            world.add_toi_candidate(id);
        }
        loop {
            self.evaluate_toi_candidates(world);
            let Some(&id) = world.toi_ready.first() else {
                break;
            };
            let impact = world.contacts[&id].toi;
            world.remove_toi_candidate(id);
            if 1.0 - TOI_END_TOLERANCE < impact {
                break;
            }
            let contact = &world.contacts[&id];
            let seed = [contact.body_a, contact.body_b];
            let [Some(a), Some(b)] = world.bodies.get_disjoint_mut([&seed[0], &seed[1]]) else {
                unreachable!("two live bodies per contact");
            };
            let backups = [a.sweep, b.sweep];
            a.advance(impact);
            b.advance(impact);
            world.update_contact(id, listener);
            let contact = world.contacts.get_mut(&id).expect("TOI contact is live");
            contact.toi_valid = false;
            contact.toi_count += 1;
            if contact.toi_count > MAX_TOI_SUBSTEPS {
                world.remove_toi_candidate(id);
            }
            let contact = world.contacts.get_mut(&id).expect("TOI contact is live");
            if !contact.enabled || !contact.touching || !contact.physical {
                if !contact.enabled || !contact.touching {
                    contact.enabled = false;
                } else {
                    contact.toi = 1.0;
                    contact.toi_valid = true;
                    world.remove_toi_candidate(id);
                }
                for (&body, sweep) in seed.iter().zip(backups) {
                    let body = world.bodies.get_mut(&body).expect("TOI body is live");
                    body.sweep = sweep;
                    body.synchronize_transform();
                }
                continue;
            }
            self.clear();
            self.bodies.extend(seed);
            self.contacts.push(id);
            contact.island = true;
            for body in seed {
                world
                    .bodies
                    .get_mut(&body)
                    .expect("TOI body is live")
                    .island = true;
            }
            for body in seed {
                for index in (0..world.bodies[&body].contacts.len()).rev() {
                    let id = world.bodies[&body].contacts[index];
                    let contact = &world.contacts[&id];
                    if contact.island || !contact.physical {
                        continue;
                    }
                    let other_id = contact.other(body);
                    let other = world
                        .bodies
                        .get_mut(&other_id)
                        .expect("TOI neighbor is live");
                    let backup = other.sweep;
                    if !other.island {
                        other.advance(impact);
                    }
                    world.update_contact(id, listener);
                    let contact = world.contacts.get_mut(&id).expect("TOI contact is live");
                    let other = world
                        .bodies
                        .get_mut(&other_id)
                        .expect("TOI neighbor is live");
                    if !contact.enabled || !contact.touching {
                        other.sweep = backup;
                        other.synchronize_transform();
                        continue;
                    }
                    contact.island = true;
                    self.contacts.push(id);
                    if !other.island {
                        other.island = true;
                        self.bodies.push(other_id);
                    }
                }
            }
            let substep = TimeStep {
                dt: (1.0 - impact) * step.dt,
                position_iterations: 20,
                velocity_iterations: step.velocity_iterations,
            };
            self.solve_island_toi(world, substep, seed);
            world.toi_revision += 1;
            for &body in &self.bodies {
                world
                    .bodies
                    .get_mut(&body)
                    .expect("TOI body is live")
                    .island = false;
                world.synchronize_fixtures(body);
                for index in (0..world.bodies[&body].contacts.len()).rev() {
                    let id = world.bodies[&body].contacts[index];
                    world
                        .contacts
                        .get_mut(&id)
                        .expect("TOI contact is live")
                        .toi_valid = false;
                    world.add_toi_candidate(id);
                    world
                        .contacts
                        .get_mut(&id)
                        .expect("TOI contact is live")
                        .island = false;
                }
            }
            world.find_new_contacts(listener);
        }
        world.collecting_toi = false;
    }

    fn evaluate_toi_candidates<T>(&self, world: &mut World<T>) {
        if world.toi_unsorted {
            world.toi_pending.sort_unstable_by(|a, b| b.cmp(a));
        }
        let slop = world.rules.linear_slop;
        for index in 0..world.toi_pending.len() {
            let id = world.toi_pending[index];
            let contact = world.contacts.get_mut(&id).expect("TOI contact is live");
            contact.toi_queue = ToiQueue::None;
            if !contact.enabled || contact.toi_count > MAX_TOI_SUBSTEPS {
                continue;
            }
            if !contact.toi_valid {
                let shape_a = world.fixtures[&contact.fixture_a].shape.base();
                let shape_b = world.fixtures[&contact.fixture_b].shape.base();
                let [Some(a), Some(b)] = world
                    .bodies
                    .get_disjoint_mut([&contact.body_a, &contact.body_b])
                else {
                    unreachable!("two live bodies per contact");
                };
                let mut alpha0 = a.sweep.alpha0;
                if a.sweep.alpha0 < b.sweep.alpha0 {
                    alpha0 = b.sweep.alpha0;
                    a.sweep.advance(alpha0);
                } else if b.sweep.alpha0 < a.sweep.alpha0 {
                    b.sweep.advance(alpha0);
                }
                let pair = world
                    .pairs
                    .get_mut(&contact.pair)
                    .expect("TOI contact pair is live");
                let (pair_a, pair_b) = if pair.a == contact.body_a {
                    (&*a, &*b)
                } else {
                    (&*b, &*a)
                };
                let radius = shape_a.radius + shape_b.radius;
                let target = slop.max(radius - 3.0 * slop);
                let cached_separation = contact.separation_until > 0.0
                    && contact.separation_until + radius
                        > pair.motion(pair_a, pair_b)
                            + pair.sweep_motion(pair_a, pair_b, world.toi_revision)
                            + target
                            + 1.25 * slop;
                let mut alpha = 1.0;
                if !cached_separation
                    && !separated_throughout(shape_a, &mut a.sweep, shape_b, &mut b.sweep, slop)
                {
                    let (mut sweep_a, mut sweep_b) = (a.sweep, b.sweep);
                    let result = find_time_of_impact(
                        ToiInput {
                            proxy_a: shape_a,
                            proxy_b: shape_b,
                            sweep_a: &mut sweep_a,
                            sweep_b: &mut sweep_b,
                            t_max: 1.0,
                        },
                        slop,
                    );
                    if result.touching {
                        alpha = (alpha0 + (1.0 - alpha0) * result.t).min(1.0);
                    }
                }
                contact.toi = alpha;
                contact.toi_valid = true;
            }
            if contact.toi < 1.0 {
                world.push_toi(id);
            }
        }
        world.toi_unsorted = false;
        world.toi_pending.clear();
    }

    fn solve_island_toi<T>(&self, world: &mut World<T>, step: TimeStep, toi: [BodyId; 2]) {
        self.prepare_island(world, true);
        self.solve_position(world, step, Some(toi));
        for id in toi {
            let body = world.bodies.get_mut(&id).expect("TOI body is live");
            body.sweep.c0 = body.solver_position.c;
            body.sweep.a0 = body.solver_position.a;
        }
        self.solve_velocity(world, step);
        self.integrate_island(world, step.dt);
        self.finish_island(world);
    }
}

fn integrate(body: &mut Body, dt: f64, rules: PhysicsRules) {
    let max_translation = rules.physics.max_translation;
    let max_rotation = rules.physics.max_rotation;
    let velocity = &mut body.solver_velocity;
    let length_squared = (velocity.v * dt).length_squared();
    if length_squared > max_translation * max_translation {
        velocity.v = velocity.v * (max_translation / length_squared.sqrt());
    }
    let rotation = dt * velocity.w;
    if rotation * rotation > max_rotation * max_rotation {
        velocity.w *= max_rotation / rotation.abs();
    }
    let position = &mut body.solver_position;
    position.c = position.c.add_scaled(velocity.v, dt);
    position.a += dt * velocity.w;
}

pub(super) fn separated_throughout(
    shape_a: &BaseShape,
    sweep_a: &mut Sweep,
    shape_b: &BaseShape,
    sweep_b: &mut Sweep,
    slop: f64,
) -> bool {
    let (bound_a, bound_b) = (shape_a.bound(), shape_b.bound());
    let (rot_a, rot_b) = (sweep_a.rotation0(), sweep_b.rotation0());
    let center_a = Vector::new(
        sweep_a.c0.x + rot_a.cos * bound_a.x - rot_a.sin * bound_a.y,
        sweep_a.c0.y + rot_a.sin * bound_a.x + rot_a.cos * bound_a.y,
    );
    let center_b = Vector::new(
        sweep_b.c0.x + rot_b.cos * bound_b.x - rot_b.sin * bound_b.y,
        sweep_b.c0.y + rot_b.sin * bound_b.x + rot_b.cos * bound_b.y,
    );
    let delta = center_b - center_a;
    let relative = (sweep_b.c - sweep_b.c0) - (sweep_a.c - sweep_a.c0);
    let length = relative.length_squared();
    let fraction = if length > 0.0 {
        (-delta.dot(relative) / length).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let distance = delta.add_scaled(relative, fraction);
    let rotation = bound_a.offset_radius * (sweep_a.a - sweep_a.a0).abs()
        + bound_b.offset_radius * (sweep_b.a - sweep_b.a0).abs();
    let target = slop.max(shape_a.radius + shape_b.radius - 3.0 * slop);
    let radius = bound_a.radius + bound_b.radius + rotation + target + 1.25 * slop + 1e-7;
    distance.length_squared() > radius * radius
}
