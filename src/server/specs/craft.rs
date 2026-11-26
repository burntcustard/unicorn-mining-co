use serde::{Deserialize, Serialize};

use super::{Point, Vector};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ModelPart {
    pub mirror_with_mount: bool,
    pub wreckage: Option<bool>,
    pub wreckage_color: String,
    pub outline: Option<bool>,
    pub catches: bool,
    pub thruster_nozzle_side: f64,
    pub color: String,
    pub points: Vec<Point>,
    pub radius: f64,
    pub covers: bool,
    pub turret_base: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectileExplosion {
    pub radius: f64,
    pub impulse: f64,
    pub max_speed: f64,
    pub damage: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Projectile {
    pub speed: f64,
    pub lifetime: f64,
    pub fade_out: f64,
    pub radius: f64,
    pub color: String,
    pub explosion: Option<ProjectileExplosion>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Booster {
    pub multiplier: f64,
    pub duration: f64,
    pub ramp_duration: f64,
    pub cooldown: f64,
    pub recharge: f64,
    pub charges: i32,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrillTip {
    pub position: Vector,
    pub radius: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CargoGeometry {
    #[serde(default)]
    pub paired: bool,
    pub length: f64,
    pub open_angle: f64,
    pub door_width: f64,
    pub door_radius: f64,
    pub opening_threshold: f64,
    pub throat_radius: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Module {
    pub booster: Option<Booster>,
    pub flight_boost: f64,
    pub power_capacity: f64,
    pub fuel_usage: f64,
    pub power_generated: f64,
    pub power: f64,
    pub power_activated: f64,
    pub power_charging: f64,
    pub power_firing: f64,
    pub discharge_duration: f64,
    pub charge_duration: f64,
    pub telescoping: bool,
    pub retraction_distance: f64,
    pub fire_interval: f64,
    pub recoil: f64,
    pub projectile: Projectile,
    pub ammo: Option<i32>,
    pub barrel_length: f64,
    pub aim_limit: f64,
    pub turret: bool,
    pub turret_turn_rate: f64,
    pub model: Vec<ModelPart>,
    pub behavior: String,
    pub name: String,
    pub health: f64,
    pub price: f64,
    pub mass: f64,
    pub z_index: Option<i32>,
    pub shades: Option<Vec<String>>,
    pub activation_duration: f64,
    pub activation_threshold: f64,
    pub bounciness: Option<f64>,
    pub friction: Option<f64>,
    pub damage: f64,
    pub damage_steps_per_second: f64,
    pub grip_decay: f64,
    pub grip_scale: f64,
    pub disable_physics: bool,
    pub collision_margin: Option<f64>,
    pub forward_thrust: f64,
    pub rotational_thrust: f64,
    pub offset: f64,
    pub grinds: bool,
    pub reach: f64,
    pub spread: f64,
    pub corner: f64,
    pub shield_radius: f64,
    pub cover_duration: f64,
    pub health_activated: Option<f64>,
    pub recharge_duration: f64,
    pub drill_tip: DrillTip,
    pub cargo_geometry: CargoGeometry,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MountPoint {
    pub cargo_pickup_offset: Option<f64>,
    #[serde(default)]
    pub thruster_offset: f64,
    pub x: f64,
    pub y: f64,
    pub fits: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HullSegment {
    pub flight_offset: Option<Point>,
    pub collision_parts: Option<Vec<Vec<Point>>>,
    pub connections: Option<Vec<usize>>,
    pub essential: bool,
    pub side: f64,
    pub disable_physics: bool,
    pub dock_segment: bool,
    pub shades: Option<Vec<String>>,
    pub z_index: Option<i32>,
    pub health: Option<f64>,
    pub points: Vec<Point>,
    pub core: bool,
    pub mounts: Vec<Vec<MountPoint>>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialModule {
    pub shades: Option<Vec<String>>,
    pub mount: usize,
    pub module: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ship {
    pub weapon_retraction_distance: Option<f64>,
    pub price: f64,
    pub fuel_capacity: f64,
    pub initial_loadout: Vec<InitialModule>,
    pub name: String,
    pub cargo_space: usize,
    pub drag: f64,
    pub hull_mass: f64,
    pub angular_thrust: f64,
    pub radius: f64,
    pub turn_rate: f64,
    pub hull_segments: Vec<HullSegment>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ShipOffer {
    pub ship: String,
    pub price: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct CargoStock {
    pub item: String,
    pub count: usize,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    pub ships_for_sale: Vec<ShipOffer>,
    pub name: String,
    pub initial_cargo_contents: Vec<CargoStock>,
    pub docking_bays: Vec<f64>,
    pub local_movement_radius: f64,
    pub mass: f64,
    pub z_index: i32,
    pub hull_segments: Vec<HullSegment>,
}
