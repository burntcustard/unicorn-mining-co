mod binary_control;
mod binary_snapshot;
mod events;
mod input_frame;
mod regions;
#[cfg(any(test, feature = "test-fixtures"))]
pub mod snapshot_fixture;
mod sounds;
mod wire;

pub use binary_control::{
    Control, DockAction, MapMarker, ServerControl, decode_client_control, encode_server_control,
    valid_display_name,
};
pub use binary_snapshot::{
    AsteroidSegment, AsteroidSplice, CargoEntry, EntityRecord, FieldData, FieldValue, ModuleDelta,
    ModuleSegment, ModuleState, Snapshot, WreckageSegment, append_entity_record_delta,
    append_field, append_snapshot, encode_snapshot,
};
pub(crate) use binary_snapshot::{
    StationStockUpdate, StockEntry, append_snapshot_fragments, encode_stock_entry,
};
pub use events::SimulationEvent;
pub use input_frame::{Input, InputChange, InputFrame};
pub use regions::{
    AsteroidDescription, FieldDescription, LoadedRegion, RegionDescription, RegionalView,
    StationDescription, WorldRanges, WreckDescription,
};
pub use sounds::WorldSound;
pub(crate) use wire::parse_uuid;

pub use crate::utilities::vector::Vector;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolError {
    Control,
    Snapshot,
}

impl std::fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Control => "invalid binary control",
            Self::Snapshot => "invalid binary snapshot",
        })
    }
}

impl std::error::Error for ProtocolError {}
