//! Collision detection for rigid bodies and gameplay triggers.

mod base_shape;
mod bounds;
mod broad_phase;
pub mod circle_circle_contact;
mod circle_shape;
mod distance;
mod manifold;
pub mod polygon_circle_contact;
pub mod polygon_polygon_contact;
mod polygon_shape;
mod spatial_grid;
mod time_of_impact;

pub mod query;
pub mod shape;

pub use base_shape::{BaseShape, Bound};
pub use bounds::Aabb;
pub use broad_phase::BroadPhase;
pub use circle_shape::CircleShape;
pub use distance::{DistanceInput, DistanceOutput, SimplexCache, compute_distance};
pub use manifold::{Manifold, ManifoldType, WorldManifold, clip_segment_to_line};
pub use polygon_shape::PolygonShape;
pub use shape::Shape;
pub use spatial_grid::{ProxyId, SpatialGrid, SpatialProxy};
pub use time_of_impact::{ToiInput, ToiOutput, find_time_of_impact};
