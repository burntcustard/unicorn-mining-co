//! Installed thrusters and the ship's flight step.

use std::sync::Arc;

use crate::protocol::{Input, SimulationEvent};
use crate::simulation::game_object::{
    GameObject, MotionContext, MovementOutcome, ObjectProperties,
};
use crate::simulation::geometry::move_point;
use crate::specs::{CRAFT_FRICTION, CRAFT_HEALTH, Catalog, Flight};
use crate::utilities::approach;
use crate::utilities::vector::Vector;

use super::craft::{Craft, InstalledModule};

#[derive(Clone, Copy, Debug, Default)]
pub struct ThrusterOutput {
    pub forward: f64,
    pub rotational: f64,
    pub fuel: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ShipStep<'a> {
    pub movement: MotionContext<'a>,
    pub tick: Option<u64>,
    pub docked_position: Option<Vector>,
    pub portal_position: Option<Vector>,
}

#[derive(Debug)]
pub struct Ship {
    pub craft: Craft,
    pub fuel: f64,
    pub fuel_capacity: f64,
    pub stored_power: f64,
    pub thruster_power: f64,
    pub systems_power: f64,
    pub forward: f64,
    pub turn: f64,
    pub firing: bool,
    pub target_id: Option<i64>,
    pub npc_state: &'static str,
    pub cargo_space: usize,
    pub(crate) thrust_boost_held: bool,
    pub(crate) cargo_release_held: bool,
    pub(crate) releasing_cargo: bool,
    pub(crate) cargo_release_hatch: usize,
    pub(crate) cargo_release_time: f64,
    thruster_mount_count: usize,
    flight: Flight,
    transit_scale_duration: f64,
    drag_coefficient: f64,
    hull_mass: f64,
    angular_thrust: f64,
    turn_rate: f64,
}

impl Ship {
    pub fn new(
        id: i64,
        definition_id: &str,
        mut properties: ObjectProperties,
        catalog: &Catalog,
    ) -> Option<Self> {
        let definition_id = if definition_id.is_empty() {
            "mustang"
        } else {
            definition_id
        };
        let definition = catalog.ship_specs.get(definition_id)?;
        let flight = catalog.simulation.flight;
        properties.drag.get_or_insert(definition.drag);
        properties.radius.get_or_insert(definition.radius);
        properties.friction.get_or_insert(CRAFT_FRICTION);
        properties.health.get_or_insert(CRAFT_HEALTH);
        properties
            .angular_inertia_scale
            .get_or_insert(flight.angular_inertia_scale);
        properties
            .name
            .get_or_insert_with(|| definition.name.clone());
        let mut object = GameObject::new(id, properties, &catalog.simulation);
        object.kind = "ship".into();
        object.shades = catalog.colors.get("white").cloned();
        if definition_id != "mustang" {
            object.definition_id = definition_id.into();
        }

        let mut craft = Craft::new(object, &definition.hull_segments);
        craft.hatch_opening_threshold = catalog
            .module_specs
            .get("cargoHatch")
            .map_or(0.0, |spec| spec.cargo_geometry.opening_threshold);
        craft.weapon_retraction_distance = definition.weapon_retraction_distance;
        let thruster_mount_count = craft
            .mounts
            .iter()
            .filter(|mount| {
                mount.points.iter().flat_map(|point| &point.fits).any(|id| {
                    catalog
                        .module_specs
                        .get(id)
                        .is_some_and(|module| module.forward_thrust != 0.0)
                })
            })
            .count();
        let mut ship = Self {
            craft,
            fuel: definition.fuel_capacity,
            fuel_capacity: definition.fuel_capacity,
            stored_power: 0.0,
            thruster_power: 1.0,
            systems_power: 1.0,
            forward: 0.0,
            turn: 0.0,
            firing: false,
            target_id: None,
            npc_state: "",
            cargo_space: definition.cargo_space,
            thrust_boost_held: false,
            cargo_release_held: false,
            releasing_cargo: false,
            cargo_release_hatch: 0,
            cargo_release_time: 0.0,
            thruster_mount_count,
            flight,
            transit_scale_duration: catalog.portal_spec.transit_scale_duration / 1000.0,
            drag_coefficient: definition.drag,
            hull_mass: definition.hull_mass,
            angular_thrust: definition.angular_thrust,
            turn_rate: definition.turn_rate,
        };
        ship.update_mass();
        Some(ship)
    }

    pub fn new_player(
        id: i64,
        definition_id: &str,
        properties: ObjectProperties,
        catalog: &Catalog,
        mut module_id: impl FnMut() -> i64,
    ) -> Option<Self> {
        let definition_id = if definition_id.is_empty() {
            "mustang"
        } else {
            definition_id
        };
        let mut ship = Self::new(id, definition_id, properties, catalog)?;
        let definition = &catalog.ship_specs[definition_id];
        for entry in &definition.initial_loadout {
            let spec = catalog.module_specs.get(&entry.module)?;
            ship.craft.mounts.get(entry.mount)?;
            let mut module =
                InstalledModule::new(module_id(), entry.module.clone(), Arc::clone(spec));
            if entry.shades.is_some() {
                module.shades.clone_from(&entry.shades);
            }
            ship.fit(entry.mount, Some(module));
        }
        ship.stored_power = ship.power_rates().capacity;
        Some(ship)
    }

    pub fn fit(
        &mut self,
        mount: usize,
        module: Option<InstalledModule>,
    ) -> Option<InstalledModule> {
        let previous = self.craft.fit(mount, module);
        self.update_mass();
        previous
    }

    pub fn update_mass(&mut self) {
        update_ship_mass(&mut self.craft, self.hull_mass, self.drag_coefficient);
    }

    pub fn engine(&self) -> Option<&InstalledModule> {
        for mount in &self.craft.mounts {
            let hull = &self.craft.hulls[mount.hull];
            if !hull.present || hull.health < 1.0 || mount.health < 1.0 {
                continue;
            }
            if let Some(engine) = &mount.module
                && engine.spec.forward_thrust != 0.0
            {
                return Some(engine);
            }
        }
        None
    }

    pub fn stranded(&self) -> bool {
        !self.craft.object.dead
            && !self.craft.docked()
            && self.craft.launching == 0.0
            && (self.engine().is_none() || self.fuel <= 0.0)
            && self.craft.hulls.iter().any(|hull| {
                hull.present && hull.plan.core && (hull.health >= 1.0 || hull.health.is_nan())
            })
    }

    /// Empty and destroyed thruster mounts remain in the thrust denominator.
    pub fn thruster_output(&self) -> ThrusterOutput {
        self.configured_thrusters().0
    }

    fn configured_thrusters(&self) -> (ThrusterOutput, bool) {
        let mut output = ThrusterOutput::default();
        let mut has_booster = false;
        for mount in &self.craft.mounts {
            let hull = &self.craft.hulls[mount.hull];
            if !hull.present || hull.health < 1.0 || mount.health < 1.0 {
                continue;
            }
            if let Some(module) = &mount.module {
                if module.spec.forward_thrust != 0.0 {
                    output.forward += module.spec.forward_thrust;
                    output.rotational += module.spec.rotational_thrust;
                    output.fuel += module.spec.fuel_usage;
                }
                has_booster |= module.spec.booster.is_some();
            }
        }

        if self.thruster_mount_count > 0 {
            output.forward /= self.thruster_mount_count as f64;
            output.rotational /= self.thruster_mount_count as f64;
        } else {
            output.forward = 0.0;
            output.rotational = 0.0;
        }

        (output, has_booster)
    }

    pub fn low_fuel(&self) -> bool {
        self.fuel < self.fuel_capacity * self.flight.low_fuel_threshold
    }

    pub fn fuel_throttle(&self) -> f64 {
        if self.fuel <= 0.0 {
            0.0
        } else if self.low_fuel() {
            self.flight.low_fuel_speed
        } else {
            1.0
        }
    }

    pub fn refuel_cost(&self) -> f64 {
        let missing = self.fuel_capacity - self.fuel;
        if missing <= 0.5 {
            0.0
        } else {
            (missing * self.flight.fuel_price).ceil()
        }
    }

    pub fn consume_fuel(&mut self, duration: f64) {
        if self.craft.cockpit.is_none() || self.craft.object.dead || self.craft.docked() {
            return;
        }

        self.consume_fuel_with_output(duration, self.thruster_output().fuel);
    }

    fn consume_fuel_with_output(&mut self, duration: f64, fuel: f64) {
        let usage = fuel * self.thruster_power * self.forward.max(self.turn.abs() / 2.0);
        let reserve = self.fuel_capacity * self.flight.low_fuel_threshold;
        let normal = (self.fuel - reserve).max(0.0).min(usage * duration);
        self.fuel = (self.fuel - normal - (usage * duration - normal) * self.flight.low_fuel_usage)
            .max(0.0);
    }

    pub fn launch_throttle(&self) -> f64 {
        if self.craft.launching > self.flight.launch_half_threshold
            && self.craft.launching <= self.flight.launch_half_end
        {
            self.flight.launch_throttle
        } else {
            1.0
        }
    }

    pub fn forward_thrust(&self) -> f64 {
        let (output, has_booster) = self.configured_thrusters();
        let booster = if has_booster {
            self.booster_multiplier(false)
        } else {
            1.0
        };
        self.forward_thrust_with_output(output.forward, booster)
    }

    fn forward_thrust_with_output(&self, forward: f64, booster: f64) -> f64 {
        let throttle = self.launch_throttle();
        forward
            * (throttle * throttle)
            * self.fuel_throttle()
            * self.thruster_power
            * self.craft.flight_mode_state().1
            * booster
    }

    pub fn rotational_thrust(&self) -> f64 {
        let throttle = self.launch_throttle();
        let (output, has_booster) = self.configured_thrusters();
        let booster = if has_booster {
            self.booster_multiplier(false)
        } else {
            1.0
        };
        output.rotational
            * (throttle * throttle)
            * self.fuel_throttle()
            * self.thruster_power
            * self.craft.flight_mode_state().1
            * booster
    }

    pub fn angular_acceleration(&self) -> f64 {
        self.rotational_thrust() * self.angular_thrust / self.craft.object.mass
    }

    pub fn maximum_turn_rate(&self) -> f64 {
        self.turn_rate * self.angular_acceleration() / self.flight.spin_divisor
    }

    pub fn max_speed(&self) -> f64 {
        if self.craft.cockpit.is_some() {
            let (output, has_booster) = self.configured_thrusters();
            return self.max_speed_with_output(output.forward, has_booster);
        }
        self.flight.uncrewed_max_speed
    }

    fn max_speed_with_output(&self, forward: f64, has_booster: bool) -> f64 {
        let (thrust, speed) = if has_booster {
            (
                self.booster_multiplier(false),
                self.booster_multiplier(true),
            )
        } else {
            (1.0, 1.0)
        };
        let speed = self.flight.speed_per_thrust * self.forward_thrust_with_output(forward, thrust)
            / thrust
            * speed;
        if speed != 0.0 {
            speed
        } else {
            self.flight.uncrewed_max_speed
        }
    }

    pub fn fly(&mut self, forward: f64, turn: f64) {
        self.forward = forward;
        self.turn = turn;
        let launch = self.launch_throttle();
        let fuel = self.fuel_throttle();
        let ease = self.flight.steering_ease;
        let mut changed = false;
        for mount in &mut self.craft.mounts {
            if !self.craft.hulls[mount.hull].present {
                continue;
            }
            let Some(module) = &mut mount.module else {
                continue;
            };
            if module.spec.forward_thrust == 0.0 {
                continue;
            }
            for part in &mut module.parts {
                let active = if turn == 0.0 {
                    forward
                } else if part.nozzle_side == 0.0 {
                    (forward * (1.0 - turn.abs() * (1.0 - ease))).max(turn.abs() * ease)
                } else if turn == -part.nozzle_side {
                    1.0
                } else {
                    forward * ease
                };
                let active = active * (launch * fuel * self.thruster_power);
                changed |= module.collision_activation && active.to_bits() != part.active.to_bits();
                part.active = active;
            }
        }
        if changed {
            self.craft.invalidate_collision_geometry();
        }
    }

    pub fn launch(&mut self, bearing: Option<f64>) {
        if let Some(bearing) = bearing {
            self.craft.object.face(bearing);
            self.craft.object.spin = 0.0;
        }
        self.craft.docked_to = None;
        self.craft.launching = self.flight.launch_duration;
        self.craft.has_launching = true;
    }

    /// Attach a piloted ship after a collider reports docking-bay contact.
    pub fn dock_at(&mut self, docking_craft: &Craft, events: &mut Vec<SimulationEvent>) -> bool {
        if self.craft.cockpit.is_none() || self.craft.docked() || self.craft.launching != 0.0 {
            return false;
        }

        self.craft.docked_to = Some(docking_craft.object.id);
        self.craft.invalidate_collision_geometry();
        self.craft.object.position = docking_craft.object.position;
        self.craft.object.velocity = Vector::ZERO;
        self.craft.object.spin = 0.0;
        for mount in &mut self.craft.mounts {
            if let Some(module) = &mut mount.module {
                for part in &mut module.parts {
                    part.active = 0.0;
                }
            }
        }

        if let Some(player_id) = self.craft.object.player_id {
            events.push(SimulationEvent::Docked {
                player_id,
                docked_to: docking_craft.object.id,
            });
        }

        true
    }

    pub fn control_flight(&mut self, input: Input, launch_bearing: Option<f64>) {
        self.target_id = input.target_id;
        self.trigger_thrust_boost(input.thrust_boost);
        if self.craft.transit_time != 0.0 {
            self.firing = false;
            self.fly(0.0, 0.0);
            return;
        }
        self.firing = input.fire;
        if input.launch {
            self.launch(launch_bearing);
        }
        let forward = if self.craft.launching != 0.0 || input.launch {
            1.0
        } else {
            input.thrust.clamp(0.0, 1.0)
        };
        self.fly(forward, input.turn.clamp(-1.0, 1.0));
    }

    pub fn advance_flight(&mut self, duration: f64, step: ShipStep<'_>) -> MovementOutcome {
        self.update_power(duration);
        if self.craft.transit_time != 0.0 {
            if let Some(portal) = step.portal_position {
                let object = &mut self.craft.object;
                let remaining = -self.craft.transit_time - self.transit_scale_duration;
                let ratio = if self.craft.transit_time < 0.0 && remaining > duration {
                    duration / remaining
                } else {
                    1.0
                };
                object.position = object.position.add_scaled(portal - object.position, ratio);
            }
            self.craft.object.velocity = Vector::ZERO;
            self.craft.object.spin = 0.0;
            self.fly(0.0, 0.0);
            self.update_boosters(duration);
            self.craft
                .update_modules(duration, self.systems_power, step.tick);
            self.craft.transit_time = if self.craft.transit_time < 0.0 {
                (self.craft.transit_time + duration).min(-1e-6)
            } else {
                (self.craft.transit_time - duration).max(0.0)
            };
            return MovementOutcome::Moved;
        }

        if self.craft.launching != 0.0 {
            self.craft.launching = (self.craft.launching - duration).max(0.0);
            self.fly(self.forward, self.turn);
        }

        // These updates change module activity but keep the mount health and loadout.
        let thrust_output = self
            .craft
            .cockpit
            .is_some()
            .then(|| self.configured_thrusters());
        if let Some((output, has_booster)) = thrust_output
            && !self.craft.docked()
        {
            let throttle = self.launch_throttle();
            let booster = if has_booster {
                self.booster_multiplier(false)
            } else {
                1.0
            };
            let boost = self.craft.flight_mode_state().1 * booster;
            let forward = (output.forward * boost)
                * (throttle * throttle)
                * self.fuel_throttle()
                * self.thruster_power;
            let thrust = (output.rotational * boost)
                * (throttle * throttle)
                * self.fuel_throttle()
                * self.thruster_power
                * self.angular_thrust
                / self.craft.object.mass;
            let object = &mut self.craft.object;
            let push =
                ((self.flight.thrust_scale * forward) / object.mass) * self.forward * duration;
            let target = self.turn * self.turn_rate * thrust * (throttle * throttle)
                / self.flight.spin_divisor;
            object.spin = approach(object.spin, target, thrust * duration);
            object.velocity = move_point(
                object.velocity,
                object.rotation + object.spin * duration,
                push,
            );

            if !self.craft.object.dead {
                let throttle = self.fuel_throttle();
                self.consume_fuel_with_output(duration, output.fuel);
                if throttle != self.fuel_throttle() {
                    self.fly(self.forward, self.turn);
                }
            }
        }

        self.update_boosters(duration);
        self.craft
            .update_modules(duration, self.systems_power, step.tick);
        let context = MotionContext {
            maximum_speed: Some(
                thrust_output.map_or(self.flight.uncrewed_max_speed, |(output, has_booster)| {
                    self.max_speed_with_output(output.forward, has_booster)
                }),
            ),
            ..step.movement
        };
        let outcome = self.craft.object.update(duration, context);
        if self.craft.docked() {
            let object = &mut self.craft.object;
            if let Some(position) = step.docked_position {
                object.position = position;
            }
            object.velocity = Vector::ZERO;
            object.spin = 0.0;
        }
        outcome
    }
}

pub(super) fn update_ship_mass(craft: &mut Craft, hull_mass: f64, drag_coefficient: f64) {
    let mut mass = hull_mass;
    for mount in &craft.mounts {
        if craft.hulls[mount.hull].present
            && let Some(module) = &mount.module
        {
            mass += module.spec.mass;
        }
    }

    if mass > 0.0 {
        craft.object.mass = mass;
        craft.object.drag = drag_coefficient / mass;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(definition: &str, catalog: &Catalog) -> Ship {
        let mut next_module = 0;
        Ship::new_player(1, definition, ObjectProperties::default(), catalog, || {
            next_module -= 1;
            next_module
        })
        .expect("stock ship has a valid loadout")
    }

    fn near(actual: f64, expected: f64) {
        assert!((actual - expected).abs() <= 1e-8, "{actual} != {expected}");
    }

    #[test]
    fn original_thruster_mounts_determine_thrust_and_fuel() -> Result<(), crate::specs::CatalogError>
    {
        let catalog = Catalog::load()?;
        let mut ship = player("moth", &catalog);
        let medium = Arc::clone(
            &ship.craft.mounts[3]
                .module
                .as_ref()
                .expect("stock medium engine")
                .spec,
        );
        let large = Arc::clone(&catalog.module_specs["thrusterDualLg"]);
        ship.fit(
            8,
            Some(InstalledModule::new(
                -20,
                "thrusterDualLg".into(),
                Arc::clone(&large),
            )),
        );
        let check = |ship: &mut Ship, forward, rotational, fuel| {
            near(ship.forward_thrust(), forward);
            near(ship.rotational_thrust(), rotational);
            ship.fuel = ship.fuel_capacity;
            ship.fly(1.0, 0.0);
            ship.consume_fuel(1.0);
            near(ship.fuel_capacity - ship.fuel, fuel);
        };

        check(
            &mut ship,
            (medium.forward_thrust + large.forward_thrust) / 2.0,
            (medium.rotational_thrust + large.rotational_thrust) / 2.0,
            medium.fuel_usage + large.fuel_usage,
        );
        let spare = ship.fit(8, None);
        check(
            &mut ship,
            medium.forward_thrust / 2.0,
            medium.rotational_thrust / 2.0,
            medium.fuel_usage,
        );
        ship.fit(8, spare);
        ship.craft.hulls[ship.craft.mounts[3].hull].health = 0.0;
        check(
            &mut ship,
            large.forward_thrust / 2.0,
            large.rotational_thrust / 2.0,
            large.fuel_usage,
        );
        assert_eq!(
            ship.engine().expect("operating engine").definition_id,
            "thrusterDualLg"
        );
        Ok(())
    }

    #[test]
    fn reserve_fuel_scales_movement_usage_and_flare() -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let mut ship = player("mustang", &catalog);
        let usage = ship.engine().expect("stock engine").spec.fuel_usage;
        for (thrust, turn, factor) in [
            (1.0, 0.0, 1.0),
            (0.0, 1.0, 0.5),
            (0.0, -1.0, 0.5),
            (1.0, 1.0, 1.0),
            (0.0, 0.0, 0.0),
        ] {
            ship.fuel = ship.fuel_capacity;
            ship.fly(thrust, turn);
            ship.advance_flight(1.0, ShipStep::default());
            near(ship.fuel_capacity - ship.fuel, usage * factor);
        }

        let full_speed = ship.max_speed();
        ship.fuel = ship.fuel_capacity * catalog.simulation.flight.low_fuel_threshold;
        assert!(!ship.low_fuel());
        ship.fuel = 3.0;
        ship.fly(1.0, 1.0);
        near(ship.max_speed(), full_speed / 2.0);
        ship.advance_flight(1.0, ShipStep::default());
        near(ship.fuel, 3.0 - usage * 0.25);
        ship.fuel = 1e-10;
        ship.advance_flight(1.0, ShipStep::default());
        assert_eq!(ship.fuel, 0.0);
        assert_eq!(ship.forward_thrust(), 0.0);
        assert!(
            ship.engine()
                .expect("stock engine")
                .parts
                .iter()
                .all(|part| part.active == 0.0)
        );

        ship.fuel = 60.0;
        ship.craft.docked_to = Some(999);
        ship.advance_flight(1.0, ShipStep::default());
        near(ship.fuel, 60.0);
        Ok(())
    }

    #[test]
    fn boosters_share_lockout_and_taper_cruising_speed() -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let mut ship = player("excel8", &catalog);
        let original_speed = ship.max_speed();
        let booster = catalog.module_specs["thrustBooster"]
            .booster
            .expect("booster tuning");
        ship.trigger_thrust_boost(true);
        near(ship.booster_multiplier(false), 1.0);
        ship.update_boosters(booster.ramp_duration);
        near(ship.booster_multiplier(false), booster.multiplier.powi(2));
        near(
            ship.max_speed(),
            original_speed * booster.multiplier.powi(2),
        );

        ship.update_boosters(booster.duration - booster.ramp_duration + booster.cooldown / 2.0);
        near(ship.booster_multiplier(false), 1.0);
        near(
            ship.booster_multiplier(true),
            (1.0 + (booster.multiplier - 1.0) / 2.0).powi(2),
        );

        let remaining = ship.craft.mounts[1]
            .module
            .as_ref()
            .expect("left booster")
            .fire_cooldown;
        ship.trigger_thrust_boost(false);
        ship.trigger_thrust_boost(true);
        near(
            ship.craft.mounts[1]
                .module
                .as_ref()
                .expect("left booster")
                .fire_cooldown,
            remaining,
        );
        Ok(())
    }
}
