//! Splash damage and impulse from a projectile or another game object.

use smallvec::SmallVec;

use crate::collision::{Shape, query::contact_shapes};
use crate::gameplay::collision_world::{ColliderPart, CollisionEntity, ObjectCollider};
use crate::physics::apply_force;
use crate::protocol::SimulationEvent;
use crate::specs::ProjectileExplosion;
use crate::utilities::seeded_random::SeededRandom;
use crate::utilities::vector::Vector;
use crate::utilities::vector_math::TransformValue;

use super::projectile::{FractureTarget, WeaponContext, WeaponWorld};

#[derive(Clone, Copy, Debug)]
pub struct ExplosionSource {
    pub id: i64,
    pub player_id: Option<i64>,
    pub position: Vector,
    pub velocity: Vector,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum DamageTarget {
    Body,
    Hull(usize),
    Mount(usize),
    AsteroidSegment(usize),
}

fn damage_target(collider: ObjectCollider) -> DamageTarget {
    match collider.part {
        ColliderPart::Hull(index) => DamageTarget::Hull(index),
        ColliderPart::Module { mount, .. } | ColliderPart::DrillTip { mount, .. } => {
            DamageTarget::Mount(mount)
        }
        ColliderPart::AsteroidSegment(index) => DamageTarget::AsteroidSegment(index),
        _ => DamageTarget::Body,
    }
}

pub fn explode<W: WeaponWorld>(
    source: ExplosionSource,
    spec: &ProjectileExplosion,
    exclude: Option<ObjectCollider>,
    context: &mut WeaponContext<'_, W>,
) {
    if spec.damage > 0.0 {
        damage_nearby(source, spec, exclude, context);
    }

    // Fracturing during damage can add new bodies. They receive the force only.
    context.world.for_each_weapon_target_mut(|entity| {
        let object = entity.object_mut();
        if object.id == source.id || object.dead || object.buried {
            return;
        }

        let mut offset = object.position - source.position;
        let distance = offset.length();
        let falloff = 1.0 - (distance - object.radius).max(0.0) / spec.radius;
        if falloff <= 0.0 {
            return;
        }
        if distance == 0.0 {
            offset = source.velocity;
        }

        let mass = object.force_mass();
        let impulse = if spec.max_speed > 0.0 {
            spec.impulse.min(spec.max_speed * mass)
        } else {
            spec.impulse
        };
        let force = offset.normalized() * (impulse * falloff);
        let mut random = SeededRandom::new(source.id as f64 + object.id as f64 * 48271.0);
        let spin = (random.next_float() * 2.0 - 1.0)
            * (spec.impulse / object.radius.max(1.0)).min(6.0)
            * falloff;
        apply_force(&mut object.velocity, &mut object.spin, mass, force, spin);
    });
}

fn damage_nearby<W: WeaponWorld>(
    source: ExplosionSource,
    spec: &ProjectileExplosion,
    exclude: Option<ObjectCollider>,
    context: &mut WeaponContext<'_, W>,
) {
    let potential = context
        .world
        .weapon_targets()
        .filter_map(|entity| {
            let object = entity.object();
            (object.id != source.id
                && !object.dead
                && !object.buried
                && object.position.distance(source.position) <= spec.radius + object.radius)
                .then_some(object.id)
        })
        .collect::<SmallVec<[i64; 32]>>();

    let linear_slop = context.catalog.simulation.linear_slop;
    let explosion = Shape::circle(Vector::ZERO, spec.radius);
    let explosion_pose = TransformValue::new(source.position, 0.0);
    let by = source.player_id.unwrap_or(0);
    for id in potential {
        let Some(entity) = context.world.weapon_target(id) else {
            continue;
        };
        let object = entity.object();
        if object.dead
            || object.buried
            || object.position.distance(source.position) > spec.radius + object.radius
        {
            continue;
        }
        let is_asteroid = object.kind == "asteroid";
        let incarnation = entity.collision_incarnation();
        let mut contacts = SmallVec::<[(ObjectCollider, Vector); 16]>::new();
        entity.with_colliders(|colliders| {
            for (index, &collider) in colliders.iter().enumerate() {
                if !collider.physical || collider.pickup_point {
                    continue;
                }
                let shape = context
                    .geometry
                    .shape(collider, incarnation, index, linear_slop);
                if let Some(contact) = contact_shapes(
                    &explosion,
                    shape,
                    explosion_pose,
                    TransformValue::new(collider.pose.position, collider.pose.rotation),
                    linear_slop,
                ) {
                    contacts.push((collider.user_data, contact.point));
                }
            }
        });

        let mut damaged = SmallVec::<[DamageTarget; 16]>::new();
        if let Some(exclude) = exclude.filter(|exclude| exclude.owner == id) {
            damaged.push(damage_target(exclude));
        }
        for (collider, position) in contacts {
            let target = damage_target(collider);
            if damaged.contains(&target) {
                continue;
            }

            let Some(entity) = context.world.weapon_target(id) else {
                break;
            };
            let color = entity
                .outline_color(collider, &context.catalog.colors)
                .to_owned();
            let applied =
                context
                    .world
                    .damage_weapon_target(collider, spec.damage, by, context.events);
            if applied == 0.0 {
                continue;
            }

            damaged.push(target);
            context.events.push(SimulationEvent::CollisionEvent {
                a: source.id,
                b: id,
                by,
                shield: [false; 2],
                impact: 0.0,
                colors: [String::new(), color],
                damage: [0.0, applied],
                position,
            });
        }
        if is_asteroid {
            context.world.fracture_asteroid(
                id,
                FractureTarget::FirstDamaged,
                by,
                context.catalog,
                context.events,
            );
        }
    }
}
