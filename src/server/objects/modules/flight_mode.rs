use crate::specs::HullSegment;
use crate::utilities::vector::Vector;

use crate::objects::craft::Craft;

pub(in crate::objects) fn flight_offset(
    plans: &[HullSegment],
    index: usize,
    depth: usize,
) -> Option<Vector> {
    let plan = plans.get(index)?;
    if let Some([x, y]) = plan.flight_offset {
        return Some(Vector::new(x, y));
    }
    if depth >= plans.len() {
        return None;
    }

    plan.connections
        .as_deref()?
        .iter()
        .find_map(|&index| flight_offset(plans, index, depth + 1))
}

impl Craft {
    pub fn flight_mode_state(&self) -> (f64, f64) {
        let (mut progress, mut boost) = (0.0_f64, 1.0_f64);
        for mount in &self.mounts {
            let Some(module) = &mount.module else {
                continue;
            };
            let hull = &self.hulls[mount.hull];
            if module.spec.behavior != "flightMode"
                || mount.health < 1.0
                || hull.health < 1.0
                || !hull.present
            {
                continue;
            }

            for part in &module.parts {
                let value = part.activation_progress.clamp(0.0, 1.0);
                progress = progress.max(value);
                boost = boost.max(1.0 + value * (module.spec.flight_boost - 1.0));
            }
        }

        (progress, boost)
    }

    pub fn update_flight_mode(&mut self) {
        if !self.hulls.iter().any(|hull| hull.flight_offset.is_some()) {
            return;
        }
        let (progress, _) = self.flight_mode_state();
        let mut changed = false;
        for hull in &mut self.hulls {
            if hull.present
                && let Some(offset) = hull.flight_offset
            {
                let position = hull.original_position.add_scaled(offset, progress);
                changed |= [position.x.to_bits(), position.y.to_bits()]
                    != [hull.position.x.to_bits(), hull.position.y.to_bits()];
                hull.position = position;
            }
        }

        for mount in &mut self.mounts {
            let hull = &self.hulls[mount.hull];
            if !hull.present || hull.flight_offset.is_none() {
                continue;
            }
            let Some(point) = mount.point() else { continue };
            let position = hull.position + Vector::new(point.x, point.y);
            let delta = position - mount.position;
            if delta != Vector::ZERO {
                changed = true;
                mount.position = position;
                if let Some(module) = &mut mount.module {
                    for part in &mut module.parts {
                        part.position += delta;
                    }
                }
            }
        }
        if changed {
            self.invalidate_collision_geometry();
        }
    }
}
