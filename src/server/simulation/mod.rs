pub mod asteroid;
pub mod asteroid_fracture;
pub mod asteroid_geometry;
pub mod convex_parts;
pub mod game_object;
pub mod geometry;
pub mod local_movement;
pub mod observers;
pub mod polygon;
pub mod region_generation;
pub mod region_manager;
pub mod running_world;
pub mod saved_entity;
pub mod sector_generation;
pub mod streaming;
pub mod update_tier;
pub mod update_world;
pub mod world;
mod world_replication;

/// Mix a seed using the same wrapping 32-bit arithmetic as TypeScript.
fn mix(mut value: u32) -> u32 {
    value = (value ^ (value >> 16)).wrapping_mul(0x7feb352d);
    value = (value ^ (value >> 15)).wrapping_mul(0x846ca68b);
    value ^ (value >> 16)
}
