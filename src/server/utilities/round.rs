pub(crate) const MOTION_ROUND_SCALE: f64 = (1 << 24) as f64;

pub fn round(value: f64) -> f64 {
    round_ties_up(value * 1e8) / 1e8
}

/// JavaScript Math.round, including negative zero at the origin.
pub fn round_ties_up(scaled: f64) -> f64 {
    let lower = scaled.floor();
    let rounded = if scaled - lower >= 0.5 {
        lower + 1.0
    } else {
        lower
    };
    if rounded == 0.0 {
        0.0_f64.copysign(scaled)
    } else {
        rounded
    }
}

/// Quantize motion to a binary grid, with ties rounded to even.
pub fn round_motion(value: f64) -> f64 {
    (value * MOTION_ROUND_SCALE).round_ties_even() * (1.0 / MOTION_ROUND_SCALE)
}

pub(crate) fn round_motion_components(values: [f64; 6]) -> [f64; 6] {
    #[cfg(target_arch = "x86_64")]
    if std::arch::is_x86_feature_detected!("sse4.1") {
        // SAFETY: the runtime check confirms the required instruction set.
        return unsafe { round_motion_sse41(values) };
    }
    values.map(round_motion)
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "sse4.1")]
unsafe fn round_motion_sse41(mut values: [f64; 6]) -> [f64; 6] {
    use std::arch::x86_64::*;

    let scale = _mm_set1_pd(MOTION_ROUND_SCALE);
    let unscale = _mm_set1_pd(1.0 / MOTION_ROUND_SCALE);
    for pair in values.as_chunks_mut::<2>().0 {
        // SAFETY: each pair contains two writable floats, with no alignment requirement.
        let motion = unsafe { _mm_loadu_pd(pair.as_ptr()) };
        let scaled = _mm_mul_pd(motion, scale);
        let rounded = _mm_round_pd::<{ _MM_FROUND_TO_NEAREST_INT | _MM_FROUND_NO_EXC }>(scaled);
        unsafe { _mm_storeu_pd(pair.as_mut_ptr(), _mm_mul_pd(rounded, unscale)) };
    }
    values
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript_rounding_ties() {
        for (input, expected) in [
            (0.000000005, 0.00000001_f64),
            (-0.000000005, -0.0),
            (1.000000005, 1.00000001),
            (-1.000000005, -1.0),
            (2.123456789, 2.12345679),
        ] {
            assert_eq!(round(input).to_bits(), expected.to_bits());
        }
    }

    #[test]
    fn motion_binary_grid() {
        let step = 1.0 / (1 << 24) as f64;
        let half = step / 2.0;
        for (input, expected) in [
            (half, 0.0),
            (3.0 * half, 2.0 * step),
            (5.0 * half, 2.0 * step),
            (-half, -0.0),
            (-3.0 * half, -2.0 * step),
            (half.next_up(), step),
            (half.next_down(), 0.0),
            (-0.0, -0.0),
            (f64::INFINITY, f64::INFINITY),
            (f64::NEG_INFINITY, f64::NEG_INFINITY),
        ] {
            assert_eq!(round_motion(input).to_bits(), expected.to_bits());
            assert_eq!(
                round_motion_components([input; 6]).map(f64::to_bits),
                [expected.to_bits(); 6]
            );
        }
        assert!(round_motion(f64::NAN).is_nan());
        assert!(
            round_motion_components([f64::NAN; 6])
                .into_iter()
                .all(f64::is_nan)
        );
    }
}
