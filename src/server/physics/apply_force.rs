use crate::utilities::vector::Vector;

pub fn apply_force(
    linear_velocity: &mut Vector,
    angular_velocity: &mut f64,
    mass: f64,
    force: Vector,
    spin: f64,
) {
    let inverse_mass = 1.0 / mass;
    *linear_velocity = linear_velocity.add_scaled(force, inverse_mass);
    *angular_velocity += spin / mass;
}
