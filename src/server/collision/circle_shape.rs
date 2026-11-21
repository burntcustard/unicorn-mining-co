use super::BaseShape;
use crate::utilities::vector::Vector;

#[derive(Clone, Debug)]
pub struct CircleShape {
    pub base: BaseShape,
}

impl CircleShape {
    pub fn new(position: Vector, radius: f64) -> Self {
        Self {
            base: BaseShape::new(radius, vec![position], 1),
        }
    }

    pub fn position(&self) -> Vector {
        self.base.vertex(0)
    }
}
