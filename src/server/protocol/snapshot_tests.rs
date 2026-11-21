use crate::specs::Catalog;
use std::collections::HashMap;

use super::*;
use crate::protocol::snapshot_fixture::{
    edge_snapshot, field, full_snapshot, module_snapshots, point,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn recorded_packets() -> Result<HashMap<String, String>, serde_json::Error> {
    // Fixed wire recordings for byte-for-byte comparison.
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/snapshots.json"
    )))
}

#[test]
fn full_snapshot_matches_go_recording() -> TestResult {
    assert_eq!(
        full_snapshot(&Catalog::load()?)?,
        recorded_packets()?["snapshot"]
    );
    Ok(())
}

#[test]
fn exceptional_motion_and_module_values_match_go_recording() -> TestResult {
    assert_eq!(
        edge_snapshot(&Catalog::load()?)?,
        recorded_packets()?["edge"]
    );
    Ok(())
}

#[test]
fn module_replication_matches_go_recording() -> TestResult {
    let expected = recorded_packets()?;
    for (key, packet) in module_snapshots(&Catalog::load()?)? {
        assert_eq!(packet, expected[key], "{key}");
    }
    Ok(())
}

#[test]
fn palette_indices_and_revision_masks_cover_all_modules() -> TestResult {
    let catalog = Catalog::load()?;
    let palettes = &catalog.protocol.module_palettes;
    let mut bytes = Vec::new();

    for (index, shades) in palettes.iter().enumerate() {
        bytes.clear();
        let values = [ModuleState {
            r#type: 12.0,
            mount: -1.0,
            id: Some(-1458.0),
            shades: Some(shades),
            segments: &[ModuleSegment {
                active: 1.0,
                activation_progress: 0.5,
            }],
            ..Default::default()
        }];
        Writer { data: &mut bytes }.modules(&values, palettes, None)?;
        let mut expected = vec![2, 5, 24, 1, 0xe3, 0x16, index as u8, 1, 9];
        expected.extend_from_slice(&0.5_f64.to_le_bytes());
        assert_eq!(bytes, expected);
    }

    let values = [ModuleState {
        id: Some(-1.0),
        shades: Some(&catalog.colors["red"]),
        ..Default::default()
    }; 10];
    let delta = ModuleDelta {
        revisions: &[2, 6, 2, 2, 2, 2, 2, 2, 7, 2],
        shade_revisions: &[2, 6, 2, 2, 2, 2, 2, 2, 2, 2],
        baseline: 5,
        layout_revision: 3,
    };

    bytes.clear();
    Writer { data: &mut bytes }.modules(&values, palettes, Some(delta))?;
    assert_eq!(bytes, [21, 2, 1, 5, 0, 0, 1, 0, 0, 129, 0, 0, 1, 0]);

    bytes.clear();
    let stale = ModuleDelta {
        baseline: 2,
        ..delta
    };
    Writer { data: &mut bytes }.modules(&values, palettes, Some(stale))?;
    assert_eq!(bytes[0], 20);

    let modules = [ModuleState {
        r#type: ((1_u64 << 52) as f64),
        ..Default::default()
    }];
    assert_eq!(
        Writer { data: &mut bytes }.modules(&modules, palettes, None),
        Err(ProtocolError::Snapshot)
    );
    let invalid = ["invalid".to_owned()];
    let modules = [ModuleState {
        shades: Some(&invalid),
        ..Default::default()
    }];
    assert_eq!(
        Writer { data: &mut bytes }.modules(&modules, palettes, None),
        Err(ProtocolError::Snapshot)
    );
    Ok(())
}

#[test]
fn motion_packing_and_control_values_preserve_float_bits() -> TestResult {
    let catalog = Catalog::load()?;
    let ids = &catalog.protocol;
    let f = &ids.binary_field_ids;
    let mut bytes = Vec::new();

    for value in [
        0.0,
        -0.0,
        1.0,
        -1.0,
        2.0_f64.powi(-24),
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NAN,
    ] {
        bytes.clear();
        assert!(Writer { data: &mut bytes }.motion_field(f.spin, FieldData::Number(value), ids));
        assert_eq!(bytes[0], (f.packed_spin << 1) as u8);
        assert_eq!(bytes[1..], value.to_le_bytes()[3..]);
    }

    bytes.clear();
    let vector = Vector {
        x: -3000.25,
        y: -0.0,
    };
    assert!(Writer { data: &mut bytes }.motion_field(f.position, FieldData::Point(vector), ids));
    assert_eq!(bytes[0], (f.packed_position << 1) as u8);
    assert_eq!(bytes[1..7], vector.x.to_le_bytes()[2..]);
    assert_eq!(bytes[7..13], vector.y.to_le_bytes()[2..]);

    bytes.clear();
    let mut writer = Writer { data: &mut bytes };
    assert!(!writer.motion_field(f.position, point(1.1, 2.0), ids));
    assert!(!writer.motion_field(f.spin, FieldData::Number(1.1), ids));
    assert!(!writer.motion_field(f.spin, FieldData::Number(f64::from_bits(1)), ids));
    assert!(bytes.is_empty());

    for (value, code) in [(0.0, 0), (1.0, 1), (-1.0, 2), (0.4, 3), (f64::INFINITY, 3)] {
        bytes.clear();
        append_field(&mut bytes, f.turn, FieldData::Number(value), ids)?;
        assert_eq!(bytes[0], code);
        if code == 3 {
            assert_eq!(bytes[1..], value.to_le_bytes());
        } else {
            assert_eq!(bytes.len(), 1);
        }
    }
    Ok(())
}

#[test]
fn snapshot_strings_preserve_utf16_and_reuse_capacity() {
    let mut actual = Vec::with_capacity(2048);

    for value in [
        "",
        "Pirate",
        "#ff00aa",
        "\0\x7f",
        "Ångström 中文",
        "🚀𐀀\u{ffff}",
        &"gold".repeat(100),
    ] {
        actual.clear();
        let units: Vec<_> = value.encode_utf16().collect();
        let mut expected = Vec::new();
        Writer {
            data: &mut expected,
        }
        .unsigned(units.len() as u64);
        for unit in units {
            expected.extend_from_slice(&unit.to_le_bytes());
        }

        let allocation = actual.as_ptr();
        Writer { data: &mut actual }.string(value);
        assert_eq!(actual, expected);
        assert_eq!(actual.as_ptr(), allocation);
    }
}

#[test]
fn failed_append_leaves_previous_records_intact() -> TestResult {
    let catalog = Catalog::load()?;
    let f = &catalog.protocol.binary_field_ids;
    let values = [field(f.kind, FieldData::Text("missing kind"))];
    let record = EntityRecord {
        id: 1,
        values: &values,
    };
    let mut arena = vec![1, 2, 3];
    let result = append_entity_record_delta(&mut arena, &record, &catalog.protocol, None);

    assert_eq!(result, Err(ProtocolError::Snapshot));
    assert_eq!(arena, [1, 2, 3]);
    Ok(())
}
