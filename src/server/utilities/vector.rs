//! Shared two-dimensional vector and rigid-transform operations.

use serde::{Deserialize, Serialize};
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
