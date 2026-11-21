//! Power generation, storage, and systems-before-thrusters allocation.

use crate::specs::Module;

use super::ship::Ship;

#[derive(Clone, Copy, Debug, Default)]
pub struct PowerRates {
    pub generation: f64,
    pub capacity: f64,
    pub systems: f64,
    pub thrusters: f64,
}

impl Ship {
    pub fn power_rates(&self) -> PowerRates {
        let mut rates = PowerRates::default();
        let can_fire = self.firing
            && !self.craft.object.dead
            && !self.craft.docked()
            && self.craft.launching == 0.0;
        for mount in &self.craft.mounts {
            if mount.health < 1.0 || !self.craft.hulls[mount.hull].present {
                continue;
            }
            let Some(module) = &mount.module else {
                continue;
            };
            let spec = &module.spec;
            let is_thruster = spec.forward_thrust != 0.0;
            let mut active = is_thruster;
            let mut firing = false;
            for part in &module.parts {
                if part.active != 0.0 {
                    active = true;
                    if part.active == 1.0 && part.activation_progress == 1.0 {
                        firing = can_fire;
                    }
                }
            }
            if spec
                .booster
                .is_some_and(|booster| module.fire_cooldown <= booster.cooldown + 1e-9)
            {
                active = false;
            }

            let recharging = !active
                && spec.recharge_duration > 0.0
                && mount
                    .health_activated
                    .zip(spec.health_activated)
                    .is_some_and(|(health, maximum)| health < maximum - 1e-9);
            let charging = (active || spec.charge_duration <= 0.0) && module.charge_cooldown > 1e-9
                || active && module.fire_cooldown > 1e-9
                || recharging;
            let usage = if active && firing && spec.power_firing > 0.0 {
                spec.power_firing
            } else if charging && spec.power_charging > 0.0 {
                spec.power_charging
            } else if active {
                spec.power_activated
            } else {
                spec.power
            };
            rates.generation += spec.power_generated;
            rates.capacity += spec.power_capacity;
            if is_thruster {
                rates.thrusters += usage;
            } else {
                rates.systems += usage;
            }
        }

        rates
    }

    pub fn module_power(&self, spec: &Module) -> f64 {
        if spec.forward_thrust != 0.0 {
            1.0
        } else {
            self.systems_power
        }
    }

    /// Integrate megawatts over seconds into megajoules of stored power.
    pub fn update_power(&mut self, duration: f64) {
        if duration <= 0.0 || duration.is_nan() {
            return;
        }
        let rates = self.power_rates();
        let stored = self.stored_power.min(rates.capacity).max(0.0);
        let available = rates.generation + stored / duration;
        self.systems_power = 1.0;
        self.thruster_power = 1.0;
        if rates.systems > 0.0 {
            self.systems_power = (available / rates.systems).min(1.0);
        }
        if rates.thrusters > 0.0 {
            self.thruster_power = ((available - rates.systems) / rates.thrusters).clamp(0.0, 1.0);
        }
        let supplied = rates.systems * self.systems_power + rates.thrusters * self.thruster_power;
        self.stored_power = (stored + (rates.generation - supplied) * duration)
            .min(rates.capacity)
            .max(0.0);
        self.fly(self.forward, self.turn);
    }
}
