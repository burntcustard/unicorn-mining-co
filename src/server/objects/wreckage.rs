use serde::{Deserialize, Serialize};

use crate::objects::craft::Craft;
use crate::physics::apply_force;
use crate::simulation::convex_parts::convex_parts;
use crate::simulation::game_object::{GameObject, ObjectProperties};
use crate::simulation::geometry::rotate_point;
use crate::specs::{CRAFT_FRICTION, Catalog, HullSegment, Point, WRECKAGE_DECAY, WRECKAGE_HEALTH};
use crate::utilities::seeded_random::SeededRandom;
use crate::utilities::vector::Vector;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WreckagePart {
    pub color: String,
    pub outline: Option<Vec<Point>>,
    pub radius: f64,
    pub offset: Vector,
    pub health: f64,
    pub fill_shade: Option<f64>,
    pub unstroked: bool,
}

pub(super) struct WreckageLaunch {
    pub(super) id: i64,
    pub(super) origin: Vector,
    pub(super) away: Vector,
    pub(super) parts: Vec<WreckagePart>,
    pub(super) shades: Option<Vec<String>>,
}

impl Craft {
    pub(super) fn spawn_wreckage(
        &self,
        launch: WreckageLaunch,
        catalog: &Catalog,
        random: &mut SeededRandom,
    ) -> Craft {
        let WreckageLaunch {
            id,
            origin,
            away,
            parts,
            shades,
        } = launch;
        let offset = rotate_point(origin, self.object.rotation);
        let velocity = self.object.velocity
            + Vector::new(-offset.y * self.object.spin, offset.x * self.object.spin);
        let health = WRECKAGE_HEALTH + random.next_float();
        let mut fragment = Craft::from_wreckage(
            id,
            ObjectProperties {
                position: self.object.position + offset,
                velocity,
                rotation: self.object.rotation,
                spin: self.object.spin,
                decay: Some(WRECKAGE_DECAY),
                health: Some(health),
                mass: Some(parts.len() as f64),
                ..ObjectProperties::default()
            },
            parts,
            shades.or_else(|| self.object.shades.clone()),
            catalog,
        );
        let mass = fragment.object.force_mass();
        let force = rotate_point(away, self.object.rotation).normalized() * 30.0;
        apply_force(
            &mut fragment.object.velocity,
            &mut fragment.object.spin,
            mass,
            force,
            random.next_float() - 0.5,
        );
        fragment
    }

    pub fn from_wreckage(
        id: i64,
        mut properties: ObjectProperties,
        parts: Vec<WreckagePart>,
        shades: Option<Vec<String>>,
        catalog: &Catalog,
    ) -> Craft {
        properties.friction.get_or_insert(CRAFT_FRICTION);
        properties.name.get_or_insert_with(|| "Wreckage".into());
        let mut object = GameObject::new(id, properties, &catalog.simulation);
        object.kind = "craft".into();
        object.shades = shades.or_else(|| catalog.colors.get("white").cloned());

        let plans: Vec<_> = parts
            .iter()
            .map(|part| HullSegment {
                points: part.outline.clone().unwrap_or_default(),
                collision_parts: part.outline.as_deref().and_then(convex_parts),
                health: Some(part.health),
                ..HullSegment::default()
            })
            .collect();
        let mut craft = Craft::new(object, &plans);
        for (hull, part) in craft.hulls.iter_mut().zip(&parts) {
            hull.position = part.offset;
            hull.original_position = part.offset;
            hull.collider_plan.radius = part.radius;
        }
        craft.wreckage = parts;
        craft
    }
}
