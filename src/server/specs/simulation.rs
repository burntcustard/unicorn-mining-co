use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTier {
    pub substeps: i32,
    pub update_every: i32,
    pub replicate_every: i32,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsteroidDebris {
    pub min_lifetime: f64,
    pub max_lifetime: f64,
    pub decay: f64,
    pub separation_speed: f64,
    pub item_clearance: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Motion {
    pub default_drag: f64,
    pub default_max_speed: f64,
    pub max_speed_drag: f64,
    pub minimum_speed_squared: f64,
    pub minimum_spin: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Flight {
    pub low_fuel_threshold: f64,
    pub low_fuel_speed: f64,
    pub low_fuel_usage: f64,
    pub fuel_price: f64,
    pub thrust_scale: f64,
    pub mass_per_physics_unit: f64,
    pub steering_ease: f64,
    pub spin_divisor: f64,
    pub launch_duration: f64,
    pub launch_half_threshold: f64,
    pub launch_half_end: f64,
    pub launch_throttle: f64,
    pub speed_per_thrust: f64,
    pub uncrewed_max_speed: f64,
    pub angular_inertia_scale: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Replication {
    pub entity_load: f64,
    pub entity_unload: f64,
    pub marker_load: f64,
    pub marker_unload: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Physics {
    pub max_translation: f64,
    pub max_rotation: f64,
    pub velocity_iterations: i32,
    pub position_iterations: i32,
    pub wake_margin: f64,
    pub aabb_extension: f64,
    pub aabb_multiplier: f64,
    pub position_baumgarte: f64,
    pub toi_baumgarte: f64,
    pub max_linear_correction: f64,
    pub damage_base: f64,
    pub damage_scale: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Simulation {
    pub asteroid_debris: AsteroidDebris,
    pub linear_slop: f64,
    pub contact_speed_threshold: f64,
    pub physics: Physics,
    pub simulation_step: f64,
    pub max_catch_up_ticks: i32,
    pub max_prediction_ticks: i32,
    pub visible_range: f64,
    pub ballistic_replicate_every: i32,
    pub region_size: f64,
    pub pre_generated_radius: f64,
    pub update_tiers: HashMap<String, UpdateTier>,
    pub world_ranges: HashMap<String, f64>,
    pub server_region_ranges: HashMap<String, f64>,
    pub replication: Replication,
    pub motion: Motion,
    pub flight: Flight,
}
