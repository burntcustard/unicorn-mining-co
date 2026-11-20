//! Traveling projectiles and beam traces share the continuous collision solver.

use std::collections::HashMap;
use std::sync::OnceLock;

use smallvec::SmallVec;

use crate::collision::{BaseShape, CircleShape, Shape, Sweep, ToiInput, find_time_of_impact};
use crate::gameplay::collision_world::{ColliderPart, CollisionEntity, ObjectCollider};
use crate::gameplay::game_collisions::ColliderGeometry;
use crate::protocol::SimulationEvent;
use crate::simulation::game_object::{GameObject, MovementOutcome, ObjectProperties};
use crate::simulation::geometry::rotate_point;
use crate::specs::{self, Catalog, Point};
use crate::vector::Vector;

use super::explosion::{ExplosionSource, explode};
use super::ship::Ship;

#[derive(Clone, Copy, Debug)]
pub enum FractureTarget {
    Direct(Option<usize>),
    FirstDamaged,
}

pub trait WeaponWorld {
    type Entity: CollisionEntity<Collider = ObjectCollider>;

    fn weapon_targets(&self) -> impl Iterator<Item = &Self::Entity>;
    fn weapon_target(&self, id: i64) -> Option<&Self::Entity>;
    fn weapon_target_mut(&mut self, id: i64) -> Option<&mut Self::Entity>;
    fn for_each_weapon_target_mut(&mut self, visit: impl FnMut(&mut Self::Entity));

    fn damage_weapon_target(
        &mut self,
        target: ObjectCollider,
        amount: f64,
        by: i64,
        events: &mut Vec<SimulationEvent>,
    ) -> f64 {
        self.weapon_target_mut(target.owner)
            .map_or(0.0, |entity| entity.damage(target, amount, by, events))
    }

    /// Fracture after the impact events have been emitted. Implementations can add
    /// the resulting asteroid fragments and released items to the world.
    fn fracture_asteroid(
        &mut self,
        entity: i64,
        target: FractureTarget,
        by: i64,
        catalog: &Catalog,
        events: &mut Vec<SimulationEvent>,
    );
}

pub struct WeaponContext<'a, W> {
    pub world: &'a mut W,
    pub geometry: &'a mut WeaponGeometry,
    pub catalog: &'a Catalog,
    pub events: &'a mut Vec<SimulationEvent>,
}

#[derive(Default)]
pub struct WeaponGeometry {
    entities: HashMap<i64, CachedWeaponEntity>,
}

#[derive(Default)]
struct CachedWeaponEntity {
    incarnation: u64,
    colliders: Vec<Option<CachedShape>>,
}

struct CachedShape {
    shape: Shape,
    radius: f64,
    margin: Option<f64>,
    linear_slop: f64,
    outline: Vec<Point>,
}

impl WeaponGeometry {
    pub fn remove(&mut self, owner: i64) {
        self.entities.remove(&owner);
    }

    pub(crate) fn retain_awake(&mut self, mut incarnation: impl FnMut(i64) -> Option<u64>) {
        self.entities
            .retain(|&id, cached| incarnation(id) == Some(cached.incarnation));
        if self.entities.is_empty() {
            self.entities.shrink_to_fit();
        }
    }

    pub(crate) fn shape(
        &mut self,
        collider: ColliderGeometry<'_, ObjectCollider>,
        incarnation: u64,
        index: usize,
        linear_slop: f64,
    ) -> &Shape {
        let entity = self.entities.entry(collider.user_data.owner).or_default();
        if entity.incarnation != incarnation {
            *entity = CachedWeaponEntity {
                incarnation,
                colliders: Vec::new(),
            };
        }
        let colliders = &mut entity.colliders;
        if colliders.len() <= index {
            colliders.resize_with(index + 1, || None);
        }

        let outline = collider.outline.unwrap_or_default();
        let cached = &mut colliders[index];
        if cached.as_ref().is_some_and(|cached| {
            cached.radius == collider.radius
                && cached.margin == collider.collision_margin
                && cached.outline == outline
                && cached.linear_slop == linear_slop
        }) {
            return &cached.as_ref().unwrap().shape;
        }

        let shape = if outline.is_empty() {
            Shape::circle(Vector::ZERO, collider.radius)
        } else {
            let vertices = outline
                .iter()
                .map(|&[x, y]| Vector::new(x, y))
                .collect::<SmallVec<[Vector; 16]>>();
            Shape::polygon(&vertices, collider.collision_margin, linear_slop)
        };
        &cached
            .insert(CachedShape {
                shape,
                radius: collider.radius,
                margin: collider.collision_margin,
                linear_slop,
                outline: outline.to_vec(),
            })
            .shape
    }
}

#[derive(Clone, Copy, Debug)]
pub struct WeaponImpact {
    pub collider: ObjectCollider,
    pub fraction: f64,
    pub physical: bool,
}

#[derive(Clone, Copy)]
struct Trace<'a> {
    entity: i64,
    player: Option<i64>,
    shape: &'a BaseShape,
    start: Vector,
    end: Vector,
    target_motion_dt: Option<f64>,
}

/// Bounds tested by every projectile during the same post-movement phase.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct ProjectileTarget {
    pub id: i64,
    player: Option<i64>,
    position: Vector,
    radius: f64,
    motion: f64,
}

impl ProjectileTarget {
    pub fn new(object: &GameObject, dt: Option<f64>) -> Option<Self> {
        if object.dead || object.buried || object.kind == "projectile" {
            return None;
        }
        Some(Self {
            id: object.id,
            player: object.player_id,
            position: object.position,
            radius: object.radius,
            motion: dt.map_or(0.0, |dt| object.velocity.length() * dt),
        })
    }

    fn reachable(self, shot: &Trace<'_>, travel: f64) -> bool {
        if shot.entity == self.id || shot.player.is_some() && shot.player == self.player {
            return false;
        }

        let reach = self.radius + shot.shape.radius + travel + self.motion;
        self.position
            .distance_squared(shot.end)
            .partial_cmp(&(reach * reach))
            != Some(std::cmp::Ordering::Greater)
    }
}

#[derive(Default)]
pub(crate) struct ProjectileTargets {
    ordered: Vec<ProjectileTarget>,
    by_x: Vec<(f64, usize)>,
    near: Vec<usize>,
    max_radius: f64,
    max_motion: f64,
}

impl ProjectileTargets {
    pub fn rebuild<'a>(
        &mut self,
        objects: impl Iterator<Item = &'a GameObject>,
        dt: f64,
        traces: usize,
    ) {
        self.ordered.clear();
        self.ordered
            .extend(objects.filter_map(|object| ProjectileTarget::new(object, Some(dt))));
        self.by_x.clear();
        self.max_radius = 0.0;
        self.max_motion = 0.0;
        if traces < 16 || self.ordered.len() < 96 {
            return;
        }
        for (index, target) in self.ordered.iter().enumerate() {
            if !target.position.x.is_finite()
                || !target.position.y.is_finite()
                || !target.radius.is_finite()
                || !target.motion.is_finite()
                || target.radius < 0.0
                || target.motion < 0.0
            {
                self.by_x.clear();
                return;
            }
            self.max_radius = self.max_radius.max(target.radius);
            self.max_motion = self.max_motion.max(target.motion);
            self.by_x.push((target.position.x, index));
        }
        self.by_x.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
    }

    fn nearby(&mut self, shot: &Trace<'_>, travel: f64) -> impl Iterator<Item = i64> + '_ {
        self.near.clear();
        let extent = self.max_radius + shot.shape.radius + travel + self.max_motion;
        if self.by_x.is_empty()
            || !shot.end.x.is_finite()
            || !shot.end.y.is_finite()
            || !extent.is_finite()
            || !(extent * extent).is_finite()
            || shot.shape.radius < 0.0
        {
            self.near.extend(
                self.ordered
                    .iter()
                    .enumerate()
                    .filter_map(|(index, target)| target.reachable(shot, travel).then_some(index)),
            );
        } else {
            // Leave room for rounding at both ends of the coordinate range.
            let lower = (shot.end.x - extent - 1.0).next_down();
            let upper = (shot.end.x + extent + 1.0).next_up();
            let start = self.by_x.partition_point(|&(x, _)| x < lower);
            let end = self.by_x.partition_point(|&(x, _)| x <= upper);
            self.near
                .extend(self.by_x[start..end].iter().filter_map(|&(_, index)| {
                    self.ordered[index].reachable(shot, travel).then_some(index)
                }));
            // Equal hit fractions select the first entity in world insertion order.
            self.near.sort_unstable();
        }
        self.near.iter().map(|&index| self.ordered[index].id)
    }
}

fn trace_impact<'a, E: CollisionEntity<Collider = ObjectCollider> + 'a>(
    shot: Trace<'_>,
    targets: impl Iterator<Item = &'a E>,
    geometry: &mut WeaponGeometry,
    linear_slop: f64,
) -> Option<WeaponImpact> {
    let mut sweep_a = Sweep::default();
    sweep_a.c0 = shot.start;
    sweep_a.c = shot.end;
    let mut fraction = 1.0;
    let mut first = None;

    for entity in targets {
        let object = entity.object();
        let incarnation = entity.collision_incarnation();
        entity.visit_colliders(|index, collider| {
            let station_interior = object.kind == "station"
                && matches!(collider.user_data.part, ColliderPart::Hull(_));
            if (!collider.physical && !station_interior) || collider.pickup_point {
                return;
            }

            let proxy = geometry
                .shape(collider, incarnation, index, linear_slop)
                .base();
            let mut sweep_b = Sweep::default();
            sweep_b.c = collider.pose.position;
            sweep_b.c0 = shot.target_motion_dt.map_or(collider.pose.position, |dt| {
                collider.pose.position.add_scaled(object.velocity, -dt)
            });
            sweep_b.a = collider.pose.rotation;
            sweep_b.a0 = shot.target_motion_dt.map_or(collider.pose.rotation, |dt| {
                collider.pose.rotation - object.spin * dt
            });
            let result = find_time_of_impact(
                ToiInput {
                    proxy_a: shot.shape,
                    proxy_b: proxy,
                    sweep_a: &mut sweep_a,
                    sweep_b: &mut sweep_b,
                    t_max: fraction,
                },
                linear_slop,
            );

            if (result.touching || result.t == 0.0) && (first.is_none() || result.t < fraction) {
                first = Some(WeaponImpact {
                    collider: collider.user_data,
                    fraction: result.t,
                    physical: collider.physical,
                });
                fraction = result.t;
            }
        });
    }

    first
}

fn trace_world<W: WeaponWorld>(
    shot: Trace<'_>,
    world: &W,
    candidates: Option<&mut ProjectileTargets>,
    geometry: &mut WeaponGeometry,
    linear_slop: f64,
) -> Option<WeaponImpact> {
    let travel = shot.start.distance(shot.end);
    if let Some(candidates) = candidates {
        let targets = candidates
            .nearby(&shot, travel)
            .filter_map(|id| world.weapon_target(id));
        trace_impact(shot, targets, geometry, linear_slop)
    } else {
        let targets = world.weapon_targets().filter(|entity| {
            ProjectileTarget::new(entity.object(), shot.target_motion_dt)
                .is_some_and(|candidate| candidate.reachable(&shot, travel))
        });
        trace_impact(shot, targets, geometry, linear_slop)
    }
}

fn asteroid_segment(collider: ObjectCollider) -> Option<usize> {
    match collider.part {
        ColliderPart::AsteroidSegment(index) => Some(index),
        _ => None,
    }
}

#[derive(Debug)]
pub struct Projectile {
    pub object: GameObject,
    pub spec: specs::Projectile,
    pub damage: f64,
    pub sweep_start: Vector,
    proxy: CircleShape,
    expired: bool,
    expiry_exploded: bool,
}

impl Projectile {
    pub fn new(
        id: i64,
        definition: &str,
        properties: ObjectProperties,
        catalog: &Catalog,
    ) -> Option<Self> {
        let module = catalog.module_specs.get(definition)?;
        let health = properties.health.unwrap_or(module.damage);
        let mut object = GameObject::new(id, properties, &catalog.simulation);
        object.kind = "projectile".to_owned();
        object.definition_id = definition.to_owned();
        object.physics = false;
        object.radius = module.projectile.radius;
        object.health = health;
        let sweep_start = object.position;
        Some(Self {
            object,
            spec: module.projectile.clone(),
            damage: module.damage,
            sweep_start,
            proxy: CircleShape::new(Vector::ZERO, module.projectile.radius),
            expired: false,
            expiry_exploded: false,
        })
    }

    pub fn capture_sweep(&mut self) {
        self.sweep_start = self.object.position;
    }

    pub fn update(&mut self, dt: f64) -> MovementOutcome {
        if self.object.dead {
            return MovementOutcome::Skipped;
        }
        self.object.health -= (self.damage / self.spec.lifetime) * dt;
        if self.object.health <= 0.0 {
            self.object.dead = true;
            self.expired = true;
            return MovementOutcome::Died;
        }

        self.object.position = self.object.position.add_scaled(self.object.velocity, dt);
        self.object.round_motion();
        MovementOutcome::Moved
    }

    pub fn on_death<W: WeaponWorld>(&mut self, context: &mut WeaponContext<'_, W>) {
        if !self.expired || self.expiry_exploded || self.spec.fade_out > 0.0 {
            return;
        }
        self.expiry_exploded = true;
        self.explode(context, None);
    }

    pub fn death_event(&self) -> Option<SimulationEvent> {
        (self.expired && self.spec.fade_out <= 0.0).then(|| SimulationEvent::ObjectDestroyed {
            object_id: self.object.id,
            color: self.spec.color.clone(),
            damage: self.damage,
            position: self.object.position,
        })
    }

    pub fn resolve_hits<W: WeaponWorld>(
        &mut self,
        dt: f64,
        context: &mut WeaponContext<'_, W>,
    ) -> Option<WeaponImpact> {
        let impact = self.trace_impact(
            dt,
            context.world,
            None,
            context.geometry,
            context.catalog.simulation.linear_slop,
        )?;
        self.apply_impact(impact, context)
    }

    pub(crate) fn trace_impact<W: WeaponWorld>(
        &self,
        dt: f64,
        world: &W,
        candidates: Option<&mut ProjectileTargets>,
        geometry: &mut WeaponGeometry,
        linear_slop: f64,
    ) -> Option<WeaponImpact> {
        if self.object.dead {
            return None;
        }
        let replacement;
        let proxy = if self.proxy.base.radius == self.object.radius {
            &self.proxy
        } else {
            replacement = CircleShape::new(Vector::ZERO, self.object.radius);
            &replacement
        };
        trace_world(
            Trace {
                entity: self.object.id,
                player: self.object.player_id,
                shape: &proxy.base,
                start: self.sweep_start,
                end: self.object.position,
                target_motion_dt: Some(dt),
            },
            world,
            candidates,
            geometry,
            linear_slop,
        )
    }

    pub(crate) fn apply_impact<W: WeaponWorld>(
        &mut self,
        impact: WeaponImpact,
        context: &mut WeaponContext<'_, W>,
    ) -> Option<WeaponImpact> {
        if !impact.physical {
            self.object.dead = true;
            return Some(impact);
        }

        let by = self.object.player_id.unwrap_or(0);
        let target = context.world.weapon_target(impact.collider.owner)?;
        let velocity = target.object().velocity;
        let is_asteroid = target.object().kind == "asteroid";
        let color = target
            .outline_color(impact.collider, &context.catalog.colors)
            .to_owned();
        let applied =
            context
                .world
                .damage_weapon_target(impact.collider, self.damage, by, context.events);
        let mut self_applied = 0.0;
        if self.object.health > 0.0 {
            self_applied = self.damage;
            self.object.health -= self.damage;
        }
        self.object.position = self
            .sweep_start
            .add_scaled(self.object.position - self.sweep_start, impact.fraction);

        context.events.push(SimulationEvent::CollisionEvent {
            a: self.object.id,
            b: impact.collider.owner,
            by: if applied > 0.0 { by } else { 0 },
            shield: [false; 2],
            impact: self.object.velocity.distance(velocity),
            colors: [self.spec.color.clone(), color],
            damage: [self_applied, applied],
            position: self.object.position,
        });

        if self.object.health <= 0.0 {
            self.object.dead = true;
            self.explode(context, Some(impact.collider));
        }
        if is_asteroid {
            context.world.fracture_asteroid(
                impact.collider.owner,
                FractureTarget::Direct(asteroid_segment(impact.collider)),
                by,
                context.catalog,
                context.events,
            );
        }
        Some(impact)
    }

    fn explode<W: WeaponWorld>(
        &self,
        context: &mut WeaponContext<'_, W>,
        exclude: Option<ObjectCollider>,
    ) {
        if let Some(spec) = &self.spec.explosion {
            explode(
                ExplosionSource {
                    id: self.object.id,
                    player_id: self.object.player_id,
                    position: self.object.position,
                    velocity: self.object.velocity,
                },
                spec,
                exclude,
                context,
            );
        }
    }
}

impl CollisionEntity for Projectile {
    type Collider = ObjectCollider;

    fn object(&self) -> &GameObject {
        &self.object
    }

    fn object_mut(&mut self) -> &mut GameObject {
        &mut self.object
    }

    fn with_colliders(&self, use_colliders: impl FnOnce(&[ColliderGeometry<'_, ObjectCollider>])) {
        use_colliders(&[]);
    }
}

#[derive(Clone, Copy, Debug)]
pub struct LaserBeam {
    pub source: i64,
    pub player_id: i64,
    pub start: Vector,
    pub end: Vector,
    pub damage: f64,
}

impl Ship {
    /// Inspect fully deployed mounted beams in mount order before tracing world targets.
    pub fn laser_beams(&self) -> impl Iterator<Item = LaserBeam> + '_ {
        let craft = &self.craft;
        let source = &craft.object;
        let player_id = source
            .player_id
            .filter(|_| self.firing && !source.dead && !craft.docked() && craft.launching == 0.0);
        player_id.into_iter().flat_map(move |player_id| {
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
                    player_id,
                    start,
                    end,
                    damage: module.spec.damage,
                })
            })
        })
    }
}

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
            player: Some(beam.player_id),
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
        beam.player_id,
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
        by: beam.player_id,
        damage: applied,
        color,
        position,
    });
    if is_asteroid {
        context.world.fracture_asteroid(
            impact.collider.owner,
            FractureTarget::Direct(asteroid_segment(impact.collider)),
            beam.player_id,
            context.catalog,
            context.events,
        );
    }
    trace
}

#[cfg(test)]
#[path = "projectile_tests.rs"]
mod tests;
