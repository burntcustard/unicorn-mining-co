//! Rigid body motion and broad-phase proxy invalidation.

use std::f64::consts::PI;

use super::motion_sweep::Sweep;
use crate::utilities::vector::Vector;
use crate::utilities::vector_math::TransformValue;

use super::{BodyId, ContactId, FixtureId, PairKey};

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Velocity {
    pub v: Vector,
    pub w: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Position {
    pub c: Vector,
    pub a: f64,
}

#[derive(Debug)]
pub struct Body {
    pub(super) pose_version: u64,
    pub(super) pairs: Vec<PairKey>,
    pub(super) contacts: Vec<ContactId>,
    pub(super) solver_contacts: Vec<ContactId>,
    pub(super) fixtures: Vec<FixtureId>,
    pub(super) island: bool,
    pub(super) parked: bool,
    pub(super) inv_mass: f64,
    pub(super) inv_inertia: f64,
    pub(super) solver_position: Position,
    pub(super) solver_velocity: Velocity,
    pub linear_velocity: Vector,
    pub angular_velocity: f64,
    pub(super) proxy_radius: f64,
    pub(super) proxy_motion: f64,
    pub(super) proxy_margin: f64,
    pub(super) proxy_transform: TransformValue,
    pub(super) xf: TransformValue,
    pub(super) sweep: Sweep,
    pub(super) neighborhood: Option<Box<[BodyId; 8]>>,
}

impl Default for Body {
    fn default() -> Self {
        Self {
            pose_version: 0,
            pairs: Vec::new(),
            contacts: Vec::new(),
            solver_contacts: Vec::new(),
            fixtures: Vec::new(),
            island: false,
            parked: false,
            inv_mass: 0.0,
            inv_inertia: 0.0,
            solver_position: Position::default(),
            solver_velocity: Velocity::default(),
            linear_velocity: Vector::ZERO,
            angular_velocity: 0.0,
            proxy_radius: f64::INFINITY,
            proxy_motion: 0.0,
            proxy_margin: 0.0,
            proxy_transform: TransformValue::default(),
            xf: TransformValue::default(),
            sweep: Sweep::default(),
            neighborhood: None,
        }
    }
}

impl Body {
    pub fn position(&self) -> Vector {
        self.xf.p
    }

    pub fn angle(&self) -> f64 {
        self.sweep.a
    }

    pub fn linear_velocity_from_world_point(&self, point: Vector) -> Vector {
        let center = self.sweep.c;
        let spin = self.angular_velocity;
        Vector::new(
            self.linear_velocity.x - spin * (point.y - center.y),
            self.linear_velocity.y + spin * (point.x - center.x),
        )
    }

    pub fn inverse_mass(&self) -> f64 {
        self.inv_mass
    }

    pub fn inverse_inertia(&self) -> f64 {
        self.inv_inertia
    }

    pub fn has_contacts(&self) -> bool {
        !self.contacts.is_empty()
    }

    pub fn is_parked(&self) -> bool {
        self.parked
    }

    pub fn allows_collision(&self, other: BodyId) -> bool {
        self.neighborhood
            .as_ref()
            .is_none_or(|neighbors| neighbors.contains(&other))
    }

    pub(super) fn set_transform(&mut self, position: Vector, angle: f64) {
        self.xf = TransformValue::new(position, angle);
        self.pose_version += 1;
        if (-PI..=PI).contains(&angle) {
            self.sweep.c = position;
            self.sweep.c0 = position;
            self.sweep.a = angle;
            self.sweep.a0 = angle;
        } else {
            self.sweep.set_transform(self.xf);
        }
    }

    pub(super) fn set_mass(&mut self, mass: f64, inertia: f64) {
        self.inv_mass = 1.0 / mass;
        self.inv_inertia = if inertia > 0.0 { 1.0 / inertia } else { 0.0 };
    }

    pub(super) fn synchronize_transform(&mut self) {
        self.xf = self.sweep.transform(1.0);
        self.pose_version += 1;
    }

    pub(super) fn advance(&mut self, alpha: f64) {
        self.sweep.advance(alpha);
        self.sweep.c = self.sweep.c0;
        self.sweep.a = self.sweep.a0;
        self.synchronize_transform();
    }

    pub(super) fn accumulate_proxy_motion(
        &mut self,
        from: TransformValue,
        to: TransformValue,
    ) -> f64 {
        let cached = self.proxy_transform;
        self.proxy_transform = to;
        if self.proxy_radius == f64::INFINITY {
            return f64::INFINITY;
        }
        let motion = |pose: TransformValue| {
            let sin = pose.q.sin - cached.q.sin;
            let cos = pose.q.cos - cached.q.cos;
            (pose.p.x - cached.p.x)
                .abs()
                .max((pose.p.y - cached.p.y).abs())
                + self.proxy_radius * (sin * sin + cos * cos).sqrt()
        };
        let start_motion = motion(from);
        self.proxy_motion += if from == to {
            start_motion
        } else {
            start_motion.max(motion(to))
        };
        self.proxy_motion
    }
}
