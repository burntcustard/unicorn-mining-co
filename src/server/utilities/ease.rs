use std::f64::consts::PI;

pub fn ease_progress(progress: f64) -> f64 {
    (1.0 - (PI * progress).cos()) / 2.0
}
