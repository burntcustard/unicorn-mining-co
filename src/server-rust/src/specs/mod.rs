//! Validated game data generated from the same TypeScript specs as the client.

mod craft;
mod npc;
mod objects;
mod protocol;
mod simulation;
mod world_generation;

use std::collections::HashMap;
use std::error::Error;
use std::fmt;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

pub use crate::vector::Vector;
pub use craft::{
    Booster, CargoGeometry, CargoStock, DrillTip, HullSegment, InitialModule, ModelPart, Module,
    MountPoint, Projectile, ProjectileExplosion, Ship, ShipOffer, Station,
};
pub use npc::{Collector, CollectorDialog, Marauder, NpcMovement, Pirate, PirateDialog};
pub use objects::{Item, JumpGate, JumpGateDialog, NavBeacon, Portal, Wormhole};
pub use protocol::{BinaryFields, Protocol};
pub use simulation::{
    AsteroidDebris, Flight, Motion, Physics, Replication, Simulation, UpdateTier,
};
pub use world_generation::{
    DensityFalloff, FeatureSpecification, RegionGeneration, SectorGeneration,
};

#[allow(
    clippy::approx_constant,
    reason = "literals come from the TypeScript specs"
)]
mod constants {
    include!(concat!(env!("OUT_DIR"), "/spec_constants.rs"));
}

pub use constants::*;

pub type Point = [f64; 2];

const CATALOG_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/catalog.json"));

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub marauder_spec: Marauder,
    pub npc_movement: NpcMovement,
    pub pirate_spec: Pirate,
    pub collector_spec: Collector,
    pub collector_dialog: CollectorDialog,
    pub jump_gate_dialog: JumpGateDialog,
    pub pirate_dialog: PirateDialog,
    pub station_module_ids: Vec<String>,
    pub portal_spec: Portal,
    pub jump_gate_spec: JumpGate,
    pub wormhole_spec: Wormhole,
    pub nav_beacon_spec: NavBeacon,
    pub jump_gate_hull: Vec<HullSegment>,
    pub sector_names: Vec<String>,
    pub sector_generation: SectorGeneration,
    pub starting_sector_id: String,
    pub starting_credits: f64,
    pub colors: HashMap<String, Vec<String>>,
    pub paint_colors: Vec<Vec<String>>,
    pub item_defaults: HashMap<String, f64>,
    pub item_ids: Vec<String>,
    pub item_specs: HashMap<String, Item>,
    pub module_ids: Vec<String>,
    pub module_specs: HashMap<String, Arc<Module>>,
    #[serde(skip)]
    module_wire_indices: hashbrown::HashMap<String, usize>,
    pub ship_specs: HashMap<String, Ship>,
    pub station_specs: HashMap<String, Station>,
    pub protocol: Protocol,
    pub simulation: Simulation,
    pub region_generation: RegionGeneration,
}

#[derive(Debug)]
pub enum CatalogError {
    Json(serde_json::Error),
    MissingModule(String),
    MissingItem(String),
    InvalidSimulationStep,
}

impl fmt::Display for CatalogError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(error) => write!(formatter, "invalid spec catalog: {error}"),
            Self::MissingModule(id) => write!(formatter, "missing module {id:?}"),
            Self::MissingItem(id) => write!(formatter, "missing item {id:?}"),
            Self::InvalidSimulationStep => write!(formatter, "invalid simulation step"),
        }
    }
}

impl Error for CatalogError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Json(error) => Some(error),
            _ => None,
        }
    }
}

impl Catalog {
    pub fn load() -> Result<Self, CatalogError> {
        let mut catalog: Self = serde_json::from_str(CATALOG_JSON).map_err(CatalogError::Json)?;

        for id in &catalog.module_ids {
            if !catalog.module_specs.contains_key(id) {
                return Err(CatalogError::MissingModule(id.clone()));
            }
        }

        for id in &catalog.item_ids {
            if !catalog.item_specs.contains_key(id) {
                return Err(CatalogError::MissingItem(id.clone()));
            }
        }

        if catalog.simulation.simulation_step <= 0.0 {
            return Err(CatalogError::InvalidSimulationStep);
        }
        catalog.module_wire_indices.extend(
            catalog
                .module_ids
                .iter()
                .enumerate()
                .map(|(index, id)| (id.clone(), index)),
        );

        Ok(catalog)
    }

    pub(crate) fn module_wire_index(&self, id: &str) -> Option<usize> {
        self.module_wire_indices.get(id).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::{Catalog, LINEAR_SLOP, MAX_ROTATION, Module};

    #[test]
    fn generated_catalog_loads() -> Result<(), Box<dyn std::error::Error>> {
        let catalog = Catalog::load()?;

        assert!(catalog.sector_generation.enabled_count <= catalog.sector_names.len());
        assert!(
            catalog
                .module_ids
                .iter()
                .all(|id| catalog.module_specs.contains_key(id))
        );
        for (index, id) in catalog.item_ids.iter().enumerate() {
            assert_eq!(usize::try_from(catalog.item_specs[id].resource)?, index);
        }
        assert_eq!(catalog.simulation.linear_slop, LINEAR_SLOP);
        assert_eq!(catalog.simulation.physics.max_rotation, MAX_ROTATION);

        Ok(())
    }

    #[test]
    fn optional_module_values_preserve_explicit_zero_and_false() -> serde_json::Result<()> {
        let module: Module = serde_json::from_str(
            r#"{"ammo":0,"zIndex":0,"friction":0,"model":[{},{"wreckage":false}]}"#,
        )?;

        assert_eq!(module.ammo, Some(0));
        assert_eq!(module.z_index, Some(0));
        assert_eq!(module.friction, Some(0.0));
        assert_eq!(module.bounciness, None);
        assert_eq!(module.model[0].wreckage, None);
        assert_eq!(module.model[1].wreckage, Some(false));

        Ok(())
    }
}
