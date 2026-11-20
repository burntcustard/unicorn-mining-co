//! Fixture geometry and the proxy representing it in the broad phase.

use crate::collision::{Aabb, BroadPhase, ProxyId, Shape};
use crate::vector::{TransformValue, Vector};

use super::{BodyId, FixtureId};

#[derive(Clone, Copy, Debug)]
pub struct FixtureOptions<T> {
    pub user_data: T,
    pub physical: bool,
}

impl<T: Default> Default for FixtureOptions<T> {
    fn default() -> Self {
        Self {
            user_data: T::default(),
            physical: true,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct RecoveryCircle {
    pub center: Vector,
    pub radius: f64,
    pub pose: u64,
    pub slop: f64,
}

#[derive(Debug)]
pub struct Fixture<T> {
    pub body: BodyId,
    pub shape: Shape,
    pub physical: bool,
    pub user_data: T,
    pub(super) proxy: Option<(ProxyId, Aabb)>,
    pub(super) proxy_margin: f64,
    last_bounds: Option<([u64; 4], Aabb)>,
    pub(super) recovery: RecoveryCircle,
}

impl<T> Fixture<T> {
    pub(super) fn new(body: BodyId, shape: Shape, options: FixtureOptions<T>) -> Self {
        Self {
            body,
            shape,
            physical: options.physical,
            user_data: options.user_data,
            proxy: None,
            proxy_margin: 0.0,
            last_bounds: None,
            recovery: RecoveryCircle::default(),
        }
    }

    pub(super) fn create_proxy(
        &mut self,
        broad_phase: &mut BroadPhase<FixtureId, BodyId>,
        id: FixtureId,
        transform: TransformValue,
    ) {
        let bounds = self.bounds_at(transform);
        let proxy = broad_phase.create_proxy(bounds, id, Some(self.body));
        let fat = broad_phase.grid.get(proxy).expect("new fixture proxy").aabb;
        self.proxy = Some((proxy, fat));
    }

    pub(super) fn destroy_proxy(&mut self, broad_phase: &mut BroadPhase<FixtureId, BodyId>) {
        if let Some((proxy, _)) = self.proxy.take() {
            broad_phase.destroy_proxy(proxy);
        }
    }

    pub(super) fn synchronize_proxy(
        &mut self,
        broad_phase: &mut BroadPhase<FixtureId, BodyId>,
        from: TransformValue,
        to: TransformValue,
        motion: f64,
    ) {
        let Some((proxy, _)) = self.proxy else {
            return;
        };
        if motion < self.proxy_margin {
            return;
        }
        let start = self.bounds_at(from);
        let bounds = if from == to {
            start
        } else {
            start.combine(self.bounds_at(to))
        };
        let fat = broad_phase
            .move_proxy(proxy, bounds, to.p - from.p)
            .expect("live fixture proxy");
        self.proxy = Some((proxy, fat));
        if motion < f64::INFINITY {
            self.proxy_margin = motion
                + 0.9
                    * (bounds.lower_bound.x - fat.lower_bound.x)
                        .min(bounds.lower_bound.y - fat.lower_bound.y)
                        .min(fat.upper_bound.x - bounds.upper_bound.x)
                        .min(fat.upper_bound.y - bounds.upper_bound.y);
        }
    }

    fn bounds_at(&mut self, transform: TransformValue) -> Aabb {
        let pose = [
            transform.p.x,
            transform.p.y,
            transform.q.sin,
            transform.q.cos,
        ]
        .map(f64::to_bits);
        if let Some((last_pose, bounds)) = self.last_bounds
            && last_pose == pose
        {
            return bounds;
        }
        let bounds = self.shape.base().compute_aabb(transform);
        self.last_bounds = Some((pose, bounds));
        bounds
    }
}
