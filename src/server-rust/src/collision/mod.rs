//! Collision detection for rigid bodies and gameplay triggers.

mod bounds;
mod distance;
mod grid;
mod manifold;
mod sweep;
mod time_of_impact;

pub mod query;
pub mod shape;

pub use bounds::Aabb;
pub use distance::{DistanceInput, DistanceOutput, SimplexCache, compute_distance};
pub use grid::{BroadPhase, ProxyId, SpatialGrid, SpatialProxy};
pub use manifold::{Manifold, ManifoldType, WorldManifold, clip_segment_to_line};
pub use shape::{BaseShape, Bound, CircleShape, PolygonShape, Shape};
pub use sweep::Sweep;
pub use time_of_impact::{ToiInput, ToiOutput, find_time_of_impact};
