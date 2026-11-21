use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DensityFalloff {
    pub scale: f64,
    pub floor: f64,
    pub cutoff: f64,
    pub peak: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectorGeneration {
    pub version: i32,
    pub graph_anchor: String,
    pub enabled_count: usize,
    pub map_radius_x: f64,
    pub map_radius_y: f64,
    pub graph_stages: Vec<usize>,
    pub spare_gate_sites: usize,
    pub spare_wormhole_sites: usize,
    pub max_connections: usize,
    pub max_connection_distance: f64,
    pub gate_radius: f64,
    pub wormhole_radius: f64,
    pub gate_clearance: f64,
    pub gate_arrival_distance: f64,
    pub gate_distance: f64,
    pub gate_distance_range: f64,
    pub wormhole_distance: f64,
    pub wormhole_distance_range: f64,
    pub cruise_speed: f64,
    pub crossing_minutes: f64,
    pub crossing_minutes_range: f64,
    pub aspect_ratio: f64,
    pub aspect_ratio_range: f64,
    pub rich_field_search_range: f64,
    pub density: Vec<DensityFalloff>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureSpecification {
    pub size: f64,
    pub chance: f64,
    pub clearance: f64,
    pub kind: u32,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionGeneration {
    pub features: Vec<FeatureSpecification>,
    pub station_stream: u32,
    pub station_radius: f64,
    pub wreck_radius: f64,
    pub field_radius: f64,
    pub field_radius_range: f64,
    pub rich_field_amethyst_chance: f64,
    pub rich_field_gold_chance: f64,
    pub nearest_field_initial_range: f64,
    pub field_search_margin: f64,
    pub asteroid_counts: BTreeMap<String, usize>,
    pub asteroid_base_radius: f64,
    pub asteroid_amethyst_radius: f64,
    pub asteroid_amethyst_range: f64,
    pub asteroid_gold_radius: f64,
    pub asteroid_gold_range: f64,
    pub asteroid_mixed_radius: f64,
    pub asteroid_mixed_range: f64,
    pub mixed_item_chance: f64,
    pub mixed_item_limit: usize,
    pub asteroid_spacing: f64,
    pub asteroid_variance: f64,
    pub asteroid_point_count_scale: f64,
}
