use serde::{Deserialize, Serialize};

use super::{HullSegment, Point};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Item {
    pub description: String,
    pub rounds: i32,
    pub resource: i32,
    pub name: String,
    pub price: Option<f64>,
    pub points: Option<Vec<Point>>,
    pub radius: f64,
    pub lines: Vec<Vec<Point>>,
    pub shades: Option<Vec<String>>,
    pub glint: bool,
    pub rainbow: bool,
    pub fill_alpha: f64,
    pub unlock: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpGate {
    pub access_response_delay: f64,
    pub radius: f64,
    pub travel_radius: f64,
    pub approach_radius: f64,
    pub opening_duration: f64,
    pub closing_duration: f64,
    pub state_hold_duration: f64,
    pub half_travel: f64,
    pub beam_offsets: Vec<f64>,
    pub beam_inset: f64,
    pub crush_damage: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpGateDialog {
    pub greeting: Vec<String>,
    pub arrival: Vec<String>,
    pub access_granted: Vec<String>,
    pub access_pending: Vec<String>,
    pub closing: Vec<String>,
    pub closing_interrupted: Vec<String>,
    pub recovery: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavBeacon {
    pub name: String,
    pub mass: f64,
    pub radius: f64,
    pub hull_segments: Vec<HullSegment>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Portal {
    pub pull_duration: f64,
    pub transit_scale_duration: f64,
    pub arrival_hold_duration: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Wormhole {
    pub radius: f64,
    pub travel_radius: f64,
}
