//! Shared inputs for the Rust executables used by TypeScript parity tests.

use std::collections::HashMap;
use std::error::Error;
use std::fmt::Write;
use std::sync::Arc;

use serde::Deserialize;

use crate::objects::ship::Ship;
use crate::protocol::ProtocolError;
use crate::replication::snapshot_writer::{SnapshotBatch, SnapshotMetadata, SnapshotWriter};
use crate::replication::{ObserverSelection, ReplicationView, SelectOptions};
use crate::simulation::world::World;
use crate::specs::{Catalog, Item, Module};
use crate::utilities::vector::Vector;

#[cfg(test)]
pub(crate) fn assert_json(
    actual: &serde_json::Value,
    expected: &serde_json::Value,
    tolerance: f64,
    path: &str,
) {
    use serde_json::Value;

    match expected {
        Value::Number(expected) => {
            let wanted = expected.as_f64().expect("JSON number");
            let actual = actual
                .as_f64()
                .unwrap_or_else(|| panic!("{path}: expected a number, found {actual}"));
            assert!(
                (actual - wanted).abs() <= tolerance,
                "{path}: {actual} != {wanted}"
            );
        }
        Value::Array(expected) => {
            let actual = actual
                .as_array()
                .unwrap_or_else(|| panic!("{path}: expected an array, found {actual}"));
            assert_eq!(actual.len(), expected.len(), "{path}: array length");
            for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
                assert_json(actual, expected, tolerance, &format!("{path}[{index}]"));
            }
        }
        Value::Object(expected) => {
            let actual = actual
                .as_object()
                .unwrap_or_else(|| panic!("{path}: expected an object, found {actual}"));
            assert_eq!(actual.len(), expected.len(), "{path}: number of fields");
            for (name, expected) in expected {
                let actual = actual
                    .get(name)
                    .unwrap_or_else(|| panic!("{path}.{name}: missing field"));
                assert_json(actual, expected, tolerance, &format!("{path}.{name}"));
            }
        }
        _ => assert_eq!(actual, expected, "{path}"),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExampleSpecs {
    item_specs: HashMap<String, Item>,
    module_specs: HashMap<String, Arc<Module>>,
}

/// Apply the existing example overrides while retaining the real wire slots.
pub fn load_example_catalog() -> Result<Catalog, Box<dyn Error>> {
    let mut catalog = Catalog::load()?;
    let examples: ExampleSpecs = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/support/example-modules.json"
    )))?;
    catalog.item_specs.extend(examples.item_specs);
    catalog.module_specs.extend(examples.module_specs);
    Ok(catalog)
}

pub fn hex(data: &[u8]) -> String {
    let mut hex = String::with_capacity(data.len() * 2);
    for byte in data {
        write!(&mut hex, "{byte:02x}").expect("write to string");
    }
    hex
}

pub fn decode_hex(packet: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    if !packet.len().is_multiple_of(2) || !packet.bytes().all(|digit| digit.is_ascii_hexdigit()) {
        return Err("invalid hexadecimal input packet".into());
    }
    (0..packet.len())
        .step_by(2)
        .map(|start| u8::from_str_radix(&packet[start..start + 2], 16).map_err(Into::into))
        .collect()
}

pub fn update_ship_modules(ship: &mut Ship, duration: f64) {
    ship.craft.update_modules(duration, 1.0, Some(0));
}

pub struct FixtureReplication {
    view: ReplicationView,
    selection: ObserverSelection,
    writer: SnapshotWriter,
    batch: SnapshotBatch,
}

impl Default for FixtureReplication {
    fn default() -> Self {
        Self {
            view: ReplicationView::default(),
            selection: ObserverSelection::new(true),
            writer: SnapshotWriter::default(),
            batch: SnapshotBatch::default(),
        }
    }
}

impl FixtureReplication {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn packet(
        &mut self,
        world: &mut World,
        owned_id: i64,
        load: bool,
    ) -> Result<String, ProtocolError> {
        let catalog = Arc::clone(&world.catalog);
        world.replication_view(&mut self.view);
        self.batch.begin();
        let selection = self.selection.select(
            &mut self.view,
            &catalog.simulation,
            SelectOptions {
                tick: world.tick,
                load,
                players: world.players().count(),
                position: Vector::ZERO,
                owned: owned_id,
                force_update: &[],
            },
        );
        let metadata = SnapshotMetadata {
            load,
            tick: world.tick,
            next_entity_id: world.ids.next_entity as u64,
            ..SnapshotMetadata::default()
        };
        let packet = self.writer.encode(
            selection,
            metadata,
            &mut self.batch,
            &catalog.protocol,
            world,
        )?;
        Ok(hex(packet))
    }
}
