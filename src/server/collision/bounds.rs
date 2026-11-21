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

    /// Combines bounds on the assumption that collision coordinates are NaN-free.
    ///
    /// Rust's float min and max keep this hot path simple and avoid extra comparisons.
    /// A lone NaN is ignored, and mixed signed zeros may return either sign.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combine_ignores_a_single_nan_per_coordinate() {
        let nan = Vector::new(f64::NAN, f64::NAN);
        let nan_bounds = Aabb {
            lower_bound: nan,
            upper_bound: nan,
        };
        let bounds = Aabb {
            lower_bound: Vector::new(-7.0, f64::NEG_INFINITY),
            upper_bound: Vector::new(7.0, f64::INFINITY),
        };

        assert_eq!(bounds.combine(nan_bounds), bounds);
        assert_eq!(nan_bounds.combine(bounds), bounds);
    }

    #[test]
    fn combine_treats_signed_zeros_as_equal() {
        let negative_zero = Aabb {
            lower_bound: Vector::new(-0.0, -0.0),
            upper_bound: Vector::new(-0.0, -0.0),
        };
        let positive_zero = Aabb::default();

        assert_eq!(negative_zero.combine(positive_zero), positive_zero);
        assert_eq!(positive_zero.combine(negative_zero), positive_zero);
    }
}
