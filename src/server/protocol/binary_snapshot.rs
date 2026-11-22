use std::ops::Range;

use crate::specs::{Point, Protocol};

use super::wire::{MAX_SAFE_INTEGER, Writer};
use super::{ProtocolError, Vector};

const HEADER: [u8; 3] = [0x55, 0x4d, 1];
// Match the NaN payload used by the original encoder to represent absent numbers.
pub(super) const SNAPSHOT_NAN: f64 = f64::from_bits(0x7ff8_0000_0000_0001);

#[derive(Debug, Default, Clone, Copy)]
pub struct ModuleState<'a> {
    pub r#type: f64,
    pub mount: f64,
    pub id: Option<f64>,
    pub health: Option<f64>,
    pub health_activated: Option<f64>,
    pub fire_cooldown: Option<f64>,
    pub charge_cooldown: Option<f64>,
    pub aim_rotation: Option<f64>,
    pub shades: Option<&'a [String]>,
    pub segments: &'a [ModuleSegment],
}

#[derive(Debug, Default, Clone, Copy)]
pub struct ModuleSegment {
    pub active: f64,
    pub activation_progress: f64,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct WreckageSegment<'a> {
    pub color: &'a str,
    pub radius: f64,
    pub offset: Vector,
    pub health: f64,
    pub shape_outline: Option<&'a [Point]>,
    pub fill_shade: Option<f64>,
    pub stroke: Option<&'a [Vec<Point>]>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct AsteroidSegment<'a> {
    pub contents: &'a [f64],
    pub health: f64,
    pub mass: f64,
    pub max_health: f64,
    pub shape_outline: &'a [Point],
}

#[derive(Debug, Clone, Copy)]
pub enum CargoEntry<'a> {
    ModuleIndex(f64),
    Entity(EntityRecord<'a>),
}

#[derive(Debug, Clone, Copy)]
pub enum FieldData<'a> {
    Number(f64),
    Numbers(&'a [f64]),
    Flag(bool),
    Point(Vector),
    Text(&'a str),
    Strings(&'a [String]),
    Outline(&'a [Point]),
    Modules(&'a [ModuleState<'a>]),
    Wreckage(&'a [WreckageSegment<'a>]),
    Segments(&'a [AsteroidSegment<'a>]),
    Cargo(&'a [CargoEntry<'a>]),
    Encoded(&'a [u8]),
}

#[derive(Debug, Clone, Copy)]
pub struct FieldValue<'a> {
    pub id: i32,
    /// An absent value clears this field on the client.
    pub value: Option<FieldData<'a>>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct EntityRecord<'a> {
    pub id: u64,
    /// Values in replication order.
    pub values: &'a [FieldValue<'a>],
}

#[derive(Debug, Clone, Copy)]
pub struct AsteroidSplice<'a> {
    pub start: usize,
    pub delete_count: usize,
    pub positions: &'a [Vector],
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct StationStockUpdate<'a> {
    pub station_id: u64,
    pub replace: bool,
    pub removed_ids: &'a [u64],
    pub entries: &'a [&'a [u8]],
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Snapshot<'a> {
    pub fragments: Option<&'a [&'a [u8]]>,
    pub load: bool,
    pub membership_changed: bool,
    pub tick: u64,
    pub next_entity_id: u64,
    pub ack: Option<u64>,
    pub sequence: Option<u64>,
    pub dock_sequence: Option<u64>,
    pub credits: Option<f64>,
    pub dock_ids: &'a [[i64; 2]],
    pub input_lead: Option<i64>,
    pub entity_ids: &'a [u64],
    pub removed_entity_ids: &'a [u64],
    /// An absent list retains the client's radar positions. An empty list clears them.
    pub asteroid_positions: Option<&'a [Vector]>,
    pub asteroid_splice: Option<AsteroidSplice<'a>>,
    pub(crate) station_stock: Option<&'a StationStockUpdate<'a>>,
    pub records: &'a [EntityRecord<'a>],
}

/// Revisions already received by the observer.
#[derive(Debug, Default, Clone, Copy)]
pub struct ModuleDelta<'a> {
    pub revisions: &'a [i64],
    pub shade_revisions: &'a [i64],
    pub baseline: i64,
    pub layout_revision: i64,
}

// Zigzag encoding must remain an exact JavaScript integer after doubling.
fn compact_integer(value: f64) -> bool {
    let limit = ((1_u64 << 52) - 1) as f64;
    value.to_bits() != (-0.0_f64).to_bits() && value.abs() <= limit && value.fract() == 0.0
}

fn compact_segment(value: f64) -> u8 {
    if value.to_bits() == 0 {
        0
    } else if value == 1.0 {
        1
    } else {
        2
    }
}

impl Writer<'_> {
    fn string(&mut self, value: &str) {
        self.unsigned(value.encode_utf16().count() as u64);

        for unit in value.encode_utf16() {
            self.data.extend_from_slice(&unit.to_le_bytes());
        }
    }

    fn numbers(&mut self, values: &[f64]) {
        self.unsigned(values.len() as u64);
        for &value in values {
            self.number(value);
        }
    }

    fn strings(&mut self, values: &[String]) {
        self.unsigned(values.len() as u64);
        for value in values {
            self.string(value);
        }
    }

    fn outline(&mut self, values: &[Point]) {
        self.unsigned(values.len() as u64);
        for &[x, y] in values {
            self.byte(2);
            self.number(x);
            self.number(y);
        }
    }

    fn modules(
        &mut self,
        values: &[ModuleState<'_>],
        palettes: &[Vec<String>],
        delta: Option<ModuleDelta<'_>>,
    ) -> Result<(), ProtocolError> {
        let delta = delta.filter(|delta| {
            delta.baseline >= delta.layout_revision
                && delta.revisions.len() == values.len()
                && delta.shade_revisions.len() == values.len()
        });
        self.unsigned((values.len() as u64) << 1 | u64::from(delta.is_some()));

        if let Some(delta) = delta {
            for revisions in delta.revisions.chunks(8) {
                let mut mask = 0;
                for (index, &revision) in revisions.iter().enumerate() {
                    if revision > delta.baseline {
                        mask |= 1 << index;
                    }
                }
                self.byte(mask);
            }
        }

        for (index, value) in values.iter().enumerate() {
            if delta.is_some_and(|delta| delta.revisions[index] <= delta.baseline) {
                continue;
            }

            if !compact_integer(value.r#type)
                || !compact_integer(value.mount)
                || value.id.is_some_and(|id| !compact_integer(id))
            {
                return Err(ProtocolError::Snapshot);
            }

            let retain_shades = value.id.is_some()
                && delta.is_some_and(|delta| delta.shade_revisions[index] <= delta.baseline);
            let mut mask = 0;
            if value.id.is_some() {
                mask |= 1;
            }
            if value.health.is_some() {
                mask |= 2;
            }
            if value.shades.is_some() {
                mask |= if retain_shades { 128 } else { 4 };
            }
            if value.fire_cooldown.is_some() {
                mask |= 8;
            }
            if value.charge_cooldown.is_some() {
                mask |= 16;
            }
            if value.health_activated.is_some() {
                mask |= 32;
            }
            if value.aim_rotation.is_some() {
                mask |= 64;
            }

            self.byte(mask);
            self.signed(value.r#type as i64);
            self.signed(value.mount as i64);
            if let Some(id) = value.id {
                self.signed(id as i64);
            }
            if let Some(health) = value.health {
                self.number(health);
            }
            if let Some(shades) = value.shades.filter(|_| !retain_shades) {
                let palette = palettes
                    .iter()
                    .position(|palette| palette == shades)
                    .and_then(|index| u8::try_from(index).ok())
                    .ok_or(ProtocolError::Snapshot)?;
                self.byte(palette);
            }

            for value in [
                value.fire_cooldown,
                value.charge_cooldown,
                value.health_activated,
                value.aim_rotation,
            ]
            .into_iter()
            .flatten()
            {
                self.number(value);
            }

            self.unsigned(value.segments.len() as u64);
            for segment in value.segments {
                let active = compact_segment(segment.active);
                let progress = compact_segment(segment.activation_progress);
                self.byte(active | progress << 2);

                if active == 2 {
                    self.number(segment.active);
                }
                if progress == 2 {
                    self.number(segment.activation_progress);
                }
            }
        }

        Ok(())
    }

    fn wreckage(&mut self, values: &[WreckageSegment<'_>]) {
        self.unsigned(values.len() as u64);
        for value in values {
            let mask = u8::from(value.shape_outline.is_some())
                | u8::from(value.fill_shade.is_some()) << 1
                | u8::from(value.stroke.is_some()) << 2
                | u8::from(!value.color.is_empty()) << 3;
            self.byte(mask);
            self.number(value.radius);
            self.vector(value.offset);
            self.number(value.health);

            if let Some(outline) = value.shape_outline {
                self.outline(outline);
            }
            if let Some(fill_shade) = value.fill_shade {
                self.number(fill_shade);
            }
            if !value.color.is_empty() {
                self.string(value.color);
            }
            if let Some(stroke) = value.stroke {
                self.unsigned(stroke.len() as u64);
                for outline in stroke {
                    self.outline(outline);
                }
            }
        }
    }

    fn segments(&mut self, values: &[AsteroidSegment<'_>]) {
        self.unsigned(values.len() as u64);
        for value in values {
            self.numbers(value.contents);
            self.number(value.health);
            self.number(value.mass);
            self.number(value.max_health);
            self.outline(value.shape_outline);
        }
    }

    fn cargo(
        &mut self,
        values: &[CargoEntry<'_>],
        protocol: &Protocol,
        depth: usize,
    ) -> Result<(), ProtocolError> {
        self.unsigned(values.len() as u64);
        for entry in values {
            match *entry {
                CargoEntry::ModuleIndex(index) => {
                    self.byte(0);
                    self.number(index);
                }
                CargoEntry::Entity(entity) => {
                    self.byte(1);
                    self.record(&entity, protocol, None, depth + 1)?;
                }
            }
        }

        Ok(())
    }

    fn field(
        &mut self,
        id: i32,
        value: FieldData<'_>,
        protocol: &Protocol,
        delta: Option<ModuleDelta<'_>>,
        depth: usize,
    ) -> Result<(), ProtocolError> {
        let fields = &protocol.binary_field_ids;
        match (id, value) {
            (id, FieldData::Encoded(bytes))
                if id == fields.cargo_contents || id == fields.wreckage =>
            {
                self.data.extend_from_slice(bytes);
            }
            (id, FieldData::Number(value)) if id == fields.thrust || id == fields.turn => {
                match value {
                    0.0 => self.byte(0),
                    1.0 => self.byte(1),
                    -1.0 => self.byte(2),
                    _ => {
                        self.byte(3);
                        self.number(value);
                    }
                }
            }
            (id, FieldData::Flag(flag))
                if [fields.firing, fields.hostile, fields.station_marker].contains(&id) =>
            {
                self.byte(u8::from(flag));
            }
            (id, FieldData::Cargo(entries)) if id == fields.cargo_contents => {
                self.cargo(entries, protocol, depth)?;
            }
            (id, FieldData::Wreckage(entries)) if id == fields.wreckage => self.wreckage(entries),
            (id, FieldData::Numbers(values))
                if id == fields.contents || id == fields.hull_health =>
            {
                self.numbers(values);
            }
            (id, FieldData::Modules(values)) if id == fields.modules => {
                self.modules(values, &protocol.module_palettes, delta)?;
            }
            (id, FieldData::Outline(values)) if id == fields.shape_outline => self.outline(values),
            (id, FieldData::Strings(values)) if id == fields.shades => self.strings(values),
            (id, FieldData::Segments(values)) if id == fields.segments => self.segments(values),
            (id, FieldData::Point(point)) if id == fields.position || id == fields.velocity => {
                self.vector(point);
            }
            (id, FieldData::Text(kind)) if id == fields.kind => {
                let tag = protocol
                    .entity_kind_ids
                    .get(kind)
                    .ok_or(ProtocolError::Snapshot)?;
                self.byte(*tag as u8);
            }
            (id, FieldData::Text(name))
                if [
                    fields.name,
                    fields.message,
                    fields.definition_id,
                    fields.destination_name,
                    fields.target_label,
                    fields.npc_state,
                ]
                .contains(&id) =>
            {
                self.string(name);
            }
            (id, FieldData::Number(number))
                if ![
                    fields.firing,
                    fields.hostile,
                    fields.station_marker,
                    fields.cargo_contents,
                    fields.wreckage,
                    fields.contents,
                    fields.hull_health,
                    fields.modules,
                    fields.shape_outline,
                    fields.shades,
                    fields.segments,
                    fields.position,
                    fields.velocity,
                    fields.kind,
                    fields.name,
                    fields.message,
                    fields.definition_id,
                    fields.destination_name,
                    fields.target_label,
                    fields.npc_state,
                ]
                .contains(&id) =>
            {
                self.number(if number.is_finite() {
                    number
                } else {
                    SNAPSHOT_NAN
                });
            }
            _ => return Err(ProtocolError::Snapshot),
        }

        Ok(())
    }

    // Motion rounding often leaves exact zero low bytes in the float64 encoding.
    // Retain all eight bytes for values that do not have those zero bytes.
    fn motion_field(&mut self, id: i32, value: FieldData<'_>, protocol: &Protocol) -> bool {
        let fields = &protocol.binary_field_ids;
        match value {
            FieldData::Point(point) if id == fields.position || id == fields.velocity => {
                if (point.x.to_bits() | point.y.to_bits()) & 0xffff != 0 {
                    return false;
                }

                let packed = if id == fields.position {
                    fields.packed_position
                } else {
                    fields.packed_velocity
                };
                self.unsigned((packed << 1) as u64);
                self.data.extend_from_slice(&point.x.to_le_bytes()[2..]);
                self.data.extend_from_slice(&point.y.to_le_bytes()[2..]);
                true
            }
            FieldData::Number(number) if id == fields.rotation || id == fields.spin => {
                if number.to_bits() & 0xffffff != 0 {
                    return false;
                }

                let packed = if id == fields.rotation {
                    fields.packed_rotation
                } else {
                    fields.packed_spin
                };
                self.unsigned((packed << 1) as u64);
                self.data.extend_from_slice(&number.to_le_bytes()[3..]);
                true
            }
            _ => false,
        }
    }

    fn record(
        &mut self,
        record: &EntityRecord<'_>,
        protocol: &Protocol,
        delta: Option<ModuleDelta<'_>>,
        depth: usize,
    ) -> Result<(), ProtocolError> {
        let last_field = protocol.binary_field_ids.station_marker;
        if depth > 32 || record.id > MAX_SAFE_INTEGER || record.values.len() > last_field as usize {
            return Err(ProtocolError::Snapshot);
        }

        self.unsigned(record.id);
        self.unsigned(record.values.len() as u64);
        for field in record.values {
            if field.id < 1 || field.id > last_field {
                return Err(ProtocolError::Snapshot);
            }

            let tag = (field.id as u64) << 1;
            match field.value {
                Some(value) if !self.motion_field(field.id, value, protocol) => {
                    self.unsigned(tag);
                    self.field(field.id, value, protocol, delta, depth)?;
                }
                Some(_) => {}
                None => self.unsigned(tag | 1),
            }
        }

        Ok(())
    }

    fn snapshot_header(&mut self, value: &Snapshot<'_>) -> Result<(), ProtocolError> {
        if value.tick > MAX_SAFE_INTEGER || value.next_entity_id > MAX_SAFE_INTEGER {
            return Err(ProtocolError::Snapshot);
        }

        let dock_credits = if value.dock_sequence.is_some() {
            Some(
                value
                    .credits
                    .filter(|credits| credits.is_finite() && *credits >= 0.0)
                    .ok_or(ProtocolError::Snapshot)?,
            )
        } else {
            None
        };
        let membership_changed = value.membership_changed && !value.load;
        let removed = !value.removed_entity_ids.is_empty();
        let extensions = u8::from(removed)
            | u8::from(value.asteroid_splice.is_some()) << 1
            | u8::from(value.station_stock.is_some()) << 2;
        if extensions & 3 != 0 && value.load
            || removed && membership_changed
            || value.asteroid_splice.is_some() && value.asteroid_positions.is_some()
        {
            return Err(ProtocolError::Snapshot);
        }
        let flags = u8::from(value.load)
            | u8::from(membership_changed) << 1
            | u8::from(value.ack.is_some()) << 2
            | u8::from(value.input_lead.is_some()) << 3
            | u8::from(value.sequence.is_some()) << 4
            | u8::from(value.dock_sequence.is_some()) << 5
            | u8::from(value.asteroid_positions.is_some()) << 6
            | u8::from(extensions != 0) << 7;
        self.data.extend_from_slice(&HEADER);
        self.byte(flags);
        if extensions != 0 {
            self.byte(extensions);
        }
        self.unsigned(value.tick);
        self.unsigned(value.next_entity_id);

        if let Some(ack) = value.ack {
            self.unsigned(ack);
        }
        if let Some(input_lead) = value.input_lead {
            self.signed(input_lead);
        }
        if let Some(sequence) = value.sequence {
            self.unsigned(sequence);
        }
        if let (Some(sequence), Some(credits)) = (value.dock_sequence, dock_credits) {
            self.unsigned(sequence);
            self.number(credits);
            self.unsigned(value.dock_ids.len() as u64);
            for &[temporary_id, id] in value.dock_ids {
                self.signed(temporary_id);
                self.signed(id);
            }
        }

        let positions = if let Some(splice) = value.asteroid_splice {
            self.unsigned(splice.start as u64);
            self.unsigned(splice.delete_count as u64);
            Some(splice.positions)
        } else {
            value.asteroid_positions
        };
        if let Some(positions) = positions {
            self.unsigned(positions.len() as u64);
            for &position in positions {
                self.vector(position);
            }
        }

        if membership_changed || removed {
            let ids = if removed {
                value.removed_entity_ids
            } else {
                value.entity_ids
            };
            self.unsigned(ids.len() as u64);
            for &id in ids {
                self.unsigned(id);
            }
        }

        if let Some(stock) = value.station_stock {
            self.unsigned(stock.station_id);
            self.byte(u8::from(stock.replace));
            self.unsigned(stock.removed_ids.len() as u64);
            for &id in stock.removed_ids {
                self.unsigned(id);
            }
            self.unsigned(stock.entries.len() as u64);
            for entry in stock.entries {
                self.data.extend_from_slice(entry);
            }
        }

        Ok(())
    }

    fn snapshot(&mut self, value: &Snapshot<'_>, protocol: &Protocol) -> Result<(), ProtocolError> {
        self.snapshot_header(value)?;
        if let Some(fragments) = value.fragments {
            self.unsigned(fragments.len() as u64);
            for fragment in fragments {
                self.data.extend_from_slice(fragment);
            }
        } else {
            self.unsigned(value.records.len() as u64);
            for record in value.records {
                self.record(record, protocol, None, 0)?;
            }
        }

        Ok(())
    }
}

pub(crate) enum StockEntry<'a> {
    StandardItem { id: u64, resource: u64 },
    Item(EntityRecord<'a>),
    Module(ModuleState<'a>),
}

pub(crate) fn encode_stock_entry(
    destination: &mut Vec<u8>,
    entry: StockEntry<'_>,
    protocol: &Protocol,
) -> Result<(), ProtocolError> {
    append(destination, |writer| match entry {
        StockEntry::StandardItem { id, resource } => {
            if id > MAX_SAFE_INTEGER || resource > MAX_SAFE_INTEGER - 2 {
                return Err(ProtocolError::Snapshot);
            }
            writer.unsigned(resource + 2);
            writer.unsigned(id);
            Ok(())
        }
        StockEntry::Item(item) => {
            writer.byte(0);
            writer.record(&item, protocol, None, 0)
        }
        StockEntry::Module(module) => {
            writer.byte(1);
            writer.modules(&[module], &protocol.module_palettes, None)
        }
    })
}

fn append(
    destination: &mut Vec<u8>,
    encode: impl FnOnce(&mut Writer<'_>) -> Result<(), ProtocolError>,
) -> Result<(), ProtocolError> {
    let start = destination.len();
    let result = encode(&mut Writer { data: destination });
    if result.is_err() {
        destination.truncate(start);
    }

    result
}

pub fn encode_snapshot(
    value: &Snapshot<'_>,
    protocol: &Protocol,
) -> Result<Vec<u8>, ProtocolError> {
    let mut data = Vec::with_capacity(4096);
    append_snapshot(&mut data, value, protocol)?;
    Ok(data)
}

pub fn append_snapshot(
    destination: &mut Vec<u8>,
    value: &Snapshot<'_>,
    protocol: &Protocol,
) -> Result<(), ProtocolError> {
    append(destination, |writer| writer.snapshot(value, protocol))
}

pub(crate) fn append_snapshot_fragments(
    destination: &mut Vec<u8>,
    value: &Snapshot<'_>,
    arena: &[u8],
    fragments: &[Range<usize>],
) -> Result<(), ProtocolError> {
    append(destination, |writer| {
        writer.snapshot_header(value)?;
        writer.unsigned(fragments.len() as u64);
        for fragment in fragments {
            writer.data.extend_from_slice(&arena[fragment.clone()]);
        }
        Ok(())
    })
}

/// Append directly into the replication arena so observers can share reusable fragments.
pub fn append_entity_record_delta(
    destination: &mut Vec<u8>,
    value: &EntityRecord<'_>,
    protocol: &Protocol,
    delta: Option<ModuleDelta<'_>>,
) -> Result<(), ProtocolError> {
    append(destination, |writer| {
        writer.record(value, protocol, delta, 0)
    })
}

pub fn append_field(
    destination: &mut Vec<u8>,
    id: i32,
    value: FieldData<'_>,
    protocol: &Protocol,
) -> Result<(), ProtocolError> {
    append(destination, |writer| {
        writer.field(id, value, protocol, None, 0)
    })
}

#[cfg(test)]
#[path = "snapshot_tests.rs"]
mod tests;
