//! Hull and installed module state shared by moving and docked craft.

use std::sync::{Arc, Mutex};

use crate::simulation::game_object::GameObject;
use crate::specs::{
    DEFAULT_ACTIVATION_DURATION, HULL_Z_INDEX, HullSegment, ModelPart, Module, MountPoint,
};
use crate::utilities::approach;
use crate::utilities::vector::Vector;

use super::item::Item;

#[derive(Debug)]
pub enum CargoObject {
    Item(Box<Item>),
    Module(InstalledModule),
}

impl CargoObject {
    pub fn id(&self) -> i64 {
        match self {
            Self::Item(item) => item.object.id,
            Self::Module(module) => module.id,
        }
    }
}

#[derive(Debug)]
pub struct Hull {
    pub plan: HullSegment,
    pub health: f64,
    pub present: bool,
    pub position: Vector,
    pub original_position: Vector,
    pub(crate) flight_offset: Option<Vector>,
    pub(super) collider_plan: super::colliders::HullColliderPlan,
}

#[derive(Debug)]
pub struct Mount {
    pub hull: usize,
    pub health: f64,
    pub health_activated: Option<f64>,
    pub position: Vector,
    pub points: Vec<MountPoint>,
    pub module: Option<InstalledModule>,
}

impl Mount {
    pub fn accepts(&self, module: &str) -> bool {
        self.points
            .iter()
            .any(|point| point.fits.iter().any(|id| id == module))
    }

    pub(crate) fn point(&self) -> Option<&MountPoint> {
        self.module
            .as_ref()
            .and_then(|module| {
                self.points
                    .iter()
                    .find(|point| point.fits.iter().any(|id| id == &module.definition_id))
            })
            .or_else(|| self.points.first())
    }
}

#[derive(Debug)]
pub struct InstalledModule {
    pub id: i64,
    pub definition_id: String,
    pub spec: Arc<Module>,
    pub shades: Option<Vec<String>>,
    pub fire_cooldown: f64,
    pub charge_cooldown: f64,
    pub aim_rotation: f64,
    pub parts: Vec<ModulePart>,
    pub(crate) fitted_order: u64,
    pub(super) collision_activation: bool,
}

impl InstalledModule {
    pub fn new(id: i64, definition_id: String, spec: Arc<Module>) -> Self {
        let collision_activation =
            matches!(
                spec.behavior.as_str(),
                "cargoHatch" | "hornDrill" | "weapon" | "beam"
            ) || spec.model.iter().any(|model| model.covers || model.catches);
        Self {
            id,
            definition_id,
            shades: spec.shades.clone(),
            fire_cooldown: 0.0,
            charge_cooldown: spec.charge_duration,
            aim_rotation: 0.0,
            parts: Vec::new(),
            fitted_order: 0,
            collision_activation,
            spec,
        }
    }

    pub(crate) fn wire_parts(&self) -> impl Iterator<Item = &ModulePart> {
        // The search light's beam precedes its housing on the wire. It has
        // no collision radius, so the authored hull and mount indexes stay intact.
        let (housing, beam) = self
            .parts
            .split_at(self.spec.model.len().min(self.parts.len()));
        beam.iter().chain(housing)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ModulePart {
    pub position: Vector,
    pub active: f64,
    pub activation_progress: f64,
    pub rate: f64,
    pub nozzle_side: f64,
    pub covers: bool,
    pub biting: bool,
    pub expanding_tick: Option<u64>,
}

impl ModulePart {
    pub(crate) fn set_active(
        &mut self,
        spec: &Module,
        activated_health: Option<f64>,
        mut active: f64,
    ) -> bool {
        let previous = [self.active.to_bits(), self.activation_progress.to_bits()];
        if active != 0.0
            && spec.recharge_duration > 0.0
            && let (Some(health), Some(maximum)) = (activated_health, spec.health_activated)
            && (health <= 0.0 || self.active == 0.0 && health < maximum - 1e-9)
        {
            active = 0.0;
        }

        if spec.discharge_duration > 0.0 && self.active != active {
            let ratio = 1.0 + spec.discharge_duration * self.rate;
            if active == 1.0 {
                self.activation_progress = (self.activation_progress * ratio).min(1.0);
            } else if self.activation_progress != 1.0 {
                self.activation_progress /= ratio;
            }
        }

        self.active = active;
        previous != [self.active.to_bits(), self.activation_progress.to_bits()]
    }
}

#[derive(Debug)]
pub struct Craft {
    pub object: GameObject,
    pub hulls: Vec<Hull>,
    pub mounts: Vec<Mount>,
    pub cargo_contents: Vec<CargoObject>,
    pub suppress_drops: bool,
    pub wreckage: Vec<super::wreckage::WreckagePart>,
    pub cockpit: Option<usize>,
    pub docked_to: Option<i64>,
    pub launching: f64,
    pub has_launching: bool,
    pub transit_time: f64,
    pub transit_gate: Option<i64>,
    pub collision_tick: Option<u64>,
    pub hatch_opening_threshold: f64,
    pub weapon_retraction_distance: Option<f64>,
    pub(super) collider_cache: Mutex<super::colliders::CraftColliderCache>,
    pub(crate) fitted_order: u64,
    pub(super) collision_revision: u64,
}

impl Craft {
    pub fn new(object: GameObject, plans: &[HullSegment]) -> Self {
        let has_flight_offset = plans.iter().any(|plan| plan.flight_offset.is_some());
        let hulls = plans
            .iter()
            .enumerate()
            .map(|(index, plan)| Hull {
                plan: plan.clone(),
                health: plan.health.unwrap_or(f64::NAN),
                present: true,
                position: Vector::ZERO,
                original_position: Vector::ZERO,
                collider_plan: super::colliders::HullColliderPlan::new(plan),
                flight_offset: has_flight_offset
                    .then(|| super::modules::flight_mode::flight_offset(plans, index, 0))
                    .flatten(),
            })
            .collect::<Vec<_>>();

        let mut hull_order: Vec<_> = (0..plans.len()).collect();
        hull_order.sort_by_key(|&index| plans[index].z_index.unwrap_or(HULL_Z_INDEX));
        let mounts = hull_order
            .into_iter()
            .flat_map(|hull| {
                plans[hull].mounts.iter().map(move |points| {
                    let position = points
                        .first()
                        .map_or(Vector::ZERO, |point| Vector::new(point.x, point.y));
                    Mount {
                        hull,
                        health: f64::NAN,
                        health_activated: None,
                        position,
                        points: points.clone(),
                        module: None,
                    }
                })
            })
            .collect();

        Self {
            object,
            cockpit: hulls.iter().position(|hull| hull.plan.core),
            hulls,
            mounts,
            cargo_contents: Vec::new(),
            suppress_drops: false,
            wreckage: Vec::new(),
            docked_to: None,
            launching: 0.0,
            has_launching: false,
            transit_time: 0.0,
            transit_gate: None,
            collision_tick: None,
            hatch_opening_threshold: 0.0,
            weapon_retraction_distance: None,
            collider_cache: Mutex::default(),
            fitted_order: 0,
            collision_revision: 0,
        }
    }

    pub fn docked(&self) -> bool {
        self.docked_to.is_some_and(|id| id != 0)
    }

    pub(super) fn invalidate_collision_geometry(&mut self) {
        self.collision_revision = self.collision_revision.wrapping_add(1);
    }

    /// Replaces a module at an existing mount and returns the removed module.
    pub fn fit(
        &mut self,
        index: usize,
        module: Option<InstalledModule>,
    ) -> Option<InstalledModule> {
        self.invalidate_collision_geometry();
        let mount = &mut self.mounts[index];
        let previous = std::mem::replace(&mut mount.module, module);
        mount.health = 0.0;
        let fitted_point = mount.point().map(|point| {
            (
                point.x,
                point.y,
                point.cargo_pickup_offset,
                point.thruster_offset,
            )
        });
        if let Some((x, y, _, _)) = fitted_point {
            mount.position = self.hulls[mount.hull].position + Vector::new(x, y);
        }

        if let Some(module) = &mut mount.module {
            self.fitted_order = self.fitted_order.wrapping_add(1);
            module.fitted_order = self.fitted_order;
            let spec = &module.spec;
            mount.health_activated = spec.health_activated;
            mount.health = if spec.health == 0.0 {
                spec.health_activated.unwrap_or(f64::NAN)
            } else {
                spec.health
            };
            if module.shades.is_none() {
                module.shades.clone_from(&self.object.shades);
            }
            let rate = 1.0
                / if spec.activation_duration == 0.0 {
                    DEFAULT_ACTIVATION_DURATION
                } else {
                    spec.activation_duration
                };
            let beam = ModelPart::default();
            module.parts = spec
                .model
                .iter()
                .chain((spec.behavior == "searchLight").then_some(&beam))
                .map(|part| {
                    let nozzle_side = part.thruster_nozzle_side;
                    let mut side = nozzle_side;
                    if spec.behavior == "cargoHatch" && mount.position.y != 0.0 {
                        side = -mount.position.y.signum();
                    }
                    let mut offset = spec.offset;
                    if let Some((_, _, cargo_offset, thruster_offset)) = fitted_point {
                        if part.catches
                            && let Some(cargo_offset) = cargo_offset
                        {
                            offset = cargo_offset;
                        } else if nozzle_side != 0.0 {
                            offset += thruster_offset;
                        }
                    }
                    ModulePart {
                        position: mount.position + Vector::new(0.0, side * offset),
                        active: 0.0,
                        activation_progress: 0.0,
                        rate: if part.covers
                            && spec.behavior == "shieldGenerator"
                            && spec.cover_duration != 0.0
                        {
                            1.0 / spec.cover_duration
                        } else {
                            rate
                        },
                        nozzle_side,
                        covers: part.covers,
                        biting: false,
                        expanding_tick: None,
                    }
                })
                .collect();
        }

        self.update_flight_mode();
        previous
    }

    pub fn set_module_active(&mut self, id: &str, enabled: bool) {
        let value = if enabled { 1.0 } else { 0.0 };
        let mut changed = false;
        for mount in &mut self.mounts {
            if self.hulls[mount.hull].present
                && let Some(module) = &mut mount.module
                && (module.definition_id == id || module.spec.behavior == id)
            {
                for part in &mut module.parts {
                    let changed_active =
                        part.set_active(&module.spec, mount.health_activated, value);
                    changed |= module.collision_activation && changed_active;
                }
            }
        }
        if changed {
            self.invalidate_collision_geometry();
        }
    }

    pub fn module_active(&self, id: &str) -> bool {
        self.mounts.iter().any(|mount| {
            self.hulls[mount.hull].present
                && (mount.health >= 1.0 || mount.health.is_nan())
                && mount.module.as_ref().is_some_and(|module| {
                    (module.definition_id == id || module.spec.behavior == id)
                        && module.parts.iter().any(|part| part.active != 0.0)
                        && (module.spec.recharge_duration == 0.0
                            || mount.health_activated.is_some_and(|health| health > 0.0))
                })
        })
    }

    pub(crate) fn update_modules(&mut self, duration: f64, systems_power: f64, tick: Option<u64>) {
        let previous_tick = std::mem::replace(&mut self.collision_tick, tick);
        let mut changed = false;
        let docked = self.docked();
        for mount in &mut self.mounts {
            let Some(module) = &mut mount.module else {
                continue;
            };
            let spec = &module.spec;
            let power = if spec.forward_thrust != 0.0 {
                1.0
            } else {
                systems_power
            };
            if docked {
                for part in &mut module.parts {
                    let changed_active = part.set_active(spec, mount.health_activated, 0.0);
                    changed |= module.collision_activation && changed_active;
                }
                if spec.behavior == "weapon" {
                    module.fire_cooldown = (module.fire_cooldown - duration).max(0.0);
                }
            }

            if spec.recharge_duration > 0.0
                && mount.health >= 1.0
                && let (Some(health), Some(maximum)) =
                    (mount.health_activated.as_mut(), spec.health_activated)
            {
                if *health <= 0.0 {
                    for part in &mut module.parts {
                        changed |= module.collision_activation
                            && (part.active.to_bits() != 0
                                || part.covers && part.activation_progress.to_bits() != 0);
                        part.active = 0.0;
                        if part.covers {
                            part.activation_progress = 0.0;
                        }
                    }
                }
                if !module.parts.iter().any(|part| part.active != 0.0) {
                    *health = (*health + maximum * duration * power / spec.recharge_duration)
                        .min(maximum);
                }
            }

            for (index, part) in module.parts.iter_mut().enumerate() {
                let mut target = part.active * power;
                if mount.health < 1.0 {
                    target = 0.0;
                }
                let previous = part.activation_progress;
                let was_expanding =
                    part.covers && previous_tick.is_some() && part.expanding_tick == previous_tick;
                let rate = if target == 0.0 && spec.discharge_duration > 0.0 {
                    1.0 / (1.0 / part.rate + spec.discharge_duration)
                } else {
                    part.rate
                };
                part.activation_progress = approach(previous, target, rate * duration);
                if index == 0 && spec.charge_duration > 0.0 {
                    let ready_time = (duration - (1.0 - previous) / part.rate).max(0.0);
                    module.charge_cooldown = if target == 1.0 && part.activation_progress == 1.0 {
                        (module.charge_cooldown - ready_time).max(0.0)
                    } else {
                        spec.charge_duration
                    };
                }
                if part.covers && part.activation_progress > previous {
                    part.expanding_tick = tick;
                }
                if module.collision_activation && index < spec.model.len() {
                    let expanding = part.covers && tick.is_some() && part.expanding_tick == tick;
                    changed |= was_expanding != expanding
                        || previous.to_bits() != part.activation_progress.to_bits();
                }
            }
        }
        if changed {
            self.invalidate_collision_geometry();
        }
        self.update_flight_mode();
    }
}

#[cfg(test)]
mod tests {
    use crate::gameplay::collision_world::ColliderPart;
    use crate::objects::ship::Ship;
    use crate::simulation::game_object::ObjectProperties;
    use crate::specs::{Catalog, DEFAULT_ACTIVATION_DURATION};

    #[test]
    fn search_light_beam_is_first_on_wire_and_has_no_collider() {
        let catalog = Catalog::load().unwrap();
        let mut id = 0;
        let mut ship =
            Ship::new_player(1, "mustang", ObjectProperties::default(), &catalog, || {
                id -= 1;
                id
            })
            .unwrap();
        let mount = ship
            .craft
            .mounts
            .iter()
            .position(|mount| {
                mount
                    .module
                    .as_ref()
                    .is_some_and(|module| module.definition_id == "searchLight")
            })
            .unwrap();
        ship.craft.set_module_active("searchLight", true);
        ship.craft
            .update_modules(DEFAULT_ACTIVATION_DURATION / 4.0, 0.5, Some(1));
        let module = ship.craft.mounts[mount].module.as_ref().unwrap();
        let beam = module.wire_parts().next().unwrap();
        assert!(std::ptr::eq(beam, module.parts.last().unwrap()));
        assert_eq!(beam.active, 1.0);
        assert_eq!(beam.activation_progress, 0.25);
        assert_eq!(module.wire_parts().count(), module.spec.model.len() + 1);
        ship.craft.with_hitboxes(|hitboxes| {
            assert!(hitboxes.iter().all(|hitbox| {
                match hitbox.user_data.part {
                    ColliderPart::Module {
                        mount: index,
                        model_part,
                    } if mount == index => model_part < module.spec.model.len(),
                    _ => true,
                }
            }));
        });
        ship.craft.set_module_active("searchLight", false);
        ship.craft
            .update_modules(DEFAULT_ACTIVATION_DURATION / 4.0, 0.5, Some(2));
        let beam = ship.craft.mounts[mount]
            .module
            .as_ref()
            .unwrap()
            .wire_parts()
            .next()
            .unwrap();
        assert_eq!(beam.active, 0.0);
        assert_eq!(beam.activation_progress, 0.0);
    }
}
