use std::sync::OnceLock;

use crate::collision::CircleShape;
use crate::objects::projectile::{Trace, WeaponContext, WeaponImpact, WeaponWorld, trace_world};
use crate::utilities::vector::Vector;

use super::laser::LaserBeam;

#[derive(Clone, Copy, Debug)]
pub struct LaserTrace {
    pub impact: Option<WeaponImpact>,
    pub length: f64,
}

pub fn trace_laser<W: WeaponWorld>(
    beam: LaserBeam,
    context: &mut WeaponContext<'_, W>,
) -> LaserTrace {
    static LASER: OnceLock<CircleShape> = OnceLock::new();
    let impact = trace_world(
        Trace {
            entity: beam.source,
            player: Some(beam.player_number),
            shape: &LASER
                .get_or_init(|| CircleShape::new(Vector::ZERO, 0.5))
                .base,
            start: beam.start,
            end: beam.end,
            target_motion_dt: None,
        },
        context.world,
        None,
        context.geometry,
        context.catalog.simulation.linear_slop,
    );
    let length = beam.start.distance(beam.end) * impact.map_or(1.0, |impact| impact.fraction);
    LaserTrace { impact, length }
}
