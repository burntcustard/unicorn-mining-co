use std::sync::{Arc, OnceLock};

use smallvec::SmallVec;

use crate::gameplay::collision_world::{ColliderPart, ObjectCollider};
use crate::gameplay::game_collisions::{ColliderGeometry, ColliderMaterial, Pose};
use crate::protocol::AsteroidDescription;
use crate::specs::{Catalog, Point};
use crate::utilities::seeded_random::SeededRandom;
use crate::utilities::vector::Vector;

use super::asteroid_fracture::{
    AsteroidFragment, AsteroidMotion, FractureEffect, FractureInput, fracture,
    fragment_collision_outline,
};
use super::asteroid_geometry::{
    AsteroidOutlineOptions, AsteroidOutlines, AsteroidSegment, AsteroidSegmentOptions,
    subdivide_outline,
};
use super::game_object::{GameObject, ObjectProperties};
use super::polygon::ShapeOutline;

#[derive(Default)]
pub struct AsteroidProperties {
    pub object: ObjectProperties,
    pub contents: Vec<i32>,
    pub max_health: Option<f64>,
    pub point_count: usize,
    pub radius_even: Option<f64>,
    pub segments: Option<Vec<AsteroidSegment>>,
}

struct Uncut {
    contents: Vec<i32>,
    health: f64,
    mass: f64,
    extent: f64,
}

pub struct Asteroid {
    pub object: GameObject,
    pub contents: Vec<i32>,
    pub max_health: f64,
    outline: Option<Arc<ShapeOutline>>,
    segments: OnceLock<Vec<AsteroidSegment>>,
    uncut: Option<Uncut>,
    locked: bool,
    revision: u64,
    segment_state_revision: u64,
    collision_outline: OnceLock<Vec<Point>>,
}

impl Asteroid {
    pub fn new(
        id: i64,
        mut properties: AsteroidProperties,
        catalog: &Catalog,
        outlines: &mut AsteroidOutlines,
    ) -> Self {
        let radius = *properties.object.radius.get_or_insert(25.0);
        let max_health = properties
            .max_health
            .or(properties.object.health)
            .unwrap_or(radius * 2.0);
        properties.object.health.get_or_insert(max_health);
        properties
            .object
            .mass
            .get_or_insert(0.4 * (radius * radius));
        properties.object.friction.get_or_insert(0.2);
        properties.object.angular_drag.get_or_insert(0.0);
        properties
            .object
            .name
            .get_or_insert_with(|| "Asteroid".to_owned());
        let mut object = GameObject::new(id, properties.object, &catalog.simulation);
        object.kind = "asteroid".to_owned();
        object.point_count = properties.point_count;
        object.radius_even = properties.radius_even;
        if let Some(outline) = &mut object.shape_outline {
            outline.edges = None;
        }
        let outline = object.shape_outline.is_none().then(|| {
            outlines.get(
                AsteroidOutlineOptions {
                    id,
                    point_count: object.point_count,
                    radius: object.radius,
                    radius_even: object.radius_even,
                },
                &catalog.region_generation,
            )
        });
        let uncut = outline
            .as_ref()
            .filter(|_| properties.segments.is_none())
            .map(|outline| Uncut {
                contents: properties.contents.clone(),
                health: object.health,
                mass: object.mass,
                extent: outline
                    .points
                    .iter()
                    .map(|&[x, y]| Vector::new(x, y).length())
                    .fold(0.0, f64::max),
            });
        let segments = properties
            .segments
            .map_or_else(OnceLock::new, |mut segments| {
                for segment in &mut segments {
                    segment.outline.edges = None;
                }
                OnceLock::from(segments)
            });
        Self {
            object,
            contents: properties.contents,
            max_health,
            outline,
            segments,
            uncut,
            locked: false,
            revision: 0,
            segment_state_revision: 0,
            collision_outline: OnceLock::new(),
        }
    }

    pub fn from_generated(
        id: i64,
        asteroid: &AsteroidDescription,
        catalog: &Catalog,
        outlines: &mut AsteroidOutlines,
    ) -> Self {
        let mut object = Self::new(
            id,
            AsteroidProperties {
                object: ObjectProperties {
                    radius: Some(asteroid.radius),
                    position: asteroid.position,
                    rotation: asteroid.rotation,
                    spin: asteroid.spin,
                    resource: Some(asteroid.resource),
                    ..ObjectProperties::default()
                },
                contents: asteroid.contents.clone(),
                point_count: asteroid.point_count as usize,
                radius_even: (asteroid.radius_even != 0.0).then_some(asteroid.radius_even),
                ..AsteroidProperties::default()
            },
            catalog,
            outlines,
        );
        object.lock_geometry();
        object
    }

    pub fn from_fragment(
        id: i64,
        fragment: AsteroidFragment,
        catalog: &Catalog,
        outlines: &mut AsteroidOutlines,
    ) -> Self {
        let motion = fragment.motion;
        let mut object = Self::new(
            id,
            AsteroidProperties {
                object: ObjectProperties {
                    radius: Some(fragment.radius),
                    mass: Some(fragment.mass),
                    health: Some(fragment.health),
                    decay: Some(fragment.decay),
                    position: motion.position,
                    rotation: motion.rotation,
                    velocity: motion.velocity,
                    spin: motion.spin,
                    resource: fragment.resource,
                    shape_outline: Some(fragment.outline),
                    ..ObjectProperties::default()
                },
                contents: fragment.contents,
                segments: fragment.segments,
                ..AsteroidProperties::default()
            },
            catalog,
            outlines,
        );
        object.lock_geometry();
        object
    }

    pub fn outline(&self) -> &ShapeOutline {
        // INFALLIBLE: constructors keep an authored or procedural outline.
        self.object
            .shape_outline
            .as_ref()
            .or(self.outline.as_deref())
            .expect("asteroid outline")
    }

    pub fn segments(&self) -> Option<&[AsteroidSegment]> {
        if let Some(uncut) = &self.uncut {
            return Some(self.segments.get_or_init(|| {
                let mut random = SeededRandom::new(self.object.id.wrapping_add(1) as f64);
                let mut segments = subdivide_outline(
                    self.outline(),
                    AsteroidSegmentOptions {
                        contents: &uncut.contents,
                        health: uncut.health,
                        mass: uncut.mass,
                        radius_even: self.object.radius_even,
                    },
                    || random.next_float(),
                );
                if self.locked {
                    for segment in &mut segments {
                        lock_outline(&mut segment.outline);
                    }
                }
                segments
            }));
        }
        self.segments.get().map(Vec::as_slice)
    }

    pub fn lock_geometry(&mut self) {
        if let Some(outline) = &mut self.object.shape_outline {
            lock_outline(outline);
        }
        if let Some(segments) = self.segments.get_mut() {
            for segment in segments {
                lock_outline(&mut segment.outline);
            }
        }
        self.locked = true;
        self.revision = self.revision.wrapping_add(1);
    }

    pub fn geometry_revision(&self) -> Option<u64> {
        self.locked.then_some(self.revision)
    }

    pub fn deferred_extent(&self) -> Option<f64> {
        self.uncut
            .as_ref()
            .filter(|_| self.locked && self.segments.get().is_none())
            .map(|uncut| uncut.extent)
    }

    pub(crate) fn segment_state_revision(&self) -> u64 {
        self.segment_state_revision
    }

    pub fn damaged(&self) -> bool {
        self.segments.get().is_some_and(|segments| {
            segments
                .iter()
                .any(|segment| segment.health != segment.max_health)
        })
    }

    pub fn decaying(&self) -> bool {
        self.object.decay != 0.0 && self.contents.is_empty()
    }

    fn collider<'a>(
        &self,
        points: &'a [Point],
        segment: Option<usize>,
    ) -> ColliderGeometry<'a, ObjectCollider> {
        ColliderGeometry {
            pose: Pose {
                position: self.object.position,
                rotation: self.object.rotation,
            },
            radius: self.object.radius,
            collision_margin: Some(0.0),
            outline: Some(points),
            collides: true,
            physical: true,
            pickup_point: false,
            catches: false,
            user_data: ObjectCollider {
                owner: self.object.id,
                part: segment.map_or(ColliderPart::Body, ColliderPart::AsteroidSegment),
                dock_segment: false,
                catches: false,
                material: ColliderMaterial {
                    friction: self.object.friction,
                    bounciness: 0.2,
                    speed: 0.0,
                    gate_panel: None,
                },
            },
        }
    }

    pub fn with_colliders(&self, visit: impl FnOnce(&[ColliderGeometry<'_, ObjectCollider>])) {
        if let Some(segments) = self.segments().filter(|segments| !segments.is_empty()) {
            let colliders: SmallVec<[_; 32]> = segments
                .iter()
                .enumerate()
                .map(|(index, segment)| self.collider(&segment.outline.points, Some(index)))
                .collect();
            visit(&colliders);
        } else {
            let points = self
                .collision_outline
                .get_or_init(|| fragment_collision_outline(self.outline()));
            visit(&[self.collider(points, None)]);
        }
    }

    pub(crate) fn visit_colliders(
        &self,
        mut visit: impl FnMut(usize, ColliderGeometry<'_, ObjectCollider>),
    ) {
        if let Some(segments) = self.segments().filter(|segments| !segments.is_empty()) {
            for (index, segment) in segments.iter().enumerate() {
                visit(index, self.collider(&segment.outline.points, Some(index)));
            }
        } else {
            let points = self
                .collision_outline
                .get_or_init(|| fragment_collision_outline(self.outline()));
            visit(0, self.collider(points, None));
        }
    }

    /// Apply a hit and return world changes in their original spawn order.
    pub fn hit(
        &mut self,
        target: Option<usize>,
        amount: f64,
        catalog: &Catalog,
    ) -> (f64, Option<FractureEffect>) {
        let applied = self.damage_segment(target, amount);
        (applied, self.fracture_after_damage(target, catalog))
    }

    pub fn damage_segment(&mut self, target: Option<usize>, amount: f64) -> f64 {
        if self.object.dead {
            return 0.0;
        }
        if target.is_some() {
            self.segments();
        }
        let health = if let Some(index) = target {
            let Some(segment) = self
                .segments
                .get_mut()
                .and_then(|segments| segments.get_mut(index))
            else {
                return 0.0;
            };
            &mut segment.health
        } else {
            &mut self.object.health
        };
        if *health > 0.0 {
            *health -= amount;
            if target.is_some() {
                self.segment_state_revision = self.segment_state_revision.wrapping_add(1);
            }
            amount
        } else {
            0.0
        }
    }

    pub fn first_broken_segment(&self) -> Option<usize> {
        self.segments
            .get()?
            .iter()
            .position(|segment| segment.health < 1.0)
    }

    pub fn fracture_after_damage(
        &mut self,
        target: Option<usize>,
        catalog: &Catalog,
    ) -> Option<FractureEffect> {
        if self.object.dead {
            return None;
        }
        if self.object.health < 1.0 {
            self.segments();
        }
        let object = &self.object;
        let outline = object
            .shape_outline
            .as_ref()
            .or(self.outline.as_deref())
            .expect("asteroid outline");
        let effects = fracture(
            FractureInput {
                id: object.id,
                motion: AsteroidMotion {
                    position: object.position,
                    velocity: object.velocity,
                    rotation: object.rotation,
                    spin: object.spin,
                },
                mass: object.mass,
                health: object.health,
                decay: object.decay,
                dead: object.dead,
                resource: object.resource,
                outline,
                contents: &self.contents,
                segments: self.segments.get_mut().map(Vec::as_mut_slice),
                damaged_segment: target,
            },
            catalog,
        );
        if effects.is_some() {
            self.segment_state_revision = self.segment_state_revision.wrapping_add(1);
            self.object.dead = true;
        }
        effects
    }
}

fn lock_outline(outline: &mut ShapeOutline) {
    if outline.edges.is_none() {
        outline.edges = Some(vec![true; outline.points.len()]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_asteroid_geometry_stays_lazy_until_a_contact() {
        let catalog = Catalog::load().unwrap();
        let mut outlines = AsteroidOutlines::default();
        let mut asteroid = Asteroid::from_generated(
            25,
            &AsteroidDescription {
                id: 25,
                radius: 55.0,
                ..Default::default()
            },
            &catalog,
            &mut outlines,
        );
        let revision = asteroid.geometry_revision();
        let extent = asteroid
            .outline()
            .points
            .iter()
            .map(|&[x, y]| Vector::new(x, y).length())
            .fold(0.0, f64::max);
        assert_eq!(asteroid.deferred_extent(), Some(extent));
        let mut count = 0;
        asteroid.with_colliders(|colliders| count = colliders.len());
        assert!(count > 1);
        assert!(asteroid.deferred_extent().is_none());
        assert_eq!(revision, asteroid.geometry_revision());
        assert!(!asteroid.damaged());
        let hit = asteroid.segments().unwrap()[0].health;
        let (damage, fracture) = asteroid.hit(Some(0), hit, &catalog);
        assert_eq!(damage, hit);
        assert!(matches!(fracture, Some(FractureEffect::Split(_))));
        assert!(asteroid.object.dead);
    }
}
