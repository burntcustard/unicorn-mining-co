use super::{BaseShape, CircleShape, PolygonShape};
use crate::utilities::vector::Vector;

#[derive(Clone, Debug)]
pub enum Shape {
    Circle(CircleShape),
    Polygon(PolygonShape),
}

impl Shape {
    pub fn circle(position: Vector, radius: f64) -> Self {
        Self::Circle(CircleShape::new(position, radius))
    }

    pub fn polygon(vertices: &[Vector], collision_margin: Option<f64>, linear_slop: f64) -> Self {
        Self::Polygon(PolygonShape::new(vertices, collision_margin, linear_slop))
    }

    pub fn base(&self) -> &BaseShape {
        match self {
            Self::Circle(shape) => &shape.base,
            Self::Polygon(shape) => &shape.base,
        }
    }
}
