use super::Vector;
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WorldSound {
    pub effect: u8,
    pub id: i64,
    pub by: i64,
    pub position: Vector,
}
