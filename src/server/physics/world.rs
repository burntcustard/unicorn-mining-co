//! Body and fixture ownership, contact ordering, and the physics step lifecycle.

use std::collections::VecDeque;

use hashbrown::hash_set::Entry;
use hashbrown::{HashMap, HashSet};

use crate::collision::{BroadPhase, Shape, WorldManifold};
use crate::utilities::vector::Vector;
use crate::utilities::vector_math::TransformValue;

use super::arena::Arena;
use super::body_pair::BodyPair;
use super::contact::{ToiQueue, evaluate};
use super::solver::{MAX_TOI_SUBSTEPS, Solver, TimeStep};
use super::{
    Body, BodyId, Contact, ContactId, Fixture, FixtureId, FixtureOptions, PairKey, PhysicsRules,
};

pub struct ContactContext<'a, T> {
    pub fixture_a: &'a Fixture<T>,
    pub fixture_b: &'a Fixture<T>,
    pub body_a: &'a Body,
    pub body_b: &'a Body,
    pub contact: &'a mut Contact,
}

impl<T> ContactContext<'_, T> {
    pub fn world_manifold(&self) -> WorldManifold {
        self.contact
            .world_manifold(self.fixture_a, self.body_a, self.fixture_b, self.body_b)
    }
}

pub trait ContactListener<T> {
    /// Check both fixture filters in pair order.
    fn can_contact(&mut self, _first: &Fixture<T>, _second: &Fixture<T>) -> bool {
        true
    }

    fn pre_solve(&mut self, _context: ContactContext<'_, T>) {}
}

impl<T> ContactListener<T> for () {}

fn fixture_pair(a: FixtureId, b: FixtureId) -> (FixtureId, FixtureId) {
    if a < b { (a, b) } else { (b, a) }
}

pub struct World<T = u64> {
    pub rules: PhysicsRules,
    pub limit_collision_neighbors: bool,
    broad_phase: BroadPhase<FixtureId, BodyId>,
    // These arenas use server-assigned handles. The solver reads its
    // iteration order from body_order and contact_order.
    pub(super) bodies: Arena<BodyId, Body>,
    pub(super) fixtures: Arena<FixtureId, Fixture<T>>,
    pub(super) contacts: Arena<ContactId, Contact>,
    fixture_pairs: HashSet<(FixtureId, FixtureId)>,
    pub(super) pairs: HashMap<PairKey, BodyPair>,
    pub(super) body_order: Vec<BodyId>,
    // Body IDs increase in creation order. The solver visits the newest first.
    pub(super) active_bodies: Vec<BodyId>,
    pub(super) contact_order: Vec<Option<ContactId>>,
    pub(super) toi_revision: u64,
    pub(super) toi_pending: Vec<ContactId>,
    pub(super) toi_ready: Vec<ContactId>,
    pub(super) toi_unsorted: bool,
    pub(super) collecting_toi: bool,
    new_fixture: bool,
    locked: bool,
    neighbor_epoch: u64,
    contact_pool: VecDeque<Contact>,
    pair_scratch: Vec<(FixtureId, FixtureId)>,
    solver: Solver,
}

impl<T> World<T> {
    pub fn new(rules: impl Into<PhysicsRules>) -> Self {
        let rules = rules.into();
        Self {
            broad_phase: BroadPhase::new(
                rules.physics.aabb_extension,
                rules.physics.aabb_multiplier,
            ),
            rules,
            limit_collision_neighbors: false,
            bodies: Arena::default(),
            fixtures: Arena::default(),
            contacts: Arena::default(),
            fixture_pairs: HashSet::new(),
            pairs: HashMap::new(),
            body_order: Vec::new(),
            active_bodies: Vec::new(),
            contact_order: Vec::new(),
            toi_revision: 0,
            toi_pending: Vec::new(),
            toi_ready: Vec::new(),
            toi_unsorted: false,
            collecting_toi: false,
            new_fixture: false,
            locked: false,
            neighbor_epoch: 0,
            contact_pool: VecDeque::new(),
            pair_scratch: Vec::new(),
            solver: Solver::default(),
        }
    }

    pub fn body(&self, id: BodyId) -> Option<&Body> {
        self.bodies.get(&id)
    }

    pub fn body_mut(&mut self, id: BodyId) -> Option<&mut Body> {
        self.bodies.get_mut(&id)
    }

    pub fn fixture(&self, id: FixtureId) -> Option<&Fixture<T>> {
        self.fixtures.get(&id)
    }

    pub fn replace_fixture_user_data(&mut self, id: FixtureId, user_data: T) -> bool {
        if let Some(fixture) = self.fixtures.get_mut(&id) {
            fixture.user_data = user_data;
            true
        } else {
            false
        }
    }

    /// Iterate newest contacts first, matching the linked contact list.
    pub fn contacts(&self) -> impl Iterator<Item = &Contact> {
        self.contact_order
            .iter()
            .rev()
            .flatten()
            .map(|id| &self.contacts[id])
    }

    pub fn create_body(&mut self) -> BodyId {
        assert!(!self.locked, "Cannot create a body during a step");
        let id = self.bodies.insert(Body::default());
        self.body_order.push(id);
        self.active_bodies.push(id);
        id
    }

    pub fn destroy_body(&mut self, id: BodyId) -> bool {
        if self.locked || self.bodies.get(&id).is_none() {
            return false;
        }
        while let Some(&contact) = self.bodies[&id].contacts.last() {
            self.destroy_contact(contact);
        }
        let body = self
            .bodies
            .remove(&id)
            .expect("body exists through destruction");
        if !body.parked {
            let index = self.active_bodies.binary_search(&id).expect("active body");
            self.active_bodies.remove(index);
        }
        for fixture in body.fixtures.into_iter().rev() {
            if let Some(mut fixture) = self.fixtures.remove(&fixture) {
                fixture.destroy_proxy(&mut self.broad_phase);
            }
        }
        self.body_order.retain(|&other| other != id);
        true
    }

    pub fn create_fixture(
        &mut self,
        id: BodyId,
        shape: Shape,
        options: FixtureOptions<T>,
    ) -> Option<FixtureId> {
        self.set_proxy_radius(id, f64::INFINITY);
        if self.locked {
            return None;
        }
        let body = self.bodies.get_mut(&id)?;
        let fixture_id = self.fixtures.insert(Fixture::new(id, shape, options));
        if !body.parked {
            self.fixtures
                .get_mut(&fixture_id)
                .expect("fixture was just created")
                .create_proxy(&mut self.broad_phase, fixture_id, body.xf);
        }
        body.fixtures.push(fixture_id);
        self.new_fixture = true;
        Some(fixture_id)
    }

    pub fn destroy_fixture(&mut self, id: FixtureId) -> bool {
        let Some(body_id) = self.fixtures.get(&id).map(|fixture| fixture.body) else {
            return false;
        };
        self.set_proxy_radius(body_id, f64::INFINITY);
        if self.locked {
            return false;
        }
        let body = self.bodies.get_mut(&body_id).expect("fixture body is live");
        body.fixtures.retain(|&other| other != id);
        loop {
            let next = self.bodies[&body_id]
                .contacts
                .iter()
                .rev()
                .copied()
                .find(|other| {
                    let contact = &self.contacts[other];
                    contact.fixture_a == id || contact.fixture_b == id
                });
            let Some(contact) = next else { break };
            self.destroy_contact(contact);
        }
        let mut fixture = self
            .fixtures
            .remove(&id)
            .expect("fixture is live during destruction");
        fixture.destroy_proxy(&mut self.broad_phase);
        true
    }

    pub fn set_transform(&mut self, id: BodyId, position: Vector, angle: f64) {
        if self.locked {
            return;
        }
        let Some(body) = self.bodies.get_mut(&id) else {
            return;
        };
        body.set_transform(position, angle);
        if !body.parked {
            let transform = body.xf;
            Self::synchronize_proxies(
                body,
                &mut self.fixtures,
                &mut self.broad_phase,
                transform,
                transform,
            );
        }
    }

    pub fn set_mass(&mut self, id: BodyId, mass: f64, inertia: f64) {
        if !self.locked
            && let Some(body) = self.bodies.get_mut(&id)
        {
            body.set_mass(mass, inertia);
        }
    }

    pub fn set_inverse_mass(&mut self, id: BodyId, mass: f64, inertia: f64) {
        if !self.locked
            && let Some(body) = self.bodies.get_mut(&id)
        {
            body.inv_mass = mass;
            body.inv_inertia = inertia;
        }
    }

    pub fn set_proxy_radius(&mut self, id: BodyId, radius: f64) {
        let Some(body) = self.bodies.get_mut(&id) else {
            return;
        };
        if radius != body.proxy_radius {
            for contact in &body.contacts {
                let contact = self
                    .contacts
                    .get_mut(contact)
                    .expect("body contact is live");
                contact.separation_until = 0.0;
                let pair = self
                    .pairs
                    .get_mut(&contact.pair)
                    .expect("body pair is live");
                pair.motion_ready = false;
                pair.sweep_revision = 0;
            }
        }
        body.proxy_radius = radius;
        body.proxy_motion = 0.0;
        body.proxy_margin = 0.0;
        for fixture in &body.fixtures {
            self.fixtures
                .get_mut(fixture)
                .expect("body fixture is live")
                .proxy_margin = 0.0;
        }
    }

    pub fn park(&mut self, id: BodyId) {
        let Some(body) = self.bodies.get(&id) else {
            return;
        };
        if body.parked {
            return;
        }
        while let Some(&contact) = self.bodies[&id].contacts.last() {
            self.destroy_contact(contact);
        }
        let body = self.bodies.get_mut(&id).expect("body is live");
        body.parked = true;
        body.island = false;
        body.solver_contacts.clear();
        body.sweep.alpha0 = 0.0;
        let index = self.active_bodies.binary_search(&id).expect("active body");
        self.active_bodies.remove(index);
        for fixture in body.fixtures.iter().rev() {
            self.fixtures
                .get_mut(fixture)
                .expect("body fixture is live")
                .destroy_proxy(&mut self.broad_phase);
        }
    }

    pub fn unpark(&mut self, id: BodyId) {
        let Some(body) = self.bodies.get_mut(&id) else {
            return;
        };
        if !body.parked {
            return;
        }
        body.parked = false;
        let index = self
            .active_bodies
            .binary_search(&id)
            .expect_err("parked body");
        self.active_bodies.insert(index, id);
        body.proxy_motion = 0.0;
        body.proxy_margin = 0.0;
        body.proxy_transform = body.xf;
        for &id in body.fixtures.iter().rev() {
            let fixture = self.fixtures.get_mut(&id).expect("body fixture is live");
            fixture.proxy_margin = 0.0;
            fixture.create_proxy(&mut self.broad_phase, id, body.xf);
        }
        self.new_fixture = true;
    }

    pub(super) fn synchronize_fixtures(&mut self, id: BodyId) {
        let body = self.bodies.get_mut(&id).expect("synchronized body is live");
        let from = body.sweep.transform(0.0);
        let to = body.xf;
        Self::synchronize_proxies(body, &mut self.fixtures, &mut self.broad_phase, from, to);
    }

    fn synchronize_proxies(
        body: &mut Body,
        fixtures: &mut Arena<FixtureId, Fixture<T>>,
        broad_phase: &mut BroadPhase<FixtureId, BodyId>,
        from: TransformValue,
        to: TransformValue,
    ) {
        let motion = body.accumulate_proxy_motion(from, to);
        if motion < body.proxy_margin {
            return;
        }
        let mut margin = f64::INFINITY;
        for fixture in body.fixtures.iter().rev() {
            let fixture = fixtures.get_mut(fixture).expect("body fixture is live");
            fixture.synchronize_proxy(broad_phase, from, to, motion);
            margin = margin.min(fixture.proxy_margin);
        }
        body.proxy_margin = margin;
    }

    pub fn step(&mut self, dt: f64, velocity_iterations: i32, position_iterations: i32) {
        self.step_with(dt, velocity_iterations, position_iterations, &mut ());
    }

    pub fn step_with(
        &mut self,
        dt: f64,
        velocity_iterations: i32,
        position_iterations: i32,
        listener: &mut impl ContactListener<T>,
    ) {
        if self.contact_order.len() > 2 * self.contacts.len() + 128 {
            self.contact_order.retain(Option::is_some);
            for (index, id) in self.contact_order.iter().enumerate() {
                self.contacts
                    .get_mut(&id.expect("retained contact is present"))
                    .expect("contact is live")
                    .list_index = index;
            }
        }
        if self.new_fixture {
            self.find_new_contacts(listener);
            self.new_fixture = false;
        }
        self.locked = true;
        for &id in self.active_bodies.iter().rev() {
            let body = self.bodies.get_mut(&id).expect("ordered body is live");
            body.island = false;
            body.solver_contacts.clear();
        }
        if self.limit_collision_neighbors {
            self.prepare_collision_neighbors();
        }
        let step = TimeStep {
            dt,
            velocity_iterations,
            position_iterations,
        };
        self.update_contacts(listener);
        if dt > 0.0 {
            let mut solver = std::mem::take(&mut self.solver);
            solver.solve_world(self, step);
            for index in (0..self.active_bodies.len()).rev() {
                let id = self.active_bodies[index];
                if self.bodies[&id].island {
                    self.synchronize_fixtures(id);
                }
            }
            self.find_new_contacts(listener);
            if self.limit_collision_neighbors {
                self.prepare_collision_neighbors();
            }
            solver.solve_world_toi(self, step, listener);
            self.solver = solver;
        }
        self.locked = false;
        if dt > 0.0 {
            self.recover_overlaps(listener);
        }
    }

    pub(super) fn find_new_contacts(&mut self, listener: &mut impl ContactListener<T>) {
        let mut scratch = std::mem::take(&mut self.pair_scratch);
        self.broad_phase.update_pairs(|a, b| scratch.push((a, b)));
        for (a, b) in scratch.drain(..) {
            self.create_contact(a, b, listener);
        }
        self.pair_scratch = scratch;
    }

    fn prepare_collision_neighbors(&mut self) {
        self.neighbor_epoch += 1;
        for &id in self.active_bodies.iter().rev() {
            let body = &self.bodies[&id];
            if body.pairs.len() <= 8 {
                if body.neighborhood.is_some() {
                    self.bodies
                        .get_mut(&id)
                        .expect("active body is live")
                        .neighborhood = None;
                }
                continue;
            }
            let mut ranked = [(id, f64::INFINITY); 8];
            let mut size = 0;
            for &pair in body.pairs.iter().rev() {
                let other = pair.other(id);
                let distance = body.xf.p.distance_squared(self.bodies[&other].xf.p);
                let mut index = size;
                if index == ranked.len() {
                    if distance >= ranked[index - 1].1 {
                        continue;
                    }
                    index -= 1;
                } else {
                    size += 1;
                }
                while index > 0 && distance < ranked[index - 1].1 {
                    ranked[index] = ranked[index - 1];
                    index -= 1;
                }
                ranked[index] = (other, distance);
            }
            let neighbors = self
                .bodies
                .get_mut(&id)
                .expect("active body is live")
                .neighborhood
                .get_or_insert_with(|| Box::new([id; 8]));
            **neighbors = ranked.map(|(body, _)| body);
        }
    }

    pub(super) fn create_contact(
        &mut self,
        a: FixtureId,
        b: FixtureId,
        listener: &mut impl ContactListener<T>,
    ) {
        let Entry::Vacant(fixtures) = self.fixture_pairs.entry(fixture_pair(a, b)) else {
            return;
        };
        let (fixture_a, fixture_b) = (&self.fixtures[&a], &self.fixtures[&b]);
        let (body_a, body_b) = (fixture_a.body, fixture_b.body);
        if body_a == body_b {
            return;
        }
        let key = PairKey::new(body_a, body_b);
        if !listener.can_contact(fixture_b, fixture_a) {
            return;
        }
        let mut contact = Contact::new((a, fixture_a), (b, fixture_b), self.contact_order.len());
        if let Some(previous) = self.contact_pool.pop_front() {
            contact.reuse_constraint(previous);
        }
        let id = self.contacts.insert(contact);
        self.contact_order.push(Some(id));
        fixtures.insert();
        self.pairs
            .entry(key)
            .or_insert_with(|| BodyPair::new(self.contacts[&id].body_a, self.contacts[&id].body_b))
            .contacts
            .push(id);
        for body_id in [body_a, body_b] {
            let body = self.bodies.get_mut(&body_id).expect("contact body is live");
            body.contacts.push(id);
            body.pairs.retain(|&pair| pair != key);
            body.pairs.push(key);
        }
        if self.collecting_toi {
            self.add_toi_candidate(id);
        }
    }

    fn update_contacts(&mut self, listener: &mut impl ContactListener<T>) {
        let neighbor_epoch = self
            .limit_collision_neighbors
            .then_some(self.neighbor_epoch);
        for index in (0..self.contact_order.len()).rev() {
            let Some(id) = self.contact_order[index] else {
                continue;
            };
            let contact = self.contacts.get_mut(&id).expect("ordered contact is live");
            let (a, b) = (
                &self.fixtures[&contact.fixture_a],
                &self.fixtures[&contact.fixture_b],
            );
            if !matches!(
                (&a.proxy, &b.proxy),
                (Some((_, bounds_a)), Some((_, bounds_b))) if bounds_a.overlaps(*bounds_b)
            ) {
                self.destroy_contact(id);
            } else {
                let pair = self
                    .pairs
                    .get_mut(&contact.pair)
                    .expect("contact pair is live");
                Self::evaluate_contact(
                    contact,
                    pair,
                    &self.bodies,
                    [a, b],
                    neighbor_epoch,
                    self.rules.linear_slop,
                    listener,
                );
                contact.island = false;
                if contact.enabled && contact.touching && contact.physical {
                    for body in [contact.body_a, contact.body_b] {
                        self.bodies
                            .get_mut(&body)
                            .expect("contact body is live")
                            .solver_contacts
                            .push(id);
                    }
                }
            }
        }
    }

    pub(super) fn update_contact(
        &mut self,
        id: ContactId,
        listener: &mut impl ContactListener<T>,
    ) -> &mut Contact {
        let contact = self.contacts.get_mut(&id).expect("updated contact is live");
        let pair = self
            .pairs
            .get_mut(&contact.pair)
            .expect("contact pair is live");
        let fixtures = [
            &self.fixtures[&contact.fixture_a],
            &self.fixtures[&contact.fixture_b],
        ];
        Self::evaluate_contact(
            contact,
            pair,
            &self.bodies,
            fixtures,
            self.limit_collision_neighbors
                .then_some(self.neighbor_epoch),
            self.rules.linear_slop,
            listener,
        );
        contact
    }

    fn evaluate_contact(
        contact: &mut Contact,
        pair: &mut BodyPair,
        bodies: &Arena<BodyId, Body>,
        [fixture_a, fixture_b]: [&Fixture<T>; 2],
        neighbor_epoch: Option<u64>,
        linear_slop: f64,
        listener: &mut impl ContactListener<T>,
    ) {
        if !pair.allows_collision(bodies, neighbor_epoch) {
            contact.enabled = false;
            contact.touching = false;
            contact.manifold.point_count = 0;
            return;
        }
        contact.enabled = true;
        let (a, b) = (&bodies[&contact.body_a], &bodies[&contact.body_b]);
        // The pair's motion cache keeps the body order of its first contact.
        let (pair_a, pair_b) = if pair.a == contact.body_a {
            (a, b)
        } else {
            (b, a)
        };
        if contact.separation_until > 0.0 && contact.separation_until > pair.motion(pair_a, pair_b)
        {
            contact.manifold.point_count = 0;
            contact.touching = false;
            return;
        }
        let gap = evaluate(
            &mut contact.manifold,
            &fixture_a.shape,
            a.xf,
            &fixture_b.shape,
            b.xf,
            linear_slop,
            &mut contact.separation_cache,
        );
        contact.separation_until = 0.0;
        if gap > 0.0 && a.proxy_radius < 1e100 && b.proxy_radius < 1e100 {
            let motion = pair.motion(pair_a, pair_b);
            contact.separation_until = motion + gap * 0.9999999 - 1e-5 - 1e-12 * motion;
        }
        contact.touching = contact.manifold.point_count > 0;
        if contact.touching {
            listener.pre_solve(ContactContext {
                fixture_a,
                fixture_b,
                body_a: a,
                body_b: b,
                contact,
            });
        }
    }

    pub(super) fn allows_collision(&mut self, id: ContactId) -> bool {
        let contact = &self.contacts[&id];
        let pair = self
            .pairs
            .get_mut(&contact.pair)
            .expect("contact pair is live");
        pair.allows_collision(
            &self.bodies,
            self.limit_collision_neighbors
                .then_some(self.neighbor_epoch),
        )
    }

    fn destroy_contact(&mut self, id: ContactId) {
        self.remove_toi_candidate(id);
        let contact = self
            .contacts
            .remove(&id)
            .expect("destroyed contact is live");
        self.fixture_pairs
            .remove(&fixture_pair(contact.fixture_a, contact.fixture_b));
        self.contact_order[contact.list_index] = None;
        let pair = self
            .pairs
            .get_mut(&contact.pair)
            .expect("contact pair is live");
        let was_latest = pair.contacts.last() == Some(&id);
        pair.contacts.retain(|&other| other != id);
        let latest = pair.contacts.last().copied();
        if latest.is_none() {
            self.pairs.remove(&contact.pair);
        }
        for body_id in [contact.body_a, contact.body_b] {
            let body = self.bodies.get_mut(&body_id).expect("contact body is live");
            body.contacts.retain(|&other| other != id);
            if was_latest {
                body.pairs.retain(|&pair| pair != contact.pair);
                if let Some(latest) = latest {
                    let position = body.pairs.partition_point(|key| {
                        self.pairs[key]
                            .contacts
                            .last()
                            .is_some_and(|&id| id < latest)
                    });
                    body.pairs.insert(position, contact.pair);
                }
            }
        }
        self.contact_pool.push_back(contact);
    }

    pub(super) fn add_toi_candidate(&mut self, id: ContactId) {
        let contact = &self.contacts[&id];
        if contact.toi_count > MAX_TOI_SUBSTEPS || contact.toi_queue == ToiQueue::Pending {
            return;
        }
        self.remove_toi_candidate(id);
        let contact = self.contacts.get_mut(&id).expect("TOI contact is live");
        contact.toi_queue = ToiQueue::Pending;
        contact.toi_index = self.toi_pending.len();
        if self
            .toi_pending
            .last()
            .is_some_and(|&previous| previous < id)
        {
            self.toi_unsorted = true;
        }
        self.toi_pending.push(id);
    }

    fn toi_before(&self, first: ContactId, second: ContactId) -> bool {
        let (a, b) = (self.contacts[&first].toi, self.contacts[&second].toi);
        a < b || (a == b && first > second)
    }

    fn toi_up(&mut self, mut index: usize) -> usize {
        let id = self.toi_ready[index];
        while index > 0 {
            let parent = (index - 1) / 2;
            let parent_id = self.toi_ready[parent];
            if !self.toi_before(id, parent_id) {
                break;
            }
            self.toi_ready[index] = parent_id;
            self.contacts
                .get_mut(&parent_id)
                .expect("TOI contact is live")
                .toi_index = index;
            index = parent;
        }
        self.toi_ready[index] = id;
        self.contacts
            .get_mut(&id)
            .expect("TOI contact is live")
            .toi_index = index;
        index
    }

    fn toi_down(&mut self, mut index: usize) {
        let id = self.toi_ready[index];
        while 2 * index + 1 < self.toi_ready.len() {
            let mut child = 2 * index + 1;
            if child + 1 < self.toi_ready.len()
                && self.toi_before(self.toi_ready[child + 1], self.toi_ready[child])
            {
                child += 1;
            }
            let child_id = self.toi_ready[child];
            if !self.toi_before(child_id, id) {
                break;
            }
            self.toi_ready[index] = child_id;
            self.contacts
                .get_mut(&child_id)
                .expect("TOI contact is live")
                .toi_index = index;
            index = child;
        }
        self.toi_ready[index] = id;
        self.contacts
            .get_mut(&id)
            .expect("TOI contact is live")
            .toi_index = index;
    }

    pub(super) fn push_toi(&mut self, id: ContactId) {
        let contact = self.contacts.get_mut(&id).expect("TOI contact is live");
        contact.toi_queue = ToiQueue::Ready;
        let index = self.toi_ready.len();
        contact.toi_index = index;
        self.toi_ready.push(id);
        self.toi_up(index);
    }

    pub(super) fn remove_toi_candidate(&mut self, id: ContactId) {
        let contact = self.contacts.get_mut(&id).expect("TOI contact is live");
        let index = contact.toi_index;
        let queue = std::mem::replace(&mut contact.toi_queue, ToiQueue::None);
        match queue {
            ToiQueue::None => (),
            ToiQueue::Pending => {
                self.toi_unsorted = true;
                self.toi_pending.swap_remove(index);
                if let Some(other) = self.toi_pending.get(index) {
                    self.contacts
                        .get_mut(other)
                        .expect("TOI contact is live")
                        .toi_index = index;
                }
            }
            ToiQueue::Ready => {
                self.toi_ready.swap_remove(index);
                if index < self.toi_ready.len() && self.toi_up(index) == index {
                    self.toi_down(index);
                }
            }
        }
    }
}
