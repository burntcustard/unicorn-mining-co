use std::ops::Range;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use smallvec::SmallVec;

use crate::objects::craft::{InstalledModule, Mount};
use crate::protocol::{
    AsteroidSegment, EntityRecord, FieldData, FieldValue, ModuleDelta, ModuleSegment, ModuleState,
    ProtocolError, Snapshot, append_entity_record_delta, append_field, append_snapshot_fragments,
};
use crate::simulation::asteroid::Asteroid;
use crate::simulation::asteroid_geometry::AsteroidSegment as GeometrySegment;
use crate::simulation::game_object::GameObject;
use crate::specs::{BinaryFields, Point, Protocol};
use crate::utilities::vector::Vector;

use super::Selection;
use super::station_stock::{StationStock, StockPatch};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum EntityView {
    #[default]
    Full,
    StationMarker,
    StationCraft,
}

static GENERATION: AtomicU64 = AtomicU64::new(0);
const FIELD_SLOTS: usize = u64::BITS as usize;

#[derive(Debug, Default)]
enum StoredField {
    #[default]
    Absent,
    NonFinite,
    Number(f64),
    Flag(bool),
    Point(Vector),
    Text(String),
    Numbers(Vec<f64>),
    Strings(Vec<String>),
    Outline(Vec<Point>),
    Segments(Vec<StoredSegment>),
    Encoded(Vec<u8>),
    Modules(Vec<StoredModule>),
}

#[derive(Debug, Default)]
struct FieldState {
    revision: i64,
    value: StoredField,
}

pub(crate) struct ModuleSource<'a> {
    pub module: &'a InstalledModule,
    pub kind_index: f64,
    pub mount: Option<(usize, &'a Mount)>,
}

impl ModuleSource<'_> {
    fn mount_index(&self) -> f64 {
        self.mount.map_or(-1.0, |(index, _)| index as f64)
    }

    fn health(&self) -> f64 {
        self.mount
            .map_or(self.module.spec.health, |(_, mount)| mount.health)
    }

    fn health_activated(&self) -> Option<f64> {
        self.mount.and_then(|(_, mount)| mount.health_activated)
    }

    fn fire_cooldown(&self) -> Option<f64> {
        (self.module.fire_cooldown > 0.0).then_some(self.module.fire_cooldown)
    }

    fn charge_cooldown(&self) -> Option<f64> {
        (self.module.charge_cooldown > 0.0).then_some(self.module.charge_cooldown)
    }

    fn aim_rotation(&self) -> Option<f64> {
        (self.module.aim_rotation != 0.0).then_some(self.module.aim_rotation)
    }

    fn segment_count(&self) -> usize {
        self.mount.map_or(0, |_| self.module.parts.len())
    }

    pub(crate) fn stock_state(&self) -> ModuleState<'_> {
        ModuleState {
            r#type: self.kind_index,
            mount: self.mount_index(),
            id: Some(self.module.id as f64),
            health: Some(self.health()),
            health_activated: self.health_activated(),
            fire_cooldown: self.fire_cooldown(),
            charge_cooldown: self.charge_cooldown(),
            aim_rotation: self.aim_rotation(),
            shades: self.module.shades.as_deref(),
            segments: &[],
        }
    }

    fn segments(&self) -> impl Iterator<Item = ModuleSegment> {
        self.module
            .wire_parts()
            .take(self.segment_count())
            .map(|part| ModuleSegment {
                active: part.active,
                activation_progress: part.activation_progress,
            })
    }
}

#[derive(Debug)]
struct StoredModule {
    r#type: f64,
    mount: f64,
    id: Option<f64>,
    health: Option<f64>,
    health_activated: Option<f64>,
    fire_cooldown: Option<f64>,
    charge_cooldown: Option<f64>,
    aim_rotation: Option<f64>,
    shades: Option<Vec<String>>,
    segments: Vec<ModuleSegment>,
}

#[derive(Debug)]
struct StoredSegment {
    contents: Vec<f64>,
    health: f64,
    mass: f64,
    max_health: f64,
    shape_outline: Vec<Point>,
}

impl StoredSegment {
    fn from_geometry(segment: &GeometrySegment) -> Self {
        Self {
            contents: segment.contents.iter().copied().map(f64::from).collect(),
            health: segment.health,
            mass: segment.mass,
            max_health: segment.max_health,
            shape_outline: segment.outline.points.clone(),
        }
    }

    fn wire(&self) -> AsteroidSegment<'_> {
        AsteroidSegment {
            contents: &self.contents,
            health: self.health,
            mass: self.mass,
            max_health: self.max_health,
            shape_outline: &self.shape_outline,
        }
    }
}

impl StoredModule {
    fn new(state: &ModuleSource<'_>) -> Self {
        Self {
            r#type: state.kind_index,
            mount: state.mount_index(),
            id: Some(state.module.id as f64),
            health: Some(state.health()),
            health_activated: state.health_activated(),
            fire_cooldown: state.fire_cooldown(),
            charge_cooldown: state.charge_cooldown(),
            aim_rotation: state.aim_rotation(),
            shades: state.module.shades.clone(),
            segments: state.segments().collect(),
        }
    }

    fn wire(&self) -> ModuleState<'_> {
        ModuleState {
            r#type: self.r#type,
            mount: self.mount,
            id: self.id,
            health: self.health,
            health_activated: self.health_activated,
            fire_cooldown: self.fire_cooldown,
            charge_cooldown: self.charge_cooldown,
            aim_rotation: self.aim_rotation,
            shades: self.shades.as_deref(),
            segments: &self.segments,
        }
    }

    fn same_layout(&self, next: &ModuleSource<'_>) -> bool {
        self.r#type == next.kind_index
            && self.mount == next.mount_index()
            && self.id == Some(next.module.id as f64)
    }

    fn same_properties(&self, next: &ModuleSource<'_>) -> bool {
        self.health == Some(next.health())
            && self.health_activated == next.health_activated()
            && self.fire_cooldown == next.fire_cooldown()
            && self.charge_cooldown == next.charge_cooldown()
            && self.aim_rotation == next.aim_rotation()
            && self.segments.len() == next.segment_count()
            && self.segments.iter().zip(next.segments()).all(|(a, b)| {
                a.active == b.active && a.activation_progress == b.activation_progress
            })
    }

    fn update(&mut self, next: &ModuleSource<'_>, shades_changed: bool) {
        self.health = Some(next.health());
        self.health_activated = next.health_activated();
        self.fire_cooldown = next.fire_cooldown();
        self.charge_cooldown = next.charge_cooldown();
        self.aim_rotation = next.aim_rotation();
        self.segments.clear();
        self.segments.extend(next.segments());
        if shades_changed {
            self.shades.clone_from(&next.module.shades);
        }
    }
}

/// The last state delivered to a client. A replacement can reuse the same wire ID.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EntityBaseline {
    source: u64,
    view: EntityView,
    revision: i64,
    fields: u64,
}

/// A record lives with its authoritative entity, independent of observer count.
#[derive(Debug)]
pub struct EntityReplication {
    id: u64,
    source: u64,
    pub(crate) view: EntityView,
    generation: u64,
    revision: i64,
    previous_revision: i64,
    fields: Vec<FieldState>,
    recent_changes: Vec<i32>,
    asteroid_segments_revision: Option<(u64, bool)>,
    present_fields: u64,
    layout_revision: i64,
    module_revisions: Vec<i64>,
    shade_revisions: Vec<i64>,
    full_fragment: Option<Range<usize>>,
    delta_fragment: Option<Range<usize>>,
    nested: Vec<u8>,
}

impl EntityReplication {
    pub fn new(id: u64, source: u64, protocol: &Protocol) -> Self {
        let count = protocol.binary_field_ids.station_marker as usize + 1;
        assert!(
            count <= FIELD_SLOTS,
            "replication mask cannot represent the TypeScript field IDs"
        );
        let mut fields = Vec::with_capacity(count);
        fields.resize_with(count, FieldState::default);
        Self {
            id,
            source,
            view: EntityView::Full,
            generation: 0,
            revision: 0,
            previous_revision: 0,
            fields,
            recent_changes: Vec::with_capacity(count),
            asteroid_segments_revision: None,
            present_fields: 0,
            layout_revision: 0,
            module_revisions: Vec::new(),
            shade_revisions: Vec::new(),
            full_fragment: None,
            delta_fragment: None,
            nested: Vec::new(),
        }
    }

    /// Run entity inspection once per batch, on demand from the first observer.
    pub fn prepare(&mut self, batch: &SnapshotBatch, capture: impl FnOnce(&mut Self)) {
        if self.generation == batch.generation {
            return;
        }
        self.generation = batch.generation;
        self.previous_revision = self.revision;
        self.recent_changes.clear();
        self.full_fragment = None;
        self.delta_fragment = None;
        capture(self);
    }

    pub fn baseline(&self) -> EntityBaseline {
        EntityBaseline {
            source: self.source,
            view: self.view,
            revision: self.revision,
            fields: self.present_fields,
        }
    }

    fn replace(&mut self, id: i32, value: StoredField) {
        let bit = 1_u64 << id;
        if matches!(value, StoredField::Absent | StoredField::NonFinite) {
            self.present_fields &= !bit;
        } else {
            self.present_fields |= bit;
        }
        self.fields[id as usize].value = value;
        self.changed(id);
    }

    fn changed(&mut self, id: i32) {
        self.full_fragment = None;
        self.delta_fragment = None;
        self.revision += 1;
        let field = &mut self.fields[id as usize];
        if field.revision <= self.previous_revision {
            self.recent_changes.push(id);
        }
        field.revision = self.revision;
    }

    pub fn clear(&mut self, id: i32) {
        if !matches!(self.fields[id as usize].value, StoredField::Absent) {
            self.replace(id, StoredField::Absent);
        }
    }

    pub fn number(&mut self, id: i32, value: Option<f64>) {
        let Some(value) = value else {
            self.clear(id);
            return;
        };
        match &mut self.fields[id as usize].value {
            StoredField::Number(before) => {
                if *before == value {
                    return;
                }
                if value.is_finite() {
                    *before = if value == 0.0 { 0.0 } else { value };
                    self.changed(id);
                    return;
                }
            }
            StoredField::NonFinite if !value.is_finite() => return,
            _ => {}
        }
        let value = if value.is_finite() {
            StoredField::Number(if value == 0.0 { 0.0 } else { value })
        } else {
            StoredField::NonFinite
        };
        self.replace(id, value);
    }

    pub fn flag(&mut self, id: i32, value: Option<bool>) {
        let Some(value) = value else {
            self.clear(id);
            return;
        };
        if !matches!(self.fields[id as usize].value, StoredField::Flag(before) if before == value) {
            self.replace(id, StoredField::Flag(value));
        }
    }

    pub fn point(&mut self, id: i32, value: Option<Vector>) {
        let Some(value) = value else {
            self.clear(id);
            return;
        };
        if let StoredField::Point(before) = &mut self.fields[id as usize].value {
            if *before != value {
                *before = value;
                self.changed(id);
            }
        } else {
            self.replace(id, StoredField::Point(value));
        }
    }

    pub fn text(&mut self, id: i32, value: Option<&str>) {
        let Some(value) = value else {
            self.clear(id);
            return;
        };
        if let StoredField::Text(before) = &mut self.fields[id as usize].value {
            if before == value {
                return;
            }
            before.clear();
            before.push_str(value);
            self.changed(id);
        } else {
            self.replace(id, StoredField::Text(value.to_owned()));
        }
    }

    pub fn numbers(&mut self, id: i32, value: Option<&[f64]>) {
        let Some(value) = value else {
            self.clear(id);
            return;
        };
        if let StoredField::Numbers(before) = &mut self.fields[id as usize].value {
            let equal = before.len() == value.len()
                && before
                    .iter()
                    .zip(value)
                    .all(|(a, b)| a == b || (!a.is_finite() && !b.is_finite()));
            if equal {
                return;
            }
            before.clear();
            before.extend_from_slice(value);
            self.changed(id);
        } else {
            self.replace(id, StoredField::Numbers(value.to_vec()));
        }
    }

    pub fn strings(&mut self, id: i32, value: Option<&[String]>) {
        let Some(value) = value else {
            self.clear(id);
            return;
        };
        if !matches!(&self.fields[id as usize].value, StoredField::Strings(before) if before == value)
        {
            self.replace(id, StoredField::Strings(value.to_vec()));
        }
    }

    pub fn outline(&mut self, id: i32, value: Option<&[Point]>) {
        let Some(value) = value else {
            self.clear(id);
            return;
        };
        if let StoredField::Outline(before) = &mut self.fields[id as usize].value {
            if before.len() == value.len()
                && before.iter().zip(value).all(|(a, b)| {
                    a.iter()
                        .zip(b)
                        .all(|(a, b)| a == b || (!a.is_finite() && !b.is_finite()))
                })
            {
                return;
            }
            before.clear();
            before.extend_from_slice(value);
            self.changed(id);
        } else {
            self.replace(id, StoredField::Outline(value.to_vec()));
        }
    }

    pub(crate) fn asteroid_contents(&mut self, id: i32, contents: &[i32]) {
        if contents.is_empty() {
            self.clear(id);
        } else {
            let contents_iter = contents.iter().copied().map(f64::from);
            if let StoredField::Numbers(before) = &mut self.fields[id as usize].value {
                if !before.iter().copied().eq(contents_iter.clone()) {
                    before.clear();
                    before.extend(contents_iter);
                    self.changed(id);
                }
            } else {
                self.replace(id, StoredField::Numbers(contents_iter.collect()));
            }
        }
    }

    pub(crate) fn capture_asteroid_segments(&mut self, id: i32, asteroid: &Asteroid) {
        let outlined = asteroid.object.shape_outline.is_some();
        let state = (asteroid.segment_state_revision(), outlined);
        if self.asteroid_segments_revision == Some(state) {
            return;
        }
        let mut reusable = true;
        if (outlined || asteroid.damaged())
            && let Some(segments) = asteroid.segments()
        {
            self.asteroid_segments(id, segments);
            // NaN fields were considered changed on every capture, even when
            // they came from the same model.
            reusable = segments.iter().all(|segment| {
                !segment.health.is_nan()
                    && !segment.max_health.is_nan()
                    && !segment.mass.is_nan()
                    && segment
                        .outline
                        .points
                        .iter()
                        .flatten()
                        .all(|value| !value.is_nan())
            });
        }
        self.asteroid_segments_revision = reusable.then_some(state);
    }

    fn asteroid_segments(&mut self, id: i32, next: &[GeometrySegment]) {
        let StoredField::Segments(previous) = &mut self.fields[id as usize].value else {
            self.replace(
                id,
                StoredField::Segments(next.iter().map(StoredSegment::from_geometry).collect()),
            );
            return;
        };
        let mut changed = previous.len() != next.len();
        previous.truncate(next.len());
        for (before, next) in previous.iter_mut().zip(next) {
            if before.health != next.health
                || before.mass != next.mass
                || before.max_health != next.max_health
            {
                before.health = next.health;
                before.mass = next.mass;
                before.max_health = next.max_health;
                changed = true;
            }
            let contents = next.contents.iter().copied().map(f64::from);
            if before.contents.len() != next.contents.len()
                || !before.contents.iter().copied().eq(contents.clone())
            {
                before.contents.clear();
                before.contents.extend(contents);
                changed = true;
            }
            if before.shape_outline != next.outline.points {
                before.shape_outline.clear();
                before.shape_outline.extend_from_slice(&next.outline.points);
                changed = true;
            }
        }
        previous.extend(
            next[previous.len()..]
                .iter()
                .map(StoredSegment::from_geometry),
        );
        if changed {
            self.changed(id);
        }
    }

    pub fn nested(
        &mut self,
        id: i32,
        value: FieldData<'_>,
        protocol: &Protocol,
    ) -> Result<(), ProtocolError> {
        let fields = &protocol.binary_field_ids;
        if id != fields.cargo_contents && id != fields.wreckage {
            return Err(ProtocolError::Snapshot);
        }
        self.nested.clear();
        append_field(&mut self.nested, id, value, protocol)?;
        if let StoredField::Encoded(before) = &mut self.fields[id as usize].value {
            if *before != self.nested {
                std::mem::swap(before, &mut self.nested);
                self.changed(id);
            }
        } else {
            let data = std::mem::take(&mut self.nested);
            self.replace(id, StoredField::Encoded(data));
        }
        Ok(())
    }

    pub(crate) fn modules(&mut self, id: i32, next: Option<&[ModuleSource<'_>]>) {
        let Some(next) = next else {
            self.clear(id);
            self.layout_revision = self.revision;
            return;
        };
        let before = &self.fields[id as usize].value;
        let previous = match before {
            StoredField::Modules(before) => before.as_slice(),
            _ => &[],
        };
        let layout_changed = !matches!(before, StoredField::Modules(_))
            || previous.len() != next.len()
            || previous.iter().zip(next).any(|(a, b)| !a.same_layout(b));
        if layout_changed {
            self.layout_revision = self.revision + 1;
            self.module_revisions
                .resize(next.len(), self.layout_revision);
            self.shade_revisions
                .resize(next.len(), self.layout_revision);
            self.module_revisions.fill(self.layout_revision);
            self.shade_revisions.fill(self.layout_revision);
            self.replace(
                id,
                StoredField::Modules(next.iter().map(StoredModule::new).collect()),
            );
            return;
        }
        let StoredField::Modules(previous) = &mut self.fields[id as usize].value else {
            return;
        };
        let revision = self.revision + 1;
        let mut changed = false;
        for (index, (before, next)) in previous.iter_mut().zip(next).enumerate() {
            let shades_changed = before.shades != next.module.shades;
            if shades_changed {
                self.shade_revisions[index] = revision;
            }
            if shades_changed || !before.same_properties(next) {
                before.update(next, shades_changed);
                self.module_revisions[index] = revision;
                changed = true;
            }
        }
        if changed {
            self.changed(id);
        }
    }

    /// Capture fields owned by GameObject. Derived entities retain their own fields.
    pub fn base_fields(
        &mut self,
        object: &GameObject,
        fields: &BinaryFields,
        crafted: bool,
        module_friction: Option<f64>,
        station_defaults: Option<(&str, f64)>,
    ) {
        let asteroid = object.kind == "asteroid";
        let default_friction =
            module_friction.unwrap_or(if crafted || asteroid { 0.2 } else { 0.01 });
        self.number(
            fields.friction,
            (object.friction != default_friction).then_some(object.friction),
        );
        let default_health = object.health.is_nan()
            || (asteroid && object.health == object.radius * 2.0)
            || (crafted && object.health == 100.0);
        self.number(fields.health, (!default_health).then_some(object.health));
        self.text(
            fields.name,
            (!object.name.is_empty()
                && station_defaults.is_none_or(|(name, _)| name != object.name))
            .then_some(&object.name),
        );
        self.text(fields.message, object.message.as_deref());
        self.number(fields.paint, object.paint.map(f64::from));
        self.number(
            fields.player_number,
            object.player_number.map(|id| id as f64),
        );
        self.number(
            fields.point_count,
            (object.point_count != 0).then_some(object.point_count as f64),
        );
        self.number(fields.radius_even, object.radius_even);
        self.number(fields.resource, object.resource.map(f64::from));
        let kind = match object.kind.as_str() {
            "asteroid" | "projectile" | "navBeacon" | "station" | "jumpGate" | "wormhole" => {
                object.kind.as_str()
            }
            _ if object.item => "item",
            _ if crafted => "ship",
            _ => "object",
        };
        self.text(fields.kind, Some(kind));
        self.text(
            fields.definition_id,
            (!object.definition_id.is_empty()).then_some(&object.definition_id),
        );
        self.number(
            fields.mass,
            (!asteroid || object.mass != 0.4 * (object.radius * object.radius))
                .then_some(object.mass)
                .filter(|&mass| station_defaults.is_none_or(|(_, default)| default != mass)),
        );
        self.number(
            fields.pending_update_time,
            (object.pending_update_time != 0.0).then_some(object.pending_update_time),
        );
        self.point(fields.position, Some(object.position));
        self.number(fields.radius, Some(object.radius));
        self.number(fields.rotation, Some(object.rotation));
        self.number(fields.spin, Some(object.spin));
        self.point(
            fields.velocity,
            (object.velocity != Vector::ZERO).then_some(object.velocity),
        );
    }
}

/// Snapshot metadata supplied by the connection's receipt and input queues.
#[derive(Default)]
pub struct SnapshotMetadata<'a> {
    pub load: bool,
    pub tick: u64,
    pub next_entity_id: u64,
    pub ack: Option<u64>,
    pub sequence: Option<u64>,
    pub dock_sequence: Option<u64>,
    pub credits: Option<f64>,
    pub dock_ids: &'a [[i64; 2]],
    pub input_lead: Option<i64>,
    pub station_replication: bool,
    pub docked_station: Option<i64>,
}

#[derive(Default)]
pub struct SnapshotWriter {
    baselines: Vec<Option<(i64, EntityBaseline)>>,
    data: Vec<u8>,
    ids: Vec<u64>,
    updates: Vec<(usize, i64, EntityBaseline)>,
    fragments: Vec<Range<usize>>,
    station_stock: Option<Arc<StationStock>>,
}

pub(crate) trait ReplicationSource {
    fn prepare(
        &mut self,
        source_index: usize,
        id: i64,
        view: EntityView,
        batch: &SnapshotBatch,
    ) -> Result<&mut EntityReplication, ProtocolError>;

    fn station_stock(&mut self, id: i64) -> Result<Option<Arc<StationStock>>, ProtocolError>;
}

impl SnapshotWriter {
    /// Prepare only selected, due entities and assemble their shared fragments.
    pub(crate) fn encode<'a>(
        &'a mut self,
        selection: Selection<'_>,
        metadata: SnapshotMetadata<'_>,
        batch: &mut SnapshotBatch,
        protocol: &Protocol,
        source: &mut impl ReplicationSource,
    ) -> Result<&'a [u8], ProtocolError> {
        let station_stock = metadata
            .docked_station
            .filter(|_| metadata.station_replication)
            .map(|id| source.station_stock(id))
            .transpose()?
            .flatten();
        let previous_stock = (!metadata.load)
            .then_some(self.station_stock.as_deref())
            .flatten();
        let stock_patch = StockPatch::between(previous_stock, station_stock.as_deref());
        let station_stock_update = stock_patch.as_ref().map(StockPatch::wire);

        let entity_ids = if selection.membership_changed && !metadata.load {
            self.ids.clear();
            self.ids.extend(
                selection
                    .entities
                    .iter()
                    .map(|entry| selection.view[entry.index].id as u64),
            );
            self.ids.as_slice()
        } else {
            &[]
        };
        self.updates.clear();
        self.fragments.clear();
        for selected in selection.entities {
            let entity = &selection.view[selected.index];
            if !selected.update && (!metadata.station_replication || !entity.station) {
                continue;
            }
            let baseline = if metadata.load || !selected.loaded {
                None
            } else {
                self.baselines
                    .get(selected.member)
                    .copied()
                    .flatten()
                    .filter(|&(id, _)| id == entity.id)
                    .map(|(_, baseline)| baseline)
            };
            let view = if !metadata.station_replication || !entity.station {
                EntityView::Full
            } else if metadata.docked_station == Some(entity.id) {
                EntityView::StationCraft
            } else if selected.station_marker.unwrap_or_else(|| {
                baseline.is_none_or(|baseline| baseline.view == EntityView::StationMarker)
            }) {
                EntityView::StationMarker
            } else {
                EntityView::StationCraft
            };
            if !selected.update && baseline.is_some_and(|baseline| baseline.view == view) {
                continue;
            }
            let record = source.prepare(entity.source_index, entity.id, view, batch)?;
            if let Some(fragment) = batch.fragment(record, baseline, protocol)? {
                self.fragments.push(fragment);
            }
            let current = record.baseline();
            if baseline != Some(current) {
                self.updates.push((selected.member, entity.id, current));
            }
        }
        self.data.clear();
        self.data.reserve(4096);
        append_snapshot_fragments(
            &mut self.data,
            &Snapshot {
                load: metadata.load,
                membership_changed: selection.membership_changed,
                tick: metadata.tick,
                next_entity_id: metadata.next_entity_id,
                ack: metadata.ack,
                sequence: metadata.sequence,
                dock_sequence: metadata.dock_sequence,
                credits: metadata.credits,
                dock_ids: metadata.dock_ids,
                input_lead: metadata.input_lead,
                entity_ids,
                removed_entity_ids: selection.removed_entity_ids,
                asteroid_positions: selection.asteroid_positions,
                asteroid_splice: selection.asteroid_splice,
                station_stock: station_stock_update.as_ref(),
                records: &[],
                fragments: None,
            },
            &batch.arena,
            &self.fragments,
        )?;
        if metadata.load {
            self.baselines.clear();
        }
        // Observer membership can recycle a slot after an entity leaves. Keep
        // the wire ID in each baseline so a reused slot is safe after errors.
        self.baselines.resize(selection.member_capacity, None);
        for &(member, id, baseline) in &self.updates {
            self.baselines[member] = Some((id, baseline));
        }
        drop(stock_patch);
        self.station_stock = station_stock;
        Ok(&self.data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::specs::Catalog;

    fn encoded(id: u64, fields: &[FieldValue<'_>], protocol: &Protocol) -> Vec<u8> {
        let mut bytes = Vec::new();
        append_entity_record_delta(
            &mut bytes,
            &EntityRecord { id, values: fields },
            protocol,
            None,
        )
        .unwrap();
        bytes
    }

    #[test]
    fn observers_share_latest_delta_and_full_fragments() {
        let protocol = Catalog::load().unwrap().protocol;
        let fields = protocol.binary_field_ids;
        let mut record = EntityReplication::new(42, 1, &protocol);
        let mut batch = SnapshotBatch::default();
        batch.begin();
        record.prepare(&batch, |record| {
            record.text(fields.kind, Some("ship"));
            record.number(fields.fuel, Some(50.0));
        });
        record.prepare(&batch, |_| panic!("duplicate capture"));
        let full = batch
            .fragment(&mut record, None, &protocol)
            .unwrap()
            .unwrap();
        assert_eq!(
            batch.fragment(&mut record, None, &protocol).unwrap(),
            Some(full.clone())
        );
        assert_eq!(
            batch.bytes(full),
            encoded(
                42,
                &[
                    FieldValue {
                        id: fields.kind,
                        value: Some(FieldData::Text("ship"))
                    },
                    FieldValue {
                        id: fields.fuel,
                        value: Some(FieldData::Number(50.0))
                    },
                ],
                &protocol
            )
        );
        let old = record.baseline();
        batch.begin();
        record.prepare(&batch, |record| record.number(fields.fuel, Some(49.0)));
        let delta = batch
            .fragment(&mut record, Some(old), &protocol)
            .unwrap()
            .unwrap();
        assert_eq!(
            batch.bytes(delta.clone()),
            encoded(
                42,
                &[FieldValue {
                    id: fields.fuel,
                    value: Some(FieldData::Number(49.0))
                }],
                &protocol
            )
        );
        assert_eq!(
            batch.fragment(&mut record, Some(old), &protocol).unwrap(),
            Some(delta)
        );
        let current = record.baseline();
        assert_eq!(
            batch
                .fragment(&mut record, Some(current), &protocol)
                .unwrap(),
            None
        );
    }

    #[test]
    fn asteroid_segments_preserve_wire_numbers_and_revisions() {
        use crate::simulation::polygon::ShapeOutline;

        let protocol = Catalog::load().unwrap().protocol;
        let segments = protocol.binary_field_ids.segments;
        let mut record = EntityReplication::new(42, 1, &protocol);
        let mut batch = SnapshotBatch::default();
        let mut source = [GeometrySegment {
            contents: vec![i32::MIN, 0, i32::MAX],
            health: -0.0,
            mass: f64::INFINITY,
            max_health: 8.0,
            outline: ShapeOutline {
                points: vec![[0.0, 1.0], [0.0, 2.0], [1.0, 0.0]],
                edges: None,
            },
        }];
        let expected = encoded(
            42,
            &[FieldValue {
                id: segments,
                value: Some(FieldData::Segments(&[AsteroidSegment {
                    contents: &[f64::from(i32::MIN), 0.0, f64::from(i32::MAX)],
                    health: -0.0,
                    mass: f64::INFINITY,
                    max_health: 8.0,
                    shape_outline: &source[0].outline.points,
                }])),
            }],
            &protocol,
        );

        batch.begin();
        record.prepare(&batch, |record| record.asteroid_segments(segments, &source));
        let full = batch
            .fragment(&mut record, None, &protocol)
            .unwrap()
            .unwrap();
        assert_eq!(batch.bytes(full), expected);

        let baseline = record.baseline();
        source[0].health = 0.0;
        source[0].outline.points[0][0] = -0.0;
        batch.begin();
        record.prepare(&batch, |record| record.asteroid_segments(segments, &source));
        assert_eq!(record.baseline(), baseline);
        let full = batch
            .fragment(&mut record, None, &protocol)
            .unwrap()
            .unwrap();
        assert_eq!(batch.bytes(full), expected);

        source[0].mass = f64::NEG_INFINITY;
        source[0].contents[0] = 3;
        source[0].health = f64::NAN;
        for _ in 0..2 {
            let baseline = record.baseline();
            batch.begin();
            record.prepare(&batch, |record| record.asteroid_segments(segments, &source));
            assert_eq!(record.baseline().revision, baseline.revision + 1);
        }

        batch.begin();
        record.prepare(&batch, |record| record.asteroid_segments(segments, &[]));
        let empty = record.baseline();
        assert_ne!(empty.fields & (1 << segments), 0);
        batch.begin();
        record.prepare(&batch, |record| record.clear(segments));
        assert_eq!(record.baseline().revision, empty.revision + 1);
        assert_eq!(record.baseline().fields & (1 << segments), 0);
    }

    #[test]
    fn cached_asteroid_segments_refresh_after_damage() {
        use crate::protocol::AsteroidDescription;
        use crate::simulation::asteroid_geometry::AsteroidOutlines;

        let catalog = Catalog::load().unwrap();
        let protocol = &catalog.protocol;
        let field = protocol.binary_field_ids.segments;
        let mut outlines = AsteroidOutlines::default();
        let mut asteroid = Asteroid::from_generated(
            42,
            &AsteroidDescription {
                id: 42,
                radius: 55.0,
                ..Default::default()
            },
            &catalog,
            &mut outlines,
        );
        let mut record = EntityReplication::new(42, 1, protocol);
        let mut batch = SnapshotBatch::default();

        batch.begin();
        record.prepare(&batch, |record| {
            record.capture_asteroid_segments(field, &asteroid);
        });
        assert_eq!(record.baseline().fields & (1 << field), 0);

        for _ in 0..2 {
            let before = record.baseline();
            assert_eq!(asteroid.damage_segment(Some(0), 0.25), 0.25);
            batch.begin();
            record.prepare(&batch, |record| {
                record.capture_asteroid_segments(field, &asteroid);
            });
            let damaged = record.baseline();
            assert_eq!(damaged.revision, before.revision + 1);
            assert_ne!(damaged.fields & (1 << field), 0);

            batch.begin();
            record.prepare(&batch, |record| {
                record.capture_asteroid_segments(field, &asteroid);
            });
            assert_eq!(record.baseline(), damaged);
        }
    }

    #[test]
    fn replacement_clears_old_fields_and_normalizes_numbers() {
        let protocol = Catalog::load().unwrap().protocol;
        let fields = protocol.binary_field_ids;
        let mut batch = SnapshotBatch::default();
        let mut previous = EntityReplication::new(42, 1, &protocol);
        let mut replacement = EntityReplication::new(42, 2, &protocol);
        batch.begin();
        previous.prepare(&batch, |record| {
            record.text(fields.kind, Some("ship"));
            record.text(fields.message, Some("old"));
            record.number(fields.fuel, Some(50.0));
        });
        replacement.prepare(&batch, |record| {
            record.text(fields.kind, Some("ship"));
            record.number(fields.fuel, Some(f64::INFINITY));
            record.number(fields.spin, Some(-0.0));
        });
        let fragment = batch
            .fragment(&mut replacement, Some(previous.baseline()), &protocol)
            .unwrap()
            .unwrap();
        let mut expected = [
            FieldValue {
                id: fields.kind,
                value: Some(FieldData::Text("ship")),
            },
            FieldValue {
                id: fields.message,
                value: None,
            },
            FieldValue {
                id: fields.fuel,
                value: None,
            },
            FieldValue {
                id: fields.spin,
                value: Some(FieldData::Number(0.0)),
            },
        ];
        expected.sort_by_key(|value| value.id);
        assert_eq!(batch.bytes(fragment), encoded(42, &expected, &protocol));
    }
}

#[derive(Default)]
pub struct SnapshotBatch {
    generation: u64,
    arena: Vec<u8>,
}

impl SnapshotBatch {
    pub fn begin(&mut self) {
        self.generation = GENERATION.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
        self.arena.clear();
    }

    pub fn fragment(
        &mut self,
        record: &mut EntityReplication,
        baseline: Option<EntityBaseline>,
        protocol: &Protocol,
    ) -> Result<Option<Range<usize>>, ProtocolError> {
        if self.generation == 0 || record.generation != self.generation {
            return Err(ProtocolError::Snapshot);
        }
        let (baseline, replaced) = match baseline {
            Some(old) if old.source == record.source && old.view == record.view => {
                (Some(old.revision), None)
            }
            old => (None, old),
        };
        if baseline.is_some_and(|old| old >= record.revision) {
            return Ok(None);
        }
        let full = baseline.is_none() && replaced.is_none();
        let delta = baseline == Some(record.previous_revision);
        if let Some(fragment) = full
            .then_some(&record.full_fragment)
            .or_else(|| delta.then_some(&record.delta_fragment))
            .and_then(Option::as_ref)
        {
            return Ok((!fragment.is_empty()).then(|| fragment.clone()));
        }

        let field_ids = &protocol.binary_field_ids;
        let module_field = &record.fields[field_ids.modules as usize];
        let segments_field = &record.fields[field_ids.segments as usize];
        let module_values: SmallVec<[ModuleState<'_>; 16]> = match &module_field.value {
            _ if baseline.is_some_and(|baseline| module_field.revision <= baseline) => {
                SmallVec::new()
            }
            StoredField::Modules(modules) => modules.iter().map(StoredModule::wire).collect(),
            _ => SmallVec::new(),
        };
        let segment_values: SmallVec<[AsteroidSegment<'_>; 16]> = match &segments_field.value {
            _ if baseline.is_some_and(|baseline| segments_field.revision <= baseline) => {
                SmallVec::new()
            }
            StoredField::Segments(segments) => segments.iter().map(StoredSegment::wire).collect(),
            _ => SmallVec::new(),
        };
        let mut values = SmallVec::<[FieldValue<'_>; FIELD_SLOTS]>::new();
        let mut include = |id: i32| {
            let field = &record.fields[id as usize];
            let value = match &field.value {
                StoredField::Absent | StoredField::NonFinite => None,
                StoredField::Number(value) => Some(FieldData::Number(*value)),
                StoredField::Flag(value) => Some(FieldData::Flag(*value)),
                StoredField::Point(value) => Some(FieldData::Point(*value)),
                StoredField::Text(value) => Some(FieldData::Text(value)),
                StoredField::Numbers(value) => Some(FieldData::Numbers(value)),
                StoredField::Strings(value) => Some(FieldData::Strings(value)),
                StoredField::Outline(value) => Some(FieldData::Outline(value)),
                StoredField::Segments(_) => Some(FieldData::Segments(&segment_values)),
                StoredField::Encoded(value) => Some(FieldData::Encoded(value)),
                StoredField::Modules(_) => Some(FieldData::Modules(&module_values)),
            };
            let due = match baseline {
                Some(baseline) => field.revision > baseline,
                None => value.is_some() || replaced.is_some_and(|old| old.fields & (1 << id) != 0),
            };
            if due {
                values.push(FieldValue { id, value });
            }
        };
        if baseline.is_some_and(|old| old >= record.previous_revision) {
            for &id in &record.recent_changes {
                include(id);
            }
        } else if baseline.is_none() {
            let mut fields = (record.present_fields | replaced.map_or(0, |old| old.fields)) & !1;
            while fields != 0 {
                let id = fields.trailing_zeros();
                fields &= fields - 1;
                include(id as i32);
            }
        } else {
            for id in 1..=field_ids.station_marker {
                include(id);
            }
        }
        let offset = self.arena.len();
        if !values.is_empty() {
            let modules = baseline.map(|revision| ModuleDelta {
                revisions: &record.module_revisions,
                shade_revisions: &record.shade_revisions,
                baseline: revision,
                layout_revision: record.layout_revision,
            });
            append_entity_record_delta(
                &mut self.arena,
                &EntityRecord {
                    id: record.id,
                    values: &values,
                },
                protocol,
                modules,
            )?;
        }
        let fragment = offset..self.arena.len();
        if full {
            record.full_fragment = Some(fragment.clone());
        }
        if delta {
            record.delta_fragment = Some(fragment.clone());
        }
        Ok((!fragment.is_empty()).then_some(fragment))
    }

    pub fn bytes(&self, fragment: Range<usize>) -> &[u8] {
        &self.arena[fragment]
    }
}
