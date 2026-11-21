use std::f64::consts::{FRAC_PI_2, PI, TAU};

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
    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    struct Rotation {
        angle: f64,
        sin: f64,
        cos: f64,
    }

    #[test]
    fn rotations_match_typescript_recording() {
        let cases: Vec<Rotation> = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/rotation.json"
        )))
        .unwrap();
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
