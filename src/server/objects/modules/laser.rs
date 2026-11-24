use crate::gameplay::collision_world::CollisionEntity;
use crate::objects::projectile::{FractureTarget, WeaponContext, WeaponWorld, asteroid_segment};
use crate::objects::ship::Ship;
use crate::protocol::SimulationEvent;
use crate::simulation::geometry::rotate_point;
use crate::utilities::vector::Vector;

use super::trace_laser::{LaserTrace, trace_laser};

#[derive(Clone, Copy, Debug)]
pub struct LaserBeam {
    pub source: i64,
    pub player_number: i64,
    pub start: Vector,
    pub end: Vector,
    pub damage: f64,
}

impl Ship {
    /// Inspect fully deployed mounted beams in mount order before tracing world targets.
    pub fn laser_beams(&self) -> impl Iterator<Item = LaserBeam> + '_ {
        let craft = &self.craft;
        let source = &craft.object;
        let player_number = source
            .player_number
            .filter(|_| self.firing && !source.dead && !craft.docked() && craft.launching == 0.0);
        player_number.into_iter().flat_map(move |player_number| {
            craft.mounts.iter().filter_map(move |mount| {
                let module = mount.module.as_ref()?;
                if !craft.hulls[mount.hull].present
                    || module.spec.behavior != "beam"
                    || mount.health <= 0.0
                    || !module
                        .parts
                        .iter()
                        .any(|part| part.active == 1.0 && part.activation_progress == 1.0)
                {
                    return None;
                }

                let muzzle = rotate_point(
                    Vector::new(module.spec.barrel_length, 0.0),
                    module.aim_rotation,
                );
                let start =
                    source.position + rotate_point(mount.position + muzzle, source.rotation);
                let end = start
                    + rotate_point(
                        Vector::new(module.spec.reach, 0.0),
                        source.rotation + module.aim_rotation,
                    );
                Some(LaserBeam {
                    source: source.id,
                    player_number,
                    start,
                    end,
                    damage: module.spec.damage,
                })
            })
        })
    }
}

pub fn resolve_laser<W: WeaponWorld>(
    beam: LaserBeam,
    dt: f64,
    context: &mut WeaponContext<'_, W>,
) -> LaserTrace {
    let trace = trace_laser(beam, context);
    let Some(impact) = trace.impact.filter(|impact| impact.physical) else {
        return trace;
    };
    let Some(target) = context.world.weapon_target(impact.collider.owner) else {
        return trace;
    };
    let is_asteroid = target.object().kind == "asteroid";
    let color = target
        .outline_color(impact.collider, &context.catalog.colors)
        .to_owned();
    let applied = context.world.damage_weapon_target(
        impact.collider,
        beam.damage * 30.0 * dt,
        beam.player_number,
        context.events,
    );
    if applied <= 0.0 {
        return trace;
    }

    let position = beam.start.add_scaled(
        beam.end - beam.start,
        trace.length / beam.start.distance(beam.end),
    );
    context.events.push(SimulationEvent::LaserDamage {
        target_id: impact.collider.owner,
        by: beam.player_number,
        damage: applied,
        color,
        position,
    });
    if is_asteroid {
        context.world.fracture_asteroid(
            impact.collider.owner,
            FractureTarget::Direct(asteroid_segment(impact.collider)),
            beam.player_number,
            context.catalog,
            context.events,
        );
    }
    trace
}
