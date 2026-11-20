//! Booster bursts, cooldowns, charge recovery, and speed taper.

use super::ship::Ship;

const COOLDOWN_EPSILON: f64 = 1e-9;

impl Ship {
    pub fn trigger_thrust_boost(&mut self, pressed: bool) {
        let held = std::mem::replace(&mut self.thrust_boost_held, pressed);
        if !pressed
            || held
            || self.craft.object.dead
            || self.craft.cockpit.is_none()
            || self.craft.docked()
            || self.craft.transit_time != 0.0
            || self.craft.launching != 0.0
            || self.fuel <= 0.0
            || self.thruster_output().forward == 0.0
            || self.systems_power <= 0.0
        {
            return;
        }

        let mut ready = false;
        for mount in &self.craft.mounts {
            let hull = &self.craft.hulls[mount.hull];
            if !hull.present {
                continue;
            }
            let Some(module) = &mount.module else {
                continue;
            };
            let Some(booster) = module.spec.booster else {
                continue;
            };
            if module.fire_cooldown > COOLDOWN_EPSILON {
                return;
            }
            let available = f64::from(booster.charges - 1) * booster.recharge + COOLDOWN_EPSILON;
            ready |=
                mount.health >= 1.0 && hull.health >= 1.0 && module.charge_cooldown <= available;
        }
        if !ready {
            return;
        }

        let mut changed = false;
        for mount in &mut self.craft.mounts {
            let hull = &self.craft.hulls[mount.hull];
            if !hull.present {
                continue;
            }
            let Some(module) = &mut mount.module else {
                continue;
            };
            let Some(booster) = module.spec.booster else {
                continue;
            };
            let mut active = 0.0;
            let available = f64::from(booster.charges - 1) * booster.recharge + COOLDOWN_EPSILON;
            if mount.health >= 1.0 && hull.health >= 1.0 && module.charge_cooldown <= available {
                active = 1.0;
                let capacity = f64::from(booster.charges) * booster.recharge;
                module.charge_cooldown = (module.charge_cooldown + booster.recharge).min(capacity);
            }
            module.fire_cooldown = booster.duration + booster.cooldown;
            for part in &mut module.parts {
                let changed_active = part.set_active(&module.spec, mount.health_activated, active);
                changed |= module.collision_activation && changed_active;
            }
        }
        if changed {
            self.craft.invalidate_collision_geometry();
        }
    }

    pub fn booster_multiplier(&self, speed_limit: bool) -> f64 {
        if self.craft.object.dead || self.craft.docked() || self.craft.transit_time != 0.0 {
            return 1.0;
        }

        let mut factor = 1.0;
        for mount in &self.craft.mounts {
            let hull = &self.craft.hulls[mount.hull];
            if !hull.present || mount.health < 1.0 || hull.health < 1.0 {
                continue;
            }
            let Some(module) = &mount.module else {
                continue;
            };
            let Some(booster) = module.spec.booster else {
                continue;
            };
            if module.fire_cooldown <= COOLDOWN_EPSILON {
                continue;
            }

            let mut progress = if speed_limit {
                if booster.cooldown > 0.0 {
                    (module.fire_cooldown / booster.cooldown).min(1.0)
                } else {
                    1.0
                }
            } else if module.fire_cooldown > booster.cooldown + COOLDOWN_EPSILON {
                1.0
            } else {
                0.0
            };

            if booster.ramp_duration > 0.0 {
                progress *= ((booster.duration + booster.cooldown - module.fire_cooldown)
                    / booster.ramp_duration)
                    .clamp(0.0, 1.0);
            }
            if module.parts.iter().any(|part| part.active == 1.0) {
                factor *=
                    1.0 + (booster.multiplier - 1.0) * progress * self.module_power(&module.spec);
            }
        }

        factor
    }

    pub fn update_boosters(&mut self, duration: f64) {
        let disabled =
            self.craft.object.dead || self.craft.docked() || self.craft.transit_time != 0.0;
        let mut changed = false;
        for mount in &mut self.craft.mounts {
            let hull = &self.craft.hulls[mount.hull];
            if !hull.present {
                continue;
            }
            let Some(module) = &mut mount.module else {
                continue;
            };
            let Some(booster) = module.spec.booster else {
                continue;
            };
            let boost_remaining = if module.parts.iter().any(|part| part.active == 1.0) {
                (module.fire_cooldown - booster.cooldown).max(0.0)
            } else {
                0.0
            };
            let recharge_time = (duration - boost_remaining).max(0.0);
            module.fire_cooldown = (module.fire_cooldown - duration).max(0.0);

            if mount.health >= 1.0 && hull.health >= 1.0 {
                let power = if module.spec.forward_thrust != 0.0 {
                    1.0
                } else {
                    self.systems_power
                };
                module.charge_cooldown = (module.charge_cooldown - recharge_time * power).max(0.0);
            }

            if module.fire_cooldown <= COOLDOWN_EPSILON
                || disabled
                || mount.health < 1.0
                || hull.health < 1.0
            {
                for part in &mut module.parts {
                    let changed_active = part.set_active(&module.spec, mount.health_activated, 0.0);
                    changed |= module.collision_activation && changed_active;
                }
            }
        }
        if changed {
            self.craft.invalidate_collision_geometry();
        }
    }
}
