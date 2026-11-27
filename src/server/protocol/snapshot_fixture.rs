//! Input records for the fixed snapshot wire packets.

use std::collections::BTreeMap;

use crate::specs::Catalog;
use crate::test_fixtures::hex;

use super::binary_snapshot::SNAPSHOT_NAN;
use super::{
    AsteroidSegment, CargoEntry, EntityRecord, FieldData, FieldValue, ModuleDelta, ModuleSegment,
    ModuleState, ProtocolError, Snapshot, Vector, WreckageSegment, append_entity_record_delta,
    encode_snapshot,
};

pub(super) fn point(x: f64, y: f64) -> FieldData<'static> {
    FieldData::Point(Vector { x, y })
}

pub(super) fn field(id: i32, value: FieldData<'_>) -> FieldValue<'_> {
    FieldValue {
        id,
        value: Some(value),
    }
}

fn sorted_record<'a>(id: u64, values: &'a mut [FieldValue<'a>]) -> EntityRecord<'a> {
    values.sort_unstable_by_key(|field| field.id);
    EntityRecord { id, values }
}

pub(super) fn full_snapshot(catalog: &Catalog) -> Result<String, ProtocolError> {
    use FieldData::*;
    let ids = &catalog.protocol;
    let f = &ids.binary_field_ids;

    let mut item_fields = [
        field(f.kind, Text("item")),
        field(f.resource, Number(5.0)),
        field(f.rounds, Number(137.0)),
        field(f.position, point(1.0, 2.0)),
        field(f.radius, Number(6.0)),
    ];
    let item = sorted_record(25, &mut item_fields);
    let cargo = [CargoEntry::ModuleIndex(2.0), CargoEntry::Entity(item)];

    let shades = ["#fff".into(), "#000".into()];
    let modules = [ModuleState {
        r#type: 12.0,
        mount: 2.0,
        id: Some(-10.0),
        health: Some(20.0),
        fire_cooldown: Some(0.375),
        charge_cooldown: Some(1.125),
        aim_rotation: Some(0.75),
        shades: Some(&catalog.colors["red"]),
        segments: &[ModuleSegment {
            active: 1.0,
            activation_progress: 0.5,
        }],
        ..Default::default()
    }];
    let wreckage_outline = [[0.0, 0.0], [1.0, 1.0]];
    let wreckage_stroke = [vec![[0.0, 0.0], [2.0, 2.0]]];
    let wreckage = [WreckageSegment {
        radius: 8.0,
        offset: Vector { x: 2.0, y: 3.0 },
        health: 4.0,
        shape_outline: Some(&wreckage_outline),
        fill_shade: Some(2.0),
        color: "#fa3",
        stroke: Some(&wreckage_stroke),
    }];
    let mut ship_fields = [
        field(f.kind, Text("ship")),
        field(f.position, point(-1.25, 20.5)),
        field(f.radius, Number(40.0)),
        field(f.rotation, Number(0.25)),
        field(f.spin, Number(-0.5)),
        field(f.velocity, point(3.0, -4.0)),
        field(f.definition_id, Text("testScout")),
        field(f.name, Text("MUSTANG")),
        field(f.hostile, Flag(true)),
        field(f.npc_state, Text("Collecting")),
        field(f.target_label, Text("CUSTOM\nTARGET LABEL")),
        field(f.blocked_beams, Number(10.0)),
        field(f.fuel, Number(3.25)),
        field(f.stored_power, Number(12.5)),
        field(f.transit_time, Number(-1.25)),
        field(f.transit_gate, Number(987.0)),
        field(f.shades, Strings(&shades)),
        field(f.hull_health, Numbers(&[8.0, 20.0, 40.0])),
        field(f.modules, Modules(&modules)),
        field(f.cargo_contents, Cargo(&cargo)),
        field(f.wreckage, Wreckage(&wreckage)),
    ];

    let asteroid_outline = [[-1.0, -1.0], [1.0, -1.0], [0.0, 1.0]];
    let segment_outline = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]];
    let asteroid_segments = [AsteroidSegment {
        contents: &[1.0, 2.0],
        health: 10.0,
        mass: 5.0,
        max_health: 12.0,
        shape_outline: &segment_outline,
    }];
    let mut asteroid_fields = [
        field(f.kind, Text("asteroid")),
        field(f.position, point(300.0, 400.0)),
        field(f.radius, Number(30.0)),
        field(f.resource, Number(2.0)),
        field(f.contents, Numbers(&[0.0, 2.0])),
        field(f.shape_outline, Outline(&asteroid_outline)),
        field(f.segments, Segments(&asteroid_segments)),
        FieldValue {
            id: f.message,
            value: None,
        },
    ];
    let mut projectile_fields = [
        field(f.kind, Text("projectile")),
        field(f.definition_id, Text("autogun")),
        field(f.player_number, Number(1.0)),
        field(f.health, Number(1.25)),
        field(f.position, point(5.0, 3.0)),
        field(f.velocity, point(600.0, 0.0)),
    ];
    let mut beacon_fields = [
        field(f.kind, Text("navBeacon")),
        field(f.position, point(100.0, 200.0)),
        field(f.rotation, Number(0.25)),
    ];
    let records = [
        sorted_record(7, &mut ship_fields),
        sorted_record(9, &mut asteroid_fields),
        sorted_record(11, &mut projectile_fields),
        sorted_record(13, &mut beacon_fields),
    ];
    let snapshot = Snapshot {
        tick: 42,
        next_entity_id: 100,
        ack: Some(9),
        input_lead: Some(-2),
        sequence: Some(10),
        membership_changed: true,
        entity_ids: &[7, 9, 11, 13],
        asteroid_positions: Some(&[Vector { x: -2999.0, y: 2.0 }, Vector { x: 2999.0, y: 3.0 }]),
        records: &records,
        ..Default::default()
    };

    encode_snapshot(&snapshot, ids).map(|bytes| hex(&bytes))
}

pub(super) fn edge_snapshot(catalog: &Catalog) -> Result<String, ProtocolError> {
    use FieldData::*;
    let ids = &catalog.protocol;
    let f = &ids.binary_field_ids;
    let boundary = ((1_u64 << 52) - 1) as f64;
    let modules = [
        ModuleState {
            r#type: 12.0,
            mount: -1.0,
            id: Some(-1458.0),
            health: Some(20.0),
            health_activated: Some(12.0),
            fire_cooldown: Some(0.25),
            charge_cooldown: Some(0.75),
            aim_rotation: Some(-0.5),
            shades: Some(&catalog.colors["violet"]),
            segments: &[
                ModuleSegment {
                    active: 0.0,
                    activation_progress: 1.0,
                },
                ModuleSegment {
                    active: -1.0,
                    activation_progress: 0.5,
                },
                ModuleSegment {
                    active: -0.0,
                    activation_progress: f64::INFINITY,
                },
                ModuleSegment {
                    active: SNAPSHOT_NAN,
                    activation_progress: f64::NEG_INFINITY,
                },
            ],
        },
        ModuleState {
            r#type: boundary,
            mount: -boundary,
            id: Some(boundary),
            ..Default::default()
        },
    ];
    let mut fields = [
        field(f.position, point(1.1, 2.2)),
        field(f.velocity, point(-0.0, f64::INFINITY)),
        field(f.rotation, Number(SNAPSHOT_NAN)),
        field(f.spin, Number(f64::NEG_INFINITY)),
        field(f.modules, Modules(&modules)),
    ];
    let records = [sorted_record(1, &mut fields)];
    let snapshot = Snapshot {
        tick: 42,
        next_entity_id: 2,
        records: &records,
        ..Default::default()
    };
    encode_snapshot(&snapshot, ids).map(|bytes| hex(&bytes))
}

pub(super) fn module_snapshots(
    catalog: &Catalog,
) -> Result<BTreeMap<&'static str, String>, ProtocolError> {
    use FieldData::*;
    let ids = &catalog.protocol;
    let f = &ids.binary_field_ids;

    let stationary = [ModuleSegment {
        active: 1.0,
        activation_progress: 0.0,
    }];
    let painted_segment = [ModuleSegment {
        active: 1.0,
        activation_progress: 0.25,
    }];
    let animated_segment = [ModuleSegment {
        active: 1.0,
        activation_progress: 0.75,
    }];
    let cleared_segment = [ModuleSegment {
        active: 1.0,
        activation_progress: 0.5,
    }];

    let module = |id, shades, segments| ModuleState {
        id: Some(id),
        r#type: 1.0,
        mount: id,
        shades,
        segments,
        ..Default::default()
    };
    let initial = [
        module(1.0, Some(catalog.colors["red"].as_slice()), &stationary),
        module(2.0, None, &stationary),
        module(3.0, Some(&catalog.colors["orange"]), &stationary),
    ];
    let mut painted = initial;
    painted[1] = module(2.0, Some(&catalog.colors["violet"]), &painted_segment);
    let mut animated = painted;
    animated[0].segments = &animated_segment;
    let mut cleared = animated;
    cleared[1] = module(2.0, None, &cleared_segment);

    let pack = |modules, delta, load| {
        let values = [field(f.modules, Modules(modules))];
        let record = EntityRecord {
            id: 7,
            values: &values,
        };
        let mut fragment = Vec::new();
        append_entity_record_delta(&mut fragment, &record, ids, delta)?;

        encode_snapshot(
            &Snapshot {
                load,
                fragments: Some(&[&fragment]),
                ..Default::default()
            },
            ids,
        )
    };
    let paint_delta = ModuleDelta {
        revisions: &[10, 11, 10],
        shade_revisions: &[10, 11, 10],
        baseline: 10,
        layout_revision: 9,
    };
    let animation_delta = ModuleDelta {
        revisions: &[12, 11, 10],
        baseline: 11,
        ..paint_delta
    };
    let stale_delta = ModuleDelta {
        baseline: 10,
        ..animation_delta
    };
    let clear_delta = ModuleDelta {
        revisions: &[12, 13, 10],
        shade_revisions: &[10, 13, 10],
        baseline: 12,
        layout_revision: 9,
    };
    let mut packets = BTreeMap::new();
    let reentry = [animated[2], animated[0]];
    for (key, packet) in [
        ("moduleLoad", pack(&initial, None, true)?),
        ("modulePaint", pack(&painted, Some(paint_delta), false)?),
        (
            "moduleAnimation",
            pack(&animated, Some(animation_delta), false)?,
        ),
        ("moduleStale", pack(&animated, Some(stale_delta), false)?),
        ("moduleClear", pack(&cleared, Some(clear_delta), false)?),
        ("moduleReentry", pack(&reentry, None, true)?),
    ] {
        packets.insert(key, hex(&packet));
    }

    let cargo_modules = [field(f.modules, Modules(&painted))];
    let contents = [CargoEntry::Entity(EntityRecord {
        id: 9,
        values: &cargo_modules,
    })];
    let cargo = [field(f.cargo_contents, Cargo(&contents))];
    let record = EntityRecord {
        id: 8,
        values: &cargo,
    };
    let mut fragment = Vec::new();
    append_entity_record_delta(&mut fragment, &record, ids, Some(stale_delta))?;
    let packet = encode_snapshot(
        &Snapshot {
            fragments: Some(&[&fragment]),
            ..Default::default()
        },
        ids,
    )?;
    packets.insert("moduleCargo", hex(&packet));
    Ok(packets)
}
