use super::Vector;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn is_default<T: Default + PartialEq>(value: &T) -> bool {
    value == &T::default()
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StationDescription {
    pub definition_id: String,
    pub id: u32,
    pub position: Vector,
    pub radius: f64,
    pub spin: f64,
    pub r#type: String,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsteroidDescription {
    pub contents: Vec<i32>,
    pub id: u32,
    #[serde(default, skip_serializing_if = "is_default")]
    pub point_count: i32,
    pub position: Vector,
    pub radius: f64,
    #[serde(default, skip_serializing_if = "is_default")]
    pub radius_even: f64,
    pub resource: i32,
    pub rotation: f64,
    pub spin: f64,
    pub r#type: String,
}

// A wreck's clue also retains the field's ID and radius.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct FieldDescription {
    #[serde(default, skip_serializing_if = "is_default")]
    pub id: u32,
    pub position: Vector,
    #[serde(default, skip_serializing_if = "is_default")]
    pub radius: f64,
    pub resource: i32,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WreckDescription {
    pub cargo_contents: Vec<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clue_field: Option<FieldDescription>,
    pub id: u32,
    pub paint: i32,
    pub position: Vector,
    pub radius: f64,
    pub spin: f64,
    pub r#type: String,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct RegionDescription {
    pub asteroids: Vec<AsteroidDescription>,
    pub region: Vector,
    pub stations: Vec<StationDescription>,
    pub wrecks: Vec<WreckDescription>,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct LoadedRegion {
    pub description: Option<RegionDescription>,
    pub seed: u32,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldRanges {
    pub asteroid: f64,
    pub item: f64,
    pub station_marker: f64,
    pub station_physics: f64,
    pub wreck: f64,
}

impl WorldRanges {
    pub fn from_values(values: &HashMap<String, f64>) -> Self {
        Self {
            asteroid: values.get("asteroid").copied().unwrap_or_default(),
            item: values.get("item").copied().unwrap_or_default(),
            station_marker: values.get("stationMarker").copied().unwrap_or_default(),
            station_physics: values.get("stationPhysics").copied().unwrap_or_default(),
            wreck: values.get("wreck").copied().unwrap_or_default(),
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionalView {
    pub asteroids: Vec<AsteroidDescription>,
    pub station_markers: Vec<StationDescription>,
    pub stations: Vec<StationDescription>,
    pub wrecks: Vec<WreckDescription>,
}
