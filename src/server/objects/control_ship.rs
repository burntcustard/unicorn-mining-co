use crate::protocol::{Input, SimulationEvent};

use super::ship::Ship;

impl Ship {
    pub fn control(
        &mut self,
        input: Input,
        launch_bearing: Option<f64>,
        events: &mut Vec<SimulationEvent>,
    ) {
        if self.cargo_release_held && !input.cargo_release {
            self.cancel_cargo_release();
        }
        self.cargo_release_held = input.cargo_release;
        self.control_flight(input, launch_bearing);
        if self.craft.transit_time != 0.0 {
            return;
        }

        let controls = [
            ("flightMode", input.flight_mode),
            (
                "cargoHatch",
                input.cargo_hatch || input.cargo_release || self.releasing_cargo,
            ),
            ("searchLight", input.search_light),
            ("shieldGenerator", input.shield_generator),
            ("hornDrill", input.horn_drill),
            ("plasmaAccelerator", input.plasma_active),
            ("plasmaAcceleratorTurret", input.plasma_active),
            ("autogun", input.autogun_active),
            ("autogunTurret", input.autogun_active),
            ("cannonSm", input.autogun_active),
            ("laser", input.laser_active),
            ("laserTurret", input.laser_active),
        ];

        for (id, enabled) in controls {
            let changed = self.craft.mounts.iter().any(|mount| {
                self.craft.hulls[mount.hull].present
                    && (mount.health >= 1.0 || mount.health.is_nan())
                    && mount.module.as_ref().is_some_and(|module| {
                        (module.definition_id == id || module.spec.behavior == id)
                            && module
                                .parts
                                .iter()
                                .any(|part| (part.active != 0.0) != enabled)
                    })
            });
            if !changed {
                continue;
            }
            self.craft.set_module_active(id, enabled);
            if enabled && !self.craft.module_active(id) {
                continue;
            }
            if matches!(
                id,
                "cargoHatch" | "searchLight" | "shieldGenerator" | "flightMode"
            ) && let Some(player_number) = self.craft.object.player_number
            {
                events.push(SimulationEvent::ModuleChanged {
                    module: id.to_owned(),
                    player_number,
                    active: enabled,
                });
            }
        }
    }
}
