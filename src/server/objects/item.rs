//! Loose cargo and its separate cargo pickup point.

use crate::simulation::game_object::{GameObject, ObjectHitbox, ObjectProperties};
use crate::simulation::polygon::{ShapeOutline, radius_of};
use crate::specs::Catalog;

#[derive(Debug)]
pub struct Item {
    pub object: GameObject,
    pub rounds: Option<i32>,
}

#[derive(Clone, Copy, Debug)]
pub struct ItemCollider<'a> {
    pub hitbox: ObjectHitbox<'a>,
    pub pickup_point: bool,
    pub collision_margin: Option<f64>,
}

impl Item {
    pub fn new(
        id: i64,
        definition: &str,
        mut properties: ObjectProperties,
        catalog: &Catalog,
    ) -> Option<Self> {
        let mut shades = None;
        let mut unlock = String::new();
        let mut price = f64::NAN;
        let mut rounds = None;
        let mut radius = catalog
            .item_defaults
            .get("radius")
            .copied()
            .unwrap_or_default();
        properties.mass.get_or_insert_with(|| {
            catalog
                .item_defaults
                .get("mass")
                .copied()
                .unwrap_or_default()
        });
        properties.angular_drag.get_or_insert_with(|| {
            catalog
                .item_defaults
                .get("angularDrag")
                .copied()
                .unwrap_or_default()
        });

        if !definition.is_empty() {
            let spec = catalog.item_specs.get(definition)?;
            properties.resource.get_or_insert(spec.resource);
            properties.name.get_or_insert_with(|| spec.name.clone());
            properties.health.get_or_insert_with(|| {
                catalog
                    .item_defaults
                    .get("health")
                    .copied()
                    .unwrap_or_default()
            });
            properties.bounciness.get_or_insert_with(|| {
                catalog
                    .item_defaults
                    .get("bounciness")
                    .copied()
                    .unwrap_or_default()
            });

            if spec.radius != 0.0 {
                radius = spec.radius;
            }
            if let Some(points) = &spec.points {
                properties.shape_outline = Some(ShapeOutline {
                    points: points.clone(),
                    edges: None,
                });
            }
            shades.clone_from(&spec.shades);
            unlock.clone_from(&spec.unlock);
            price = spec.price.unwrap_or(f64::NAN);
            rounds = (spec.rounds > 0).then_some(spec.rounds);
        }

        if let Some(points) = properties.points.take() {
            properties.shape_outline = Some(ShapeOutline {
                points,
                edges: None,
            });
        }
        properties.radius.get_or_insert(radius);
        let mut object = GameObject::new(id, properties, &catalog.simulation);
        if let Some(outline) = &object.shape_outline {
            object.radius = radius_of(&outline.points, [0.0, 0.0]);
        }
        object.kind = "item".into();
        object.item = true;
        object.shades = shades;
        object.unlock = unlock;
        object.price = price;

        Some(Self { object, rounds })
    }

    pub fn hitboxes(&self) -> Option<[ItemCollider<'_>; 2]> {
        let body = self.object.hitbox()?;
        let point = ObjectHitbox {
            radius: 0.0,
            outline: None,
            physics: false,
            bounciness: None,
            ..body
        };

        Some([
            ItemCollider {
                hitbox: body,
                pickup_point: false,
                collision_margin: Some(0.0),
            },
            ItemCollider {
                hitbox: point,
                pickup_point: true,
                collision_margin: None,
            },
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ammunition_keeps_pickup_point_and_authored_rounds() -> Result<(), crate::specs::CatalogError>
    {
        let catalog = Catalog::load()?;
        let item = Item::new(
            8,
            "autogunAmmo",
            ObjectProperties {
                points: Some(vec![[-2.0, 0.0], [2.0, 0.0], [0.0, 3.0]]),
                radius: Some(70.0),
                ..ObjectProperties::default()
            },
            &catalog,
        )
        .expect("stock ammunition definition");

        assert_eq!(item.object.radius, 3.0);
        assert_eq!(item.rounds, Some(catalog.item_specs["autogunAmmo"].rounds));
        let [body, point] = item.hitboxes().expect("unburied item has colliders");
        assert_eq!(body.collision_margin, Some(0.0));
        assert_eq!(point.hitbox.owner, 8);
        assert_eq!(point.hitbox.radius, 0.0);
        assert!(point.pickup_point);
        assert!(!point.hitbox.physics);
        Ok(())
    }
}
