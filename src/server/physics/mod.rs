//! Rigid-body simulation with ordered discrete contacts and continuous impacts.

mod apply_force;
mod arena;
mod body;
mod body_pair;
mod contact;
mod fixture;
pub mod motion_sweep;
mod overlap_recovery;
mod solver;
mod world;

pub use body::Body;
pub use contact::Contact;
pub use fixture::{Fixture, FixtureOptions};
pub use world::{ContactContext, ContactListener, World};

use std::num::NonZeroU64;

use crate::specs::{Physics, Simulation};
pub use apply_force::apply_force;

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

#[cfg(test)]
mod tests;
