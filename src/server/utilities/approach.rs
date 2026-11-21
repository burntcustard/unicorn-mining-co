pub fn approach(value: f64, target: f64, step: f64) -> f64 {
    let difference = target - value;
    if step.is_nan() || difference.is_nan() {
        return f64::NAN;
    }
    value + (-step).max(step.min(difference))
}
