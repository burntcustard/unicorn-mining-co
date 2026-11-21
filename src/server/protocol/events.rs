use super::Vector;

#[derive(Debug, Clone, PartialEq)]
pub enum SimulationEvent {
    ObjectDestroyed {
        object_id: i64,
        color: String,
        damage: f64,
        position: Vector,
    },
    AsteroidSplit {
        asteroid_id: i64,
        child_ids: Vec<i64>,
    },
    AsteroidDestroyed {
        asteroid_id: i64,
        by: i64,
        contents: Vec<i32>,
    },
    DrillDamage {
        target_id: i64,
        by: i64,
        damage: f64,
        color: String,
        resource: Option<i32>,
        position: Vector,
    },
    LaserDamage {
        target_id: i64,
        by: i64,
        damage: f64,
        color: String,
        position: Vector,
    },
    CollisionEvent {
        // Weapon ownership survives removal of the projectile.
        by: i64,
        shield: [bool; 2],
        a: i64,
        b: i64,
        impact: f64,
        colors: [String; 2],
        damage: [f64; 2],
        position: Vector,
    },
    ItemCollected {
        by: i64,
        item_id: i64,
        message: Option<String>,
        resource: i32,
        unlock: Option<String>,
    },
    Docked {
        player_id: i64,
        docked_to: i64,
    },
    ModuleChanged {
        module: String,
        player_id: i64,
        active: bool,
    },
}
