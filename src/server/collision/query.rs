//! Contacts between game objects using either prepared or raw geometry.

use serde::{Deserialize, Serialize};

use crate::utilities::vector::Vector;
use crate::utilities::vector_math::TransformValue;

use super::{Manifold, Shape, WorldManifold};
use super::{
    circle_circle_contact::collide_circles, polygon_circle_contact::collide_polygon_circle,
    polygon_polygon_contact::collide_polygons_cached,
};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeData {
    pub position: Vector,
    pub rotation: f64,
    pub radius: f64,
    #[serde(rename = "shapeOutline", skip_serializing_if = "Option::is_none")]
    pub outline: Option<Vec<[f64; 2]>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collision_margin: Option<f64>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
pub struct Contact {
    pub depth: f64,
    pub normal: Vector,
    pub point: Vector,
}

pub fn shape_of(collider: &ShapeData, linear_slop: f64) -> Shape {
    match &collider.outline {
        Some(outline) => {
            let vertices: Vec<_> = outline.iter().map(|&[x, y]| Vector::new(x, y)).collect();
            Shape::polygon(&vertices, collider.collision_margin, linear_slop)
        }
        None => Shape::circle(Vector::ZERO, collider.radius),
    }
}

pub fn contact_between(a: &ShapeData, b: &ShapeData, linear_slop: f64) -> Option<Contact> {
    let shape_a = shape_of(a, linear_slop);
    let shape_b = shape_of(b, linear_slop);
    contact_shapes(
        &shape_a,
        &shape_b,
        TransformValue::new(a.position, a.rotation),
        TransformValue::new(b.position, b.rotation),
        linear_slop,
    )
}

pub fn contact_shapes(
    a: &Shape,
    b: &Shape,
    xf_a: TransformValue,
    xf_b: TransformValue,
    linear_slop: f64,
) -> Option<Contact> {
    let mut manifold = Manifold::default();
    let mut reversed = false;
    match (a, b) {
        (Shape::Polygon(a), Shape::Polygon(b)) => {
            collide_polygons_cached(&mut manifold, a, xf_a, b, xf_b, linear_slop, &mut [0; 2]);
        }
        (Shape::Polygon(a), Shape::Circle(b)) => {
            collide_polygon_circle(&mut manifold, a, xf_a, b, xf_b)
        }
        (Shape::Circle(a), Shape::Polygon(b)) => {
            collide_polygon_circle(&mut manifold, b, xf_b, a, xf_a);
            reversed = true;
        }
        (Shape::Circle(a), Shape::Circle(b)) => collide_circles(&mut manifold, a, xf_a, b, xf_b),
    }
    if manifold.point_count == 0 {
        return None;
    }
    let mut world = WorldManifold::default();
    let (radius_a, radius_b) = (a.base().radius, b.base().radius);
    let direction = if reversed {
        manifold.world_manifold(&mut world, xf_b, radius_b, xf_a, radius_a);
        -1.0
    } else {
        manifold.world_manifold(&mut world, xf_a, radius_a, xf_b, radius_b);
        1.0
    };
    Some(Contact {
        depth: -world.separations[0].min(world.separations[1]),
        normal: world.normal * direction,
        point: world.points[0],
    })
}

#[cfg(test)]
mod tests {
    use std::f64::consts::{FRAC_PI_2, PI};

    use super::*;

    #[test]
    fn prepared_contacts_reuse_geometry_at_different_transforms() {
        let circle = Shape::circle(Vector::ZERO, 1.0);
        let polygon = Shape::Polygon(super::super::PolygonShape::as_box(1.0, 1.0, 0.0));
        for (a, b) in [
            (&circle, &circle),
            (&polygon, &circle),
            (&circle, &polygon),
            (&polygon, &polygon),
        ] {
            for rotation in [0.0_f64, FRAC_PI_2, PI] {
                let normal = Vector::new(rotation.cos(), rotation.sin());
                let position = Vector::new(20.0, -10.0);
                let xf_a = TransformValue::new(position, rotation);
                let xf_b = TransformValue::new(position.add_scaled(normal, 1.5), rotation);
                let contact = contact_shapes(a, b, xf_a, xf_b, 0.005).unwrap();
                assert!((contact.depth - 0.5).abs() <= 1e-12, "{contact:?}");
                assert!(
                    contact.normal.distance_squared(normal) <= 1e-24,
                    "{contact:?}"
                );
                assert!(
                    ((contact.point - position).dot(normal) - 0.75).abs() <= 1e-12,
                    "{contact:?}"
                );
                let xf_b = TransformValue::new(position.add_scaled(normal, 3.0), rotation);
                assert!(contact_shapes(a, b, xf_a, xf_b, 0.005).is_none());
            }
        }
    }
}
