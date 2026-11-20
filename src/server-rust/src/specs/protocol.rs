use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Protocol {
    pub module_palettes: Vec<Vec<String>>,
    pub binary_field_ids: BinaryFields,
    pub control_message_ids: HashMap<String, i32>,
    pub dock_action_ids: HashMap<String, i32>,
    pub entity_kind_ids: HashMap<String, i32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryFields {
    pub packed_position: i32,
    pub packed_velocity: i32,
    pub packed_rotation: i32,
    pub packed_spin: i32,
    pub npc_state: i32,
    pub hostile: i32,
    pub blocked_beams: i32,
    pub target_label: i32,
    pub transit_time: i32,
    pub transit_gate: i32,
    pub opening: i32,
    pub opening_target: i32,
    pub destination_name: i32,
    pub firing: i32,
    pub fuel: i32,
    pub stored_power: i32,
    pub rounds: i32,
    pub definition_id: i32,
    pub cargo_contents: i32,
    pub contents: i32,
    pub decay: i32,
    pub friction: i32,
    pub docked_to: i32,
    pub health: i32,
    pub hull_health: i32,
    pub kind: i32,
    pub name: i32,
    pub launching: i32,
    pub mass: i32,
    pub message: i32,
    pub pending_update_time: i32,
    pub max_speed: i32,
    pub max_health: i32,
    pub modules: i32,
    pub wreckage: i32,
    pub shape_outline: i32,
    pub paint: i32,
    pub shades: i32,
    pub player_id: i32,
    pub point_count: i32,
    pub position: i32,
    pub radius: i32,
    pub radius_even: i32,
    pub resource: i32,
    pub rotation: i32,
    pub spin: i32,
    pub segments: i32,
    pub thrust: i32,
    pub turn: i32,
    pub velocity: i32,
}
