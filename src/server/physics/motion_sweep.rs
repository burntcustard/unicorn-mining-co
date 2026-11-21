//! Body motion between two sampled poses.

use std::f64::consts::{PI, TAU};

use crate::utilities::vector::Vector;
use crate::utilities::vector_math::{RotValue, TransformValue};

#[derive(Clone, Copy, Debug)]
pub struct Sweep {
    pub c: Vector,
    pub a: f64,
    pub alpha0: f64,
    pub c0: Vector,
    pub a0: f64,
    trig_angle: f64,
    rotation0: RotValue,
    transform_angle: f64,
    transform_rotation: RotValue,
}

impl Default for Sweep {
    fn default() -> Self {
        Self {
            c: Vector::ZERO,
            a: 0.0,
            alpha0: 0.0,
            c0: Vector::ZERO,
            a0: 0.0,
            trig_angle: f64::NAN,
            rotation0: RotValue::default(),
            transform_angle: f64::NAN,
            transform_rotation: RotValue::default(),
        }
    }
}

impl Sweep {
    pub fn rotation0(&mut self) -> RotValue {
        if self.trig_angle != self.a0 {
            self.trig_angle = self.a0;
            self.rotation0 = RotValue::new(self.a0);
        }
        self.rotation0
    }

    pub fn set_transform(&mut self, transform: TransformValue) {
        self.c = transform.p;
        self.c0 = transform.p;
        self.a = transform.q.sin.atan2(transform.q.cos);
        self.a0 = self.a;
    }

    pub fn transform(&mut self, beta: f64) -> TransformValue {
        let angle = (1.0 - beta) * self.a0 + beta * self.a;
        let q = if angle == self.a0 {
            self.rotation0()
        } else {
            if self.transform_angle != angle {
                self.transform_angle = angle;
                self.transform_rotation = RotValue::new(angle);
            }
            self.transform_rotation
        };
        TransformValue {
            p: Vector::combine2(1.0 - beta, self.c0, beta, self.c),
            q,
        }
    }

    pub fn advance(&mut self, alpha: f64) {
        let beta = (alpha - self.alpha0) / (1.0 - self.alpha0);
        self.c0 = Vector::combine2(beta, self.c, 1.0 - beta, self.c0);
        self.a0 = beta * self.a + (1.0 - beta) * self.a0;
        self.alpha0 = alpha;
    }

    pub fn normalize(&mut self) {
        let mut wrapped = self.a0 + PI;
        if !(0.0..TAU).contains(&wrapped) {
            wrapped %= TAU;
        }
        let a0 = if wrapped < 0.0 {
            wrapped + PI
        } else {
            wrapped - PI
        };
        self.a -= self.a0 - a0;
        self.a0 = a0;
    }
}
