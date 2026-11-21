use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Input {
    pub target_id: Option<i64>,
    pub horn_drill: bool,
    pub cargo_hatch: bool,
    pub search_light: bool,
    pub shield_generator: bool,
    pub launch: bool,
    pub fire: bool,
    pub cargo_release: bool,
    pub plasma_active: bool,
    pub autogun_active: bool,
    pub laser_active: bool,
    pub flight_mode: bool,
    pub thrust_boost: bool,
    pub thrust: f64,
    pub turn: f64,
}

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct InputChange {
    pub input: Input,
    pub offset: f64,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct InputFrame {
    pub input: Input,
    pub changes: Vec<InputChange>,
}
