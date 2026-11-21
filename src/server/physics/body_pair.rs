//! Shared neighbor decisions and conservative relative motion for fixture pairs.

use super::arena::Arena;
use crate::utilities::vector_math::TransformValue;

use super::{Body, BodyId, ContactId};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(super) struct PairKey(BodyId, BodyId);

impl PairKey {
    pub fn new(a: BodyId, b: BodyId) -> Self {
        if a < b { Self(a, b) } else { Self(b, a) }
    }

    pub fn other(self, body: BodyId) -> BodyId {
        if self.0 == body { self.1 } else { self.0 }
    }
}

#[derive(Debug)]
pub(super) struct BodyPair {
    pub a: BodyId,
    pub b: BodyId,
    pub contacts: Vec<ContactId>,
    pose_versions: (u64, u64),
    motion_bound: f64,
    relative: TransformValue,
    reverse: TransformValue,
    pub motion_ready: bool,
    pub sweep_revision: u64,
    sweep_bound: f64,
    neighbor_epoch: u64,
    allowed: bool,
}

impl BodyPair {
    pub fn new(a: BodyId, b: BodyId) -> Self {
        Self {
            a,
            b,
            contacts: Vec::new(),
            pose_versions: (0, 0),
            motion_bound: 0.0,
            relative: TransformValue::default(),
            reverse: TransformValue::default(),
            motion_ready: false,
            sweep_revision: 0,
            sweep_bound: 0.0,
            neighbor_epoch: 0,
            allowed: false,
        }
    }

    pub fn allows_collision(
        &mut self,
        bodies: &Arena<BodyId, Body>,
        neighbor_epoch: Option<u64>,
    ) -> bool {
        let allowed =
            || bodies[&self.a].allows_collision(self.b) && bodies[&self.b].allows_collision(self.a);
        let Some(epoch) = neighbor_epoch else {
            return allowed();
        };
        if self.neighbor_epoch != epoch || epoch == 0 {
            self.neighbor_epoch = epoch;
            self.allowed = allowed();
        }
        self.allowed
    }

    pub fn motion(&mut self, a: &Body, b: &Body) -> f64 {
        let versions = (a.pose_version, b.pose_version);
        if !self.motion_ready || self.pose_versions != versions {
            let relative = b.xf.detransform(a.xf);
            let reverse = a.xf.detransform(b.xf);
            if self.motion_ready {
                let change = relative_motion(relative, self.relative, a.proxy_radius)
                    .max(relative_motion(reverse, self.reverse, b.proxy_radius));
                if change > 0.0 {
                    self.motion_bound = (self.motion_bound + change).next_up();
                }
            }
            self.pose_versions = versions;
            self.relative = relative;
            self.reverse = reverse;
            self.motion_ready = true;
        }
        self.motion_bound
    }

    pub fn sweep_motion(&mut self, a: &Body, b: &Body, revision: u64) -> f64 {
        if self.sweep_revision != revision {
            self.sweep_revision = revision;
            let (sa, sb) = (&a.sweep, &b.sweep);
            let translation = (sa.c - sa.c0) - (sb.c - sb.c0);
            let distance = (sa.c.x - sb.c.x).abs() + (sa.c.y - sb.c.y).abs();
            let (rotation_a, rotation_b) = ((sa.a - sa.a0).abs(), (sb.a - sb.a0).abs());
            self.sweep_bound = translation.x.abs()
                + translation.y.abs()
                + (a.proxy_radius * rotation_a + (a.proxy_radius + distance) * rotation_b)
                    .max(b.proxy_radius * rotation_b + (b.proxy_radius + distance) * rotation_a);
        }
        self.sweep_bound
    }
}

fn relative_motion(current: TransformValue, previous: TransformValue, radius: f64) -> f64 {
    (current.p.x - previous.p.x).abs()
        + (current.p.y - previous.p.y).abs()
        + radius * ((current.q.sin - previous.q.sin).abs() + (current.q.cos - previous.q.cos).abs())
}
