use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpcMovement {
    pub decision_interval: f64,
    pub clearance_distance: f64,
    pub prediction_time: f64,
    pub response_time: f64,
    pub route_lookahead: f64,
    pub replan_distance: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Marauder {
    pub ship: String,
    pub check_interval: f64,
    pub minimum_distance: f64,
    pub spawn_distance: f64,
    pub despawn_distance: f64,
    pub arrival_distance: f64,
    pub combat_distance: f64,
    pub combat_delay: f64,
    pub pass_distance: f64,
    pub firing_distance: f64,
    pub aim_tolerance: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collector {
    pub names: Vec<String>,
    pub ship: String,
    pub operating_radius: f64,
    pub check_interval_min: f64,
    pub check_interval_max: f64,
    pub discovery_interval: f64,
    pub minimum_items: usize,
    pub nearby_item_radius: f64,
    pub launch_interval: f64,
    pub pickup_timeout: f64,
    pub arrival_distance: f64,
    pub inspection_range: f64,
    pub inspection_distance: f64,
    pub inspection_delay: f64,
    pub inspection_duration: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorDialog {
    pub departure: Vec<String>,
    pub cargo_full: Vec<String>,
    pub finished: Vec<String>,
    pub damaged: Vec<String>,
    pub outside_radius: Vec<String>,
    pub stranded: Vec<String>,
    pub unreachable: Vec<String>,
    pub unlisted: Vec<String>,
    pub missing_first: Vec<String>,
    pub missing_second: Vec<String>,
    pub missing_third: Vec<String>,
    pub missing_fourth: Vec<String>,
    pub missing_fifth: Vec<String>,
    pub missing_sixth: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pirate {
    pub names: Vec<String>,
    pub attack_delay: f64,
    pub collect_delay: f64,
    pub demand_delay: f64,
    pub loot_theft_delay: f64,
    pub re_demand_delay: f64,
    pub countdown_from: i32,
    pub countdown_pause: f64,
    pub taunt_interval: f64,
    pub search_duration: f64,
    pub cargo_value_threshold: f64,
    pub dispatch_interval: f64,
    pub encounter_duration: f64,
    pub cargo_release_timeout: f64,
    pub encounter_cooldown: f64,
    pub report_arrival_distance: f64,
    pub starting_credits: f64,
    pub follow_start_distance: f64,
    pub follow_distance: f64,
    pub pass_distance: f64,
    pub firing_distance: f64,
    pub aim_tolerance: f64,
    pub aim_prediction_time: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PirateDialog {
    pub cargo_demand: Vec<String>,
    pub cargo_re_demand: Vec<String>,
    pub loot_stolen: Vec<String>,
    pub cargo_full: Vec<String>,
    pub successful_haul: Vec<String>,
    pub countdown: Vec<String>,
    pub countdown_end: Vec<String>,
    pub attack: Vec<String>,
    pub taunt: Vec<String>,
    pub surrender: Vec<String>,
    pub late_surrender: Vec<String>,
    pub broken_truce: Vec<String>,
    pub defend_loot: Vec<String>,
    pub search: Vec<String>,
    pub lost_player: Vec<String>,
    pub search_expired: Vec<String>,
    pub escaped: Vec<String>,
    pub stranded: Vec<String>,
    pub defeat: Vec<String>,
    pub destroyed: Vec<String>,
}
