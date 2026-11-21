use super::{sin_cos::sin_cos, vector::Vector};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RotValue {
    pub sin: f64,
    pub cos: f64,
}

impl RotValue {
    pub fn new(angle: f64) -> Self {
        let (sin, cos) = sin_cos(angle);
        Self { sin, cos }
    }

    pub fn rotate(self, value: Vector) -> Vector {
        Vector::new(
            self.cos * value.x - self.sin * value.y,
            self.sin * value.x + self.cos * value.y,
        )
    }

    pub fn unrotate(self, value: Vector) -> Vector {
        Vector::new(
            self.cos * value.x + self.sin * value.y,
            -self.sin * value.x + self.cos * value.y,
        )
    }

    pub fn rerotate(self, after: Self, value: Vector) -> Vector {
        after.rotate(self.unrotate(value))
    }
}

impl Default for RotValue {
    fn default() -> Self {
        Self { sin: 0.0, cos: 1.0 }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TransformValue {
    pub p: Vector,
    pub q: RotValue,
}

impl TransformValue {
    pub fn new(position: Vector, rotation: f64) -> Self {
        Self {
            p: position,
            q: RotValue::new(rotation),
        }
    }

    pub fn transform(self, value: Vector) -> Vector {
        self.q.rotate(value) + self.p
    }

    pub fn inverse_transform(self, value: Vector) -> Vector {
        self.q.unrotate(value - self.p)
    }

    pub fn change_transform(self, to: Self, value: Vector) -> Vector {
        to.inverse_transform(self.transform(value))
    }

    pub fn detransform(self, other: Self) -> Self {
        let cos = self.q.cos * other.q.cos + self.q.sin * other.q.sin;
        let sin = self.q.cos * other.q.sin - self.q.sin * other.q.cos;
        Self {
            p: self.q.unrotate(other.p - self.p),
            q: RotValue { sin, cos },
        }
    }
}
