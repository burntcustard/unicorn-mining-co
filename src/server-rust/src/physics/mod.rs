//! Rigid-body simulation with ordered discrete contacts and continuous impacts.

mod arena;
mod body;
mod body_pair;
mod contact;
mod fixture;
mod recovery;
mod solver;
mod world;

pub use body::Body;
pub use contact::Contact;
pub use fixture::{Fixture, FixtureOptions};
pub use world::{ContactContext, ContactListener, World};

use std::num::NonZeroU64;

use crate::specs::{Physics, Simulation};
use crate::vector::Vector;

use body_pair::PairKey;

macro_rules! physics_id {
    ($visibility:vis $name:ident) => {
        #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        $visibility struct $name(NonZeroU64);

        impl arena::Key for $name {
            fn from_bits(bits: NonZeroU64) -> Self {
                Self(bits)
            }

            fn bits(self) -> NonZeroU64 {
                self.0
            }
        }
    };
}

physics_id!(pub BodyId);
physics_id!(pub FixtureId);
physics_id!(ContactId);

#[derive(Clone, Copy, Debug)]
pub struct PhysicsRules {
    pub physics: Physics,
    pub linear_slop: f64,
    pub contact_speed_threshold: f64,
}

impl From<&Simulation> for PhysicsRules {
    fn from(simulation: &Simulation) -> Self {
        Self {
            physics: simulation.physics,
            linear_slop: simulation.linear_slop,
            contact_speed_threshold: simulation.contact_speed_threshold,
        }
    }
}

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

#[cfg(test)]
mod tests;
