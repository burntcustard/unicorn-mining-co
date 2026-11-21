//! Reuse local hull and module collision outlines between updates.

use std::collections::HashMap;
use std::hash::{BuildHasher, Hash, Hasher};
use std::sync::LazyLock;

use hashbrown::DefaultHashBuilder;
use smallvec::SmallVec;

use crate::gameplay::collision_world::{ColliderPart, CollisionEntity, GateMotion, ObjectCollider};
use crate::gameplay::game_collisions::{ColliderGeometry, ColliderMaterial, GatePanelMotion, Pose};
use crate::protocol::SimulationEvent;
use crate::simulation::game_object::GameObject;
use crate::simulation::geometry::shape_outline_extent;
use crate::simulation::polygon::radius_of;
use crate::specs::{
    CargoGeometry, GAME_OBJECT_FRICTION, HULL_BOUNCINESS, HULL_Z_INDEX, HullSegment, ModelPart,
    Module, Point,
};
use crate::utilities::vector::Vector;

use super::craft::Craft;
use super::item::Item;
use super::portal::Portal;
use super::ship::Ship;
use super::station::Station;

#[derive(Debug)]
pub(super) struct HullColliderPlan {
    pub(super) middle: Vector,
    pub(super) radius: f64,
    outlines: Vec<Vec<Point>>,
}

impl Craft {
    pub(super) fn module_wreckage_shape(
        &self,
        mount_index: usize,
        model_part: usize,
    ) -> Option<(Vector, f64, Vec<Point>)> {
        let mount = self.mounts.get(mount_index)?;
        let module = mount.module.as_ref()?;
        let part = module.parts.get(model_part)?;
        let model = module.spec.model.get(model_part)?;
        let mount_side = if mount.position.y < 0.0 {
            -1.0
        } else if mount.position.y > 0.0 {
            1.0
        } else {
            0.0
        };
        let mut plan = ModelColliderPlan::default();
        plan.update(
            ModelKey {
                module: module.id,
                definition: std::sync::Arc::as_ptr(&module.spec) as usize,
                mirror: model.mirror_with_mount && mount.position.y < 0.0,
                mount_side,
                progress: part.activation_progress,
                active: part.active == 1.0,
                aim_rotation: module.aim_rotation,
                // Detached mounts use the module's default retraction.
                retraction: module.spec.retraction_distance,
            },
            &module.spec,
            model,
            model_part,
        );
        let points = plan
            .outline
            .iter()
            .map(|[x, y]| [x + plan.middle.x, y + plan.middle.y])
            .collect();
        Some((part.position, plan.radius, points))
    }
}

impl HullColliderPlan {
    pub(super) fn new(plan: &HullSegment) -> Self {
        let ([x, y], radius) = if plan.points.is_empty() {
            ([0.0, 0.0], 0.0)
        } else {
            shape_outline_extent(&plan.points)
        };
        let recenter = |points: &[Point]| {
            points
                .iter()
                .map(|point| [point[0] - x, point[1] - y])
                .collect()
        };
        let outlines = plan.collision_parts.as_ref().map_or_else(
            || vec![recenter(&plan.points)],
            |parts| parts.iter().map(|points| recenter(points)).collect(),
        );
        Self {
            middle: Vector::new(x, y),
            radius,
            outlines,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct ModelKey {
    module: i64,
    definition: usize,
    mirror: bool,
    mount_side: f64,
    progress: f64,
    active: bool,
    aim_rotation: f64,
    retraction: f64,
}

#[derive(Debug, Default)]
pub(super) struct ModelColliderPlan {
    key: Option<ModelKey>,
    middle: Vector,
    radius: f64,
    outline: SmallVec<[Point; 16]>,
}

type ColliderOrderKey = (i32, u8, u64, usize);

#[derive(Debug, Default)]
pub(super) struct CraftColliderCache {
    module_outlines: Vec<Vec<ModelColliderPlan>>,
    order_keys: Vec<ColliderOrderKey>,
    ordered_indices: Vec<usize>,
}

impl ModelColliderPlan {
    fn update(&mut self, key: ModelKey, module: &Module, part: &ModelPart, index: usize) {
        if self.key == Some(key) {
            return;
        }
        let previous = self.key.replace(key);
        self.outline.clear();
        self.middle = Vector::ZERO;
        if weapon_barrel(module, part) {
            if previous.is_none_or(|previous| {
                previous.definition != key.definition
                    || previous.module != key.module
                    || previous.retraction != key.retraction
            }) {
                self.radius = radius_of(&part.points, [0.0, 0.0]);
                if !module.telescoping {
                    self.radius = self
                        .radius
                        .max(radius_of(&part.points, [key.retraction, 0.0]));
                }
            }

            let progress = if !key.active && module.discharge_duration > 0.0 {
                (key.progress * (1.0 + module.discharge_duration / module.activation_duration))
                    .min(1.0)
            } else {
                key.progress
            };
            let distance = key.retraction * (1.0 - progress);
            let side = if !module.turret && key.mount_side < 0.0 {
                -1.0
            } else {
                1.0
            };
            let (sin, cos) = if module.turret {
                key.aim_rotation.sin_cos()
            } else {
                (0.0, 1.0)
            };
            self.outline.extend(part.points.iter().map(|&[mut x, y]| {
                if module.telescoping {
                    x *= (1.0 - distance / module.barrel_length).max(0.0);
                } else {
                    x -= distance;
                }
                let y = y * side;
                if module.turret {
                    [x * cos - y * sin, x * sin + y * cos]
                } else {
                    [x, y]
                }
            }));
        } else {
            let sign = if key.mirror { -1.0 } else { 1.0 };
            if !part.points.is_empty() {
                self.outline
                    .extend(part.points.iter().map(|&[x, y]| [x, y * sign]));
                let ([x, y], _) = shape_outline_extent(&self.outline);
                self.middle = Vector::new(x, y);
            }

            if module.behavior == "cargoHatch" && !part.catches {
                let side = if module.cargo_geometry.paired {
                    if index == 1 { 1.0 } else { -1.0 }
                } else {
                    key.mount_side
                };
                self.outline.clear();
                self.outline
                    .extend(cargo_door_points(module.cargo_geometry, key.progress, side));
            }

            self.radius = if module.behavior == "cargoHatch" {
                if part.catches {
                    module.cargo_geometry.throat_radius
                } else {
                    module.cargo_geometry.door_radius
                }
            } else if module.behavior == "shieldGenerator" && part.covers {
                module.shield_radius * key.progress
            } else if part.radius != 0.0 {
                part.radius
            } else if self.outline.is_empty() {
                0.0
            } else {
                radius_of(&self.outline, [self.middle.x, self.middle.y])
            };
            for point in &mut self.outline {
                point[0] -= self.middle.x;
                point[1] -= self.middle.y;
            }
        }
    }
}

fn weapon_barrel(spec: &Module, part: &ModelPart) -> bool {
    !part.turret_base && (spec.behavior == "weapon" || spec.behavior == "beam")
}

fn cargo_door_points(geometry: CargoGeometry, progress: f64, side: f64) -> [Point; 4] {
    let (sin, cos) = (progress * geometry.open_angle).sin_cos();
    let from_y = side * geometry.length;
    let to_x = geometry.length * sin;
    let to_y = side * geometry.length * (1.0 - cos);
    let out_x = -side * cos * geometry.door_width;
    let out_y = -sin * geometry.door_width;
    [
        [out_x, from_y + out_y],
        [to_x + out_x, to_y + out_y],
        [to_x - out_x, to_y - out_y],
        [-out_x, from_y - out_y],
    ]
}

impl Craft {
    /// Live craft mutations that affect fixture geometry must advance the
    /// revision before the next collision synchronization.
    pub(crate) fn tracked_collision_source(&self) -> Option<u64> {
        if self.docked() || self.transit_time != 0.0 {
            return None;
        }
        static SOURCE_HASHER: LazyLock<DefaultHashBuilder> =
            LazyLock::new(DefaultHashBuilder::default);
        let mut state = SOURCE_HASHER.build_hasher();
        self.collision_revision.hash(&mut state);
        self.object.physics.hash(&mut state);
        self.object.radius.to_bits().hash(&mut state);
        self.object.friction.to_bits().hash(&mut state);
        self.hatch_opening_threshold.to_bits().hash(&mut state);
        self.weapon_retraction_distance
            .map(f64::to_bits)
            .hash(&mut state);
        Some(state.finish())
    }

    pub fn collision_source(&self) -> Option<u64> {
        if self.docked() || self.transit_time != 0.0 {
            return None;
        }

        static SOURCE_HASHER: LazyLock<DefaultHashBuilder> =
            LazyLock::new(DefaultHashBuilder::default);
        let mut state = SOURCE_HASHER.build_hasher();
        self.object.physics.hash(&mut state);
        self.object.radius.to_bits().hash(&mut state);
        self.object.friction.to_bits().hash(&mut state);
        self.hatch_opening_threshold.to_bits().hash(&mut state);
        self.weapon_retraction_distance
            .map(f64::to_bits)
            .hash(&mut state);
        for hull in &self.hulls {
            hull.present.hash(&mut state);
            (hull.health < 1.0).hash(&mut state);
            hash_position(hull.position, &mut state);
        }
        for mount in &self.mounts {
            (mount.health < 1.0).hash(&mut state);
            hash_position(mount.position, &mut state);
            if let Some(module) = &mount.module {
                module.id.hash(&mut state);
                std::sync::Arc::as_ptr(&module.spec).hash(&mut state);
                module.fitted_order.hash(&mut state);
                module.aim_rotation.to_bits().hash(&mut state);
                for part in module.parts.iter().take(module.spec.model.len()) {
                    hash_position(part.position, &mut state);
                    // A throttle or visual effect can advance without changing any fixture.
                    if module.collision_activation {
                        part.active.to_bits().hash(&mut state);
                        part.activation_progress.to_bits().hash(&mut state);
                    }
                    let expanding =
                        self.collision_tick.is_some() && self.collision_tick == part.expanding_tick;
                    expanding.hash(&mut state);
                }
            }
        }
        Some(state.finish())
    }

    pub fn with_hitboxes(
        &self,
        use_colliders: impl FnOnce(&[ColliderGeometry<'_, ObjectCollider>]),
    ) {
        if self.docked() || self.transit_time != 0.0 {
            use_colliders(&[]);
            return;
        }

        let object = &self.object;
        let mut cache = self
            .collider_cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let CraftColliderCache {
            module_outlines,
            order_keys,
            ordered_indices,
        } = &mut *cache;
        module_outlines.resize_with(self.mounts.len(), Vec::new);
        let mut open_hatches: SmallVec<[bool; 32]> = SmallVec::from_elem(false, self.hulls.len());
        for (mount, cache) in self.mounts.iter().zip(module_outlines.iter_mut()) {
            let Some(module) = &mount.module else {
                continue;
            };
            if mount.health < 1.0 || !self.hulls[mount.hull].present {
                continue;
            }
            let spec = &module.spec;
            let definition = std::sync::Arc::as_ptr(spec) as usize;
            let hatch = spec.behavior == "cargoHatch";
            if hatch {
                open_hatches[mount.hull] |= module
                    .parts
                    .iter()
                    .any(|part| part.activation_progress > self.hatch_opening_threshold);
            }
            let mount_side = if mount.position.y < 0.0 {
                -1.0
            } else if mount.position.y > 0.0 {
                1.0
            } else {
                0.0
            };
            let retraction = self
                .weapon_retraction_distance
                .unwrap_or(spec.retraction_distance);
            cache.resize_with(spec.model.len(), ModelColliderPlan::default);
            for (index, ((part, model), plan)) in
                module.parts.iter().zip(&spec.model).zip(cache).enumerate()
            {
                let dynamic = hatch || weapon_barrel(spec, model) || model.covers;
                let key = ModelKey {
                    module: module.id,
                    definition,
                    mirror: model.mirror_with_mount && mount.position.y < 0.0,
                    mount_side,
                    progress: if dynamic {
                        part.activation_progress
                    } else {
                        0.0
                    },
                    active: part.active == 1.0,
                    aim_rotation: module.aim_rotation,
                    retraction,
                };
                plan.update(key, spec, model, index);
            }
        }

        let (sin, cos) = object.rotation.sin_cos();
        let pose = |local: Vector| Pose {
            position: object.position
                + Vector::new(local.x * cos - local.y * sin, local.x * sin + local.y * cos),
            rotation: object.rotation,
        };

        let mut colliders: SmallVec<[ColliderGeometry<'_, ObjectCollider>; 32]> = SmallVec::new();
        let mut order: SmallVec<[(ColliderOrderKey, bool); 32]> = SmallVec::new();
        let mut add_collider = |key, covers, collider| {
            order.push((key, covers));
            colliders.push(collider);
        };
        for (index, hull) in self.hulls.iter().enumerate() {
            let plan = &hull.collider_plan;
            if !hull.present || hull.health < 1.0 || plan.radius == 0.0 || plan.radius.is_nan() {
                continue;
            }
            let physical = object.physics && !hull.plan.disable_physics && !open_hatches[index];
            let dock_segment = hull.plan.dock_segment;
            let hull_pose = pose(hull.position + plan.middle);
            let user_data = ObjectCollider {
                owner: object.id,
                part: ColliderPart::Hull(index),
                dock_segment,
                catches: false,
                material: collider_material(object.friction, HULL_BOUNCINESS, 0.0),
            };
            for (part, outline) in plan.outlines.iter().enumerate() {
                add_collider(
                    (
                        hull.plan.z_index.unwrap_or(HULL_Z_INDEX),
                        0,
                        index as u64,
                        part,
                    ),
                    false,
                    ColliderGeometry {
                        pose: hull_pose,
                        radius: plan.radius,
                        collision_margin: None,
                        outline: Some(outline),
                        collides: physical || dock_segment,
                        physical,
                        pickup_point: false,
                        catches: false,
                        user_data,
                    },
                );
            }
        }

        for (index, (mount, outlines)) in self.mounts.iter().zip(module_outlines.iter()).enumerate()
        {
            let Some(module) = &mount.module else {
                continue;
            };
            let hull = &self.hulls[mount.hull];
            if !hull.present || mount.health < 1.0 {
                continue;
            }
            let spec = &module.spec;
            let z_index = spec.z_index.unwrap_or(HULL_Z_INDEX);
            let retracts = (spec.behavior == "weapon" || spec.behavior == "beam")
                && self
                    .weapon_retraction_distance
                    .unwrap_or(spec.retraction_distance)
                    > 0.0;
            let hatch = spec.behavior == "cargoHatch";
            let drill = spec.behavior == "hornDrill";
            for (model_part, ((part, model), plan)) in module
                .parts
                .iter()
                .zip(&spec.model)
                .zip(outlines)
                .enumerate()
            {
                if retracts && part.activation_progress == 0.0 {
                    continue;
                }
                let physical = object.physics
                    && !spec.disable_physics
                    && !model.catches
                    && !(hatch && part.active == 0.0 && part.activation_progress == 0.0);
                let collides = physical
                    || model.catches
                        && part.active != 0.0
                        && part.activation_progress > self.hatch_opening_threshold;
                let bounciness = if drill {
                    if part.activation_progress > spec.activation_threshold {
                        -0.4
                    } else {
                        HULL_BOUNCINESS
                    }
                } else {
                    spec.bounciness.unwrap_or(HULL_BOUNCINESS)
                };
                let speed = if self.collision_tick.is_some()
                    && part.expanding_tick == self.collision_tick
                {
                    60.0
                } else {
                    0.0
                };
                if plan.radius != 0.0 && !plan.radius.is_nan() {
                    add_collider(
                        (z_index, 1, module.fitted_order, model_part * 2),
                        model.covers,
                        ColliderGeometry {
                            pose: pose(part.position + plan.middle),
                            radius: plan.radius,
                            collision_margin: spec.collision_margin,
                            outline: (!plan.outline.is_empty()).then_some(plan.outline.as_slice()),
                            collides,
                            physical,
                            pickup_point: false,
                            catches: model.catches,
                            user_data: ObjectCollider {
                                owner: object.id,
                                part: ColliderPart::Module {
                                    mount: index,
                                    model_part,
                                },
                                dock_segment: false,
                                catches: model.catches,
                                material: collider_material(
                                    spec.friction.unwrap_or(GAME_OBJECT_FRICTION),
                                    bounciness,
                                    speed,
                                ),
                            },
                        },
                    );
                }

                if spec.drill_tip.radius != 0.0 {
                    add_collider(
                        (z_index, 1, module.fitted_order, model_part * 2 + 1),
                        false,
                        ColliderGeometry {
                            pose: pose(part.position + spec.drill_tip.position),
                            radius: spec.drill_tip.radius,
                            collision_margin: None,
                            outline: None,
                            collides,
                            physical: false,
                            pickup_point: false,
                            catches: false,
                            user_data: ObjectCollider {
                                owner: object.id,
                                part: ColliderPart::DrillTip {
                                    mount: index,
                                    model_part,
                                },
                                dock_segment: false,
                                catches: false,
                                material: collider_material(object.friction, 0.0, 0.0),
                            },
                        },
                    );
                }
            }
        }

        if !order
            .iter()
            .map(|&(key, _)| key)
            .eq(order_keys.iter().copied())
        {
            order_keys.clear();
            order_keys.extend(order.iter().map(|&(key, _)| key));
            ordered_indices.clear();
            ordered_indices.extend(0..order.len());
            ordered_indices.sort_unstable_by_key(|&index| order_keys[index]);
        }
        if let Some(cover) = ordered_indices.iter().find_map(|&index| {
            let collider = &colliders[index];
            (order[index].1 && collider.radius >= object.radius).then_some(collider)
        }) {
            use_colliders(std::slice::from_ref(cover));
        } else if ordered_indices.iter().copied().eq(0..order.len()) {
            use_colliders(&colliders);
        } else {
            let ordered: SmallVec<[ColliderGeometry<'_, ObjectCollider>; 32]> = ordered_indices
                .iter()
                .map(|&index| colliders[index])
                .collect();
            use_colliders(&ordered);
        }
    }
}

fn hash_position(position: Vector, hash: &mut impl Hasher) {
    position.x.to_bits().hash(hash);
    position.y.to_bits().hash(hash);
}

fn collider_material(friction: f64, bounciness: f64, speed: f64) -> ColliderMaterial {
    ColliderMaterial {
        friction,
        bounciness,
        speed,
        gate_panel: None,
    }
}

impl Craft {
    pub fn damage_part(&mut self, part: ColliderPart, amount: f64) -> f64 {
        self.invalidate_collision_geometry();
        match part {
            ColliderPart::Hull(hull) => self.damage_hull(hull, amount),
            ColliderPart::Module { mount, model_part }
            | ColliderPart::DrillTip { mount, model_part } => {
                let Some(record) = self.mounts.get(mount) else {
                    return 0.0;
                };
                if record
                    .module
                    .as_ref()
                    .is_some_and(|module| module.spec.forward_thrust > 0.0)
                {
                    return self.damage_hull(record.hull, amount);
                }
                let mount = &mut self.mounts[mount];
                let Some(module) = &mut mount.module else {
                    return 0.0;
                };
                let Some(part) = module.parts.get_mut(model_part) else {
                    return 0.0;
                };
                let spec = &module.spec;
                let Some(model) = spec.model.get(model_part) else {
                    return 0.0;
                };
                if spec.health == 0.0 && part.active == 0.0 {
                    return 0.0;
                }
                let activated = spec.health_activated.is_some()
                    && part.active != 0.0
                    && (spec.recharge_duration == 0.0 || model.covers);
                if let Some(health) = mount.health_activated.as_mut().filter(|_| activated) {
                    let applied = damage_health(health, amount);
                    *health = health.max(0.0);
                    if spec.health == 0.0 {
                        mount.health = *health;
                    }
                    if spec.recharge_duration > 0.0 && *health == 0.0 {
                        part.active = 0.0;
                        part.activation_progress = 0.0;
                    }
                    applied
                } else {
                    damage_health(&mut mount.health, amount)
                }
            }
            _ => damage_health(&mut self.object.health, amount),
        }
    }

    fn damage_hull(&mut self, index: usize, amount: f64) -> f64 {
        let Some(hull) = self.hulls.get_mut(index) else {
            return 0.0;
        };
        let applied = damage_health(&mut hull.health, amount);
        for mount in self.mounts.iter_mut().filter(|mount| mount.hull == index) {
            if mount.health == 0.0 || mount.health.is_nan() {
                continue;
            }
            if hull.health < 1.0 {
                mount.health = 0.0;
            } else if mount.module.as_ref().is_some_and(|module| {
                module.spec.disable_physics && module.spec.forward_thrust == 0.0
            }) {
                mount.health -= amount;
            }
        }
        applied
    }

    fn is_shield_collider(&self, part: ColliderPart) -> bool {
        self.collider_model(part)
            .is_some_and(|(_, model)| model.covers)
    }

    fn collider_model(
        &self,
        part: ColliderPart,
    ) -> Option<(&super::craft::InstalledModule, &ModelPart)> {
        let (ColliderPart::Module { mount, model_part }
        | ColliderPart::DrillTip { mount, model_part }) = part
        else {
            return None;
        };
        let module = self.mounts.get(mount)?.module.as_ref()?;
        Some((module, module.spec.model.get(model_part)?))
    }

    fn crushing_target(&self, part: ColliderPart) -> i64 {
        // Count contacts by mount even when thruster damage is applied to the hull.
        match part {
            ColliderPart::Hull(index) => index as i64,
            ColliderPart::Module { mount, .. } | ColliderPart::DrillTip { mount, .. } => {
                -1 - mount as i64
            }
            _ => i64::MIN,
        }
    }

    fn hitbox_color<'a>(
        &'a self,
        part: ColliderPart,
        colors: &'a HashMap<String, Vec<String>>,
    ) -> &'a str {
        let shades = match part {
            ColliderPart::Hull(index) => self.hulls[index]
                .plan
                .shades
                .as_ref()
                .or(self.object.shades.as_ref()),
            _ => self
                .collider_model(part)
                .and_then(|(module, _)| module.shades.as_ref())
                .or(self.object.shades.as_ref()),
        };
        shades
            .and_then(|shades| shades.get(2))
            .filter(|shade| !shade.is_empty())
            .map_or(colors["white"][2].as_str(), String::as_str)
    }
}

fn damage_health(health: &mut f64, amount: f64) -> f64 {
    if *health > 0.0 {
        *health -= amount;
        amount
    } else {
        0.0
    }
}

macro_rules! craft_collision_entity {
    ($type:ty $(, $field:ident)?) => {
        impl CollisionEntity for $type {
            type Collider = ObjectCollider;

            fn object(&self) -> &GameObject {
                &self$(.$field)?.object
            }

            fn object_mut(&mut self) -> &mut GameObject {
                &mut self$(.$field)?.object
            }

            fn collision_geometry_source(&self) -> Option<u64> {
                self$(.$field)?.collision_source()
            }

            fn with_colliders(&self, use_colliders: impl FnOnce(&[ColliderGeometry<'_, ObjectCollider>])) {
                self$(.$field)?.with_hitboxes(use_colliders);
            }

            fn damage(&mut self, target: ObjectCollider, amount: f64, _by: i64, _events: &mut Vec<SimulationEvent>) -> f64 {
                self$(.$field)?.damage_part(target.part, amount)
            }

            fn shield_contact(&self, collider: ObjectCollider) -> bool {
                self$(.$field)?.is_shield_collider(collider.part)
            }

            fn crush_target(&self, collider: ObjectCollider) -> i64 {
                self$(.$field)?.crushing_target(collider.part)
            }

            fn outline_color<'a>(&'a self, collider: ObjectCollider, colors: &'a HashMap<String, Vec<String>>) -> &'a str {
                self$(.$field)?.hitbox_color(collider.part, colors)
            }
        }
    };
}

craft_collision_entity!(Craft);
craft_collision_entity!(Ship, craft);
craft_collision_entity!(Station, craft);

impl CollisionEntity for Item {
    type Collider = ObjectCollider;

    fn object(&self) -> &GameObject {
        &self.object
    }

    fn object_mut(&mut self) -> &mut GameObject {
        &mut self.object
    }

    fn with_colliders(&self, use_colliders: impl FnOnce(&[ColliderGeometry<'_, ObjectCollider>])) {
        let Some(hitboxes) = self.hitboxes() else {
            use_colliders(&[]);
            return;
        };
        let colliders = hitboxes.map(|item| {
            let hitbox = item.hitbox;
            ColliderGeometry {
                pose: Pose {
                    position: hitbox.position,
                    rotation: hitbox.rotation,
                },
                radius: hitbox.radius,
                collision_margin: item.collision_margin,
                outline: hitbox.outline,
                collides: true,
                physical: hitbox.physics,
                pickup_point: item.pickup_point,
                catches: false,
                user_data: ObjectCollider {
                    owner: hitbox.owner,
                    part: if item.pickup_point {
                        ColliderPart::PickupPoint
                    } else {
                        ColliderPart::Body
                    },
                    dock_segment: false,
                    catches: false,
                    material: collider_material(
                        hitbox.friction,
                        hitbox.bounciness.unwrap_or(0.0),
                        0.0,
                    ),
                },
            }
        });
        use_colliders(&colliders);
    }
}

impl CollisionEntity for Portal {
    type Collider = ObjectCollider;

    fn object(&self) -> &GameObject {
        &self.object
    }

    fn object_mut(&mut self) -> &mut GameObject {
        &mut self.object
    }

    fn collision_geometry_source(&self) -> Option<u64> {
        self.gate.as_ref().map(|_| self.geometry_source())
    }

    fn gate_motion(&self) -> Option<GateMotion> {
        let gate = self.gate.as_ref()?;
        Some(GateMotion {
            opening: self.opening,
            half_travel: gate.half_travel,
            crush_damage: gate.crush_damage,
        })
    }

    fn with_colliders(&self, use_colliders: impl FnOnce(&[ColliderGeometry<'_, ObjectCollider>])) {
        let owner = self.object.id;
        let colliders: SmallVec<[ColliderGeometry<'_, ObjectCollider>; 64]> = self
            .panel_hitboxes()
            .map(|panel| ColliderGeometry {
                pose: Pose {
                    position: panel.position,
                    rotation: panel.rotation,
                },
                radius: panel.radius,
                collision_margin: None,
                outline: Some(panel.outline),
                collides: true,
                physical: true,
                pickup_point: false,
                catches: false,
                user_data: ObjectCollider {
                    owner,
                    part: ColliderPart::GatePanel(panel.index),
                    dock_segment: false,
                    catches: false,
                    material: ColliderMaterial {
                        gate_panel: Some(GatePanelMotion {
                            local_x: panel.local_position.x,
                        }),
                        ..collider_material(panel.friction, 0.0, 0.0)
                    },
                },
            })
            .collect();
        use_colliders(&colliders);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use crate::simulation::game_object::ObjectProperties;
    use crate::specs::Catalog;

    use super::*;

    #[test]
    fn gate_crush_counts_the_thruster_mount_and_its_hull_separately() {
        let catalog = Catalog::load().unwrap();
        let mut next = 0;
        let mut ship =
            Ship::new_player(1, "mustang", ObjectProperties::default(), &catalog, || {
                next -= 1;
                next
            })
            .expect("stock ship");
        let mount = ship
            .craft
            .mounts
            .iter()
            .position(|mount| {
                mount
                    .module
                    .as_ref()
                    .is_some_and(|module| module.spec.forward_thrust > 0.0)
            })
            .expect("stock thruster");
        let hull = ship.craft.mounts[mount].hull;
        let initial_hull_health = ship.craft.hulls[hull].health;
        let initial_mount_health = ship.craft.mounts[mount].health;
        let mut damaged = HashSet::new();
        for part in [
            ColliderPart::Hull(hull),
            ColliderPart::Module {
                mount,
                model_part: 0,
            },
            ColliderPart::Module {
                mount,
                model_part: 1,
            },
        ] {
            if damaged.insert(ship.craft.crushing_target(part)) {
                ship.craft.damage_part(part, 1.0);
            }
        }

        assert_eq!(ship.craft.hulls[hull].health, initial_hull_health - 2.0);
        assert_eq!(ship.craft.mounts[mount].health, initial_mount_health);
    }

    #[test]
    fn throttle_changes_reuse_collision_geometry_and_hatch_changes_invalidate_it() {
        let catalog = Catalog::load().unwrap();
        let mut next = 0;
        let mut ship =
            Ship::new_player(1, "mustang", ObjectProperties::default(), &catalog, || {
                next -= 1;
                next
            })
            .expect("stock ship");
        let source = ship.craft.collision_source().expect("undocked craft");
        let thruster = ship
            .craft
            .mounts
            .iter_mut()
            .filter_map(|mount| mount.module.as_mut())
            .find(|module| module.spec.forward_thrust != 0.0)
            .expect("stock thruster");
        thruster.parts[0].active = 0.25;
        thruster.parts[0].activation_progress = 0.75;
        assert_eq!(ship.craft.collision_source(), Some(source));

        let hatch = ship
            .craft
            .mounts
            .iter_mut()
            .filter_map(|mount| mount.module.as_mut())
            .find(|module| module.spec.behavior == "cargoHatch")
            .expect("stock hatch");
        hatch.parts[0].activation_progress = 1.0;
        assert_ne!(ship.craft.collision_source(), Some(source));
    }

    #[test]
    fn tracked_collision_source_expires_shield_expansion() {
        let catalog = Catalog::load().unwrap();
        let mut next = 0;
        let mut ship =
            Ship::new_player(1, "mustang", ObjectProperties::default(), &catalog, || {
                next -= 1;
                next
            })
            .expect("stock ship");
        let index = ship
            .craft
            .mounts
            .iter()
            .position(|mount| mount.accepts("shieldGeneratorSm"))
            .expect("shield mount");
        ship.fit(
            index,
            Some(super::super::craft::InstalledModule::new(
                -100,
                "shieldGeneratorSm".into(),
                catalog.module_specs["shieldGeneratorSm"].clone(),
            )),
        );
        ship.craft.set_module_active("shieldGenerator", true);
        ship.craft.update_modules(4.0, 1.0, Some(25));
        let expanding = ship.craft.tracked_collision_source();
        let exact_expanding = ship.craft.collision_source();
        ship.craft.update_modules(4.0, 1.0, Some(26));
        assert_ne!(ship.craft.tracked_collision_source(), expanding);
        assert_ne!(ship.craft.collision_source(), exact_expanding);
        let settled = ship.craft.tracked_collision_source();
        let exact_settled = ship.craft.collision_source();
        ship.craft.update_modules(4.0, 1.0, Some(27));
        assert_eq!(ship.craft.tracked_collision_source(), settled);
        assert_eq!(ship.craft.collision_source(), exact_settled);
    }

    #[test]
    fn open_hatches_and_drills_keep_separate_nonphysical_contact_shapes()
    -> Result<(), crate::specs::CatalogError> {
        let catalog = Catalog::load()?;
        let mut next = 0;
        let mut ship =
            Ship::new_player(1, "mustang", ObjectProperties::default(), &catalog, || {
                next -= 1;
                next
            })
            .expect("stock ship");

        ship.craft.set_module_active("cargoHatch", true);
        ship.craft.set_module_active("hornDrill", true);
        ship.craft.update_modules(4.0, 1.0, Some(30));
        ship.with_colliders(|colliders| {
            let drill = colliders
                .iter()
                .find(|collider| matches!(collider.user_data.part, ColliderPart::DrillTip { .. }))
                .expect("drill tip");
            assert!(drill.collides);
            assert!(!drill.physical);
            assert_eq!(
                drill.radius,
                catalog.module_specs["hornDrill"].drill_tip.radius
            );
            assert_eq!(
                colliders
                    .iter()
                    .filter(|collider| collider.catches && collider.collides && !collider.physical)
                    .count(),
                2
            );
            assert!(
                colliders
                    .iter()
                    .filter(|collider| matches!(collider.user_data.part, ColliderPart::Hull(_)))
                    .any(|collider| !collider.collides)
            );
        });

        ship.craft.docked_to = Some(50);
        ship.with_colliders(|colliders| assert!(colliders.is_empty()));
        Ok(())
    }
}
