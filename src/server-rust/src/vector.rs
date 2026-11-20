//! Shared two-dimensional vector and rigid-transform operations.

use serde::{Deserialize, Serialize};
use std::f64::consts::{FRAC_PI_2, PI, TAU};
use std::ops::{Add, AddAssign, Mul, Neg, Sub, SubAssign};

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Vector {
    pub x: f64,
    pub y: f64,
}

impl Vector {
    pub const ZERO: Self = Self::new(0.0, 0.0);

    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn add_scaled(self, direction: Self, distance: f64) -> Self {
        Self::new(
            self.x + direction.x * distance,
            self.y + direction.y * distance,
        )
    }

    pub fn length(self) -> f64 {
        self.length_squared().sqrt()
    }

    pub fn length_squared(self) -> f64 {
        self.x * self.x + self.y * self.y
    }

    pub fn distance(self, other: Self) -> f64 {
        // Match math.Hypot's operation order, including its handling of infinities.
        let (mut p, mut q) = ((self.x - other.x).abs(), (self.y - other.y).abs());
        if p.is_infinite() || q.is_infinite() {
            return f64::INFINITY;
        }
        if p.is_nan() || q.is_nan() {
            return f64::NAN;
        }
        if p < q {
            std::mem::swap(&mut p, &mut q);
        }
        if p == 0.0 {
            return 0.0;
        }
        q /= p;
        p * (1.0 + q * q).sqrt()
    }

    pub fn distance_squared(self, other: Self) -> f64 {
        (self - other).length_squared()
    }

    pub fn normalized(self) -> Self {
        let magnitude = self.length();
        let divisor = if magnitude == 0.0 || magnitude.is_nan() {
            1.0
        } else {
            magnitude
        };
        Self::new(self.x / divisor, self.y / divisor)
    }

    pub fn combine2(a_multiplier: f64, a: Self, b_multiplier: f64, b: Self) -> Self {
        Self::new(
            a_multiplier * a.x + b_multiplier * b.x,
            a_multiplier * a.y + b_multiplier * b.y,
        )
    }

    pub fn combine3(am: f64, a: Self, bm: f64, b: Self, cm: f64, c: Self) -> Self {
        Self::new(
            am * a.x + bm * b.x + cm * c.x,
            am * a.y + bm * b.y + cm * c.y,
        )
    }

    pub fn cross_scalar(self, scalar: f64) -> Self {
        Self::new(scalar * self.y, -scalar * self.x)
    }

    pub fn cross(self, other: Self) -> f64 {
        self.x * other.y - self.y * other.x
    }

    pub fn dot(self, other: Self) -> f64 {
        self.x * other.x + self.y * other.y
    }
}

impl Add for Vector {
    type Output = Self;

    fn add(self, other: Self) -> Self {
        Self::new(self.x + other.x, self.y + other.y)
    }
}

impl AddAssign for Vector {
    fn add_assign(&mut self, other: Self) {
        *self = *self + other;
    }
}

impl Sub for Vector {
    type Output = Self;

    fn sub(self, other: Self) -> Self {
        Self::new(self.x - other.x, self.y - other.y)
    }
}

impl SubAssign for Vector {
    fn sub_assign(&mut self, other: Self) {
        *self = *self - other;
    }
}

impl Mul<f64> for Vector {
    type Output = Self;

    fn mul(self, scale: f64) -> Self {
        Self::new(self.x * scale, self.y * scale)
    }
}

impl Neg for Vector {
    type Output = Self;

    fn neg(self) -> Self {
        Self::new(-self.x, -self.y)
    }
}

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

/// Preserve the approximation and operation order of client/utilities/sin-cos.ts.
pub fn sin_cos(mut angle: f64) -> (f64, f64) {
    if angle <= -TAU || angle >= TAU {
        angle %= TAU;
    }
    if angle.is_nan() {
        return (f64::NAN, f64::NAN);
    }

    let index = (angle * (2.0 / PI) + 0.5).floor() as i32;
    let residual = angle - f64::from(index) * FRAC_PI_2;
    let squared = residual * residual;
    let sin = residual
        * (1.0
            + squared
                * (-1.0 / 6.0
                    + squared
                        * (1.0 / 120.0
                            + squared
                                * (-1.0 / 5040.0
                                    + squared
                                        * (1.0 / 362880.0
                                            + squared
                                                * (-1.0 / 39916800.0
                                                    + squared
                                                        * (1.0 / 6227020800.0
                                                            + squared
                                                                * (-1.0 / 1307674368000.0))))))));
    let cos = 1.0
        + squared
            * (-1.0 / 2.0
                + squared
                    * (1.0 / 24.0
                        + squared
                            * (-1.0 / 720.0
                                + squared
                                    * (1.0 / 40320.0
                                        + squared
                                            * (-1.0 / 3628800.0
                                                + squared
                                                    * (1.0 / 479001600.0
                                                        + squared * (-1.0 / 87178291200.0)))))));
    match index & 3 {
        0 => (sin, cos),
        1 => (cos, -sin),
        2 => (-sin, -cos),
        _ => (-cos, sin),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approximates_rotations_within_original_tolerance() {
        for index in 0..=400000 {
            let angle = -64.0 + 128.0 * f64::from(index) / 400000.0;
            let (sin, cos) = sin_cos(angle);
            let (expected_sin, expected_cos) = angle.sin_cos();
            assert!((sin - expected_sin).abs() <= 1e-12);
            assert!((cos - expected_cos).abs() <= 1e-12);
            assert!((sin * sin + cos * cos - 1.0).abs() <= 1e-12);
        }
    }

    #[test]
    fn preserves_signed_zero_and_non_finite_angles() {
        for angle in [0.0, -0.0, TAU, -TAU] {
            let (sin, cos) = sin_cos(angle);
            assert_eq!(sin.to_bits(), 0.0_f64.copysign(angle).to_bits());
            assert_eq!(cos, 1.0);
        }
        for angle in [f64::INFINITY, f64::NEG_INFINITY, f64::NAN] {
            let (sin, cos) = sin_cos(angle);
            assert!(sin.is_nan() && cos.is_nan());
        }
    }
}

#[cfg(test)]
mod recorded {
    use super::*;

    #[derive(Deserialize)]
    struct Rotation {
        angle: f64,
        sin: f64,
        cos: f64,
    }

    #[test]
    fn rotations_match_typescript_recording() {
        let cases: Vec<Rotation> =
            serde_json::from_str(include_str!("../../../tests/fixtures/rotation.json")).unwrap();
        for case in cases {
            assert_eq!(
                sin_cos(case.angle),
                (case.sin, case.cos),
                "angle {}",
                case.angle
            );
        }
    }
}
