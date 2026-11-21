//! Axis-aligned bounds for broad-phase collision detection.

use crate::utilities::vector::Vector;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Aabb {
    pub lower_bound: Vector,
    pub upper_bound: Vector,
}

impl Aabb {
    pub const EMPTY: Self = Self {
        lower_bound: Vector::new(f64::INFINITY, f64::INFINITY),
        upper_bound: Vector::new(f64::NEG_INFINITY, f64::NEG_INFINITY),
    };

    pub fn combine(self, other: Self) -> Self {
        Self {
            lower_bound: Vector::new(
                self.lower_bound.x.min(other.lower_bound.x),
                self.lower_bound.y.min(other.lower_bound.y),
            ),
            upper_bound: Vector::new(
                other.upper_bound.x.max(self.upper_bound.x),
                other.upper_bound.y.max(self.upper_bound.y),
            ),
        }
    }

    pub fn contains(self, other: Self) -> bool {
        self.lower_bound.x <= other.lower_bound.x
            && self.lower_bound.y <= other.lower_bound.y
            && other.upper_bound.x <= self.upper_bound.x
            && other.upper_bound.y <= self.upper_bound.y
    }

    pub fn extend(&mut self, amount: f64) {
        self.lower_bound -= Vector::new(amount, amount);
        self.upper_bound += Vector::new(amount, amount);
    }

    pub fn overlaps(self, other: Self) -> bool {
        !(other.lower_bound.x > self.upper_bound.x
            || other.lower_bound.y > self.upper_bound.y
            || self.lower_bound.x > other.upper_bound.x
            || self.lower_bound.y > other.upper_bound.y)
    }
}
