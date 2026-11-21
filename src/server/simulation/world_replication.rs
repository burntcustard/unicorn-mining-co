use std::collections::HashMap;
use std::sync::Arc;

use smallvec::SmallVec;

use crate::objects::craft::{CargoObject, Craft, InstalledModule, Mount};
use crate::objects::item::Item;
use crate::protocol::{
    CargoEntry, EntityRecord, FieldData, FieldValue, ProtocolError, StockEntry, WreckageSegment,
    encode_stock_entry,
};
use crate::replication::snapshot_writer::{
    EntityReplication, EntityView, ModuleSource, ReplicationSource, SnapshotBatch,
};
use crate::replication::station_stock::StationStock;
use crate::replication::{ReplicatedEntity, ReplicationView};
use crate::specs::Catalog;
use crate::utilities::vector::Vector;

use super::game_object::ObjectProperties;
use super::world::{EntityKind, World};

impl World {
    pub fn replication_view(&self, view: &mut ReplicationView) {
        view.prepare(
            self.entities
                .indexed_values()
                .map(|(source_index, entity)| {
                    let object = entity.model.object();
                    ReplicatedEntity {
                        source_index,
                        id: object.id,
                        position: object.position,
                        station: object.kind == "station",
                        asteroid: object.kind == "asteroid",
                        ballistic: object.ballistic,
                        dead: object.dead,
                        buried: object.buried,
                    }
                }),
            self.entity_epoch(),
        );
    }
}

impl ReplicationSource for World {
    fn prepare(
        &mut self,
        source_index: usize,
        id: i64,
        view: EntityView,
        batch: &SnapshotBatch,
    ) -> Result<&mut EntityReplication, ProtocolError> {
        let entity = self
            .entities
            .get_at_mut(source_index, &id)
            .ok_or(ProtocolError::Snapshot)?;
        let catalog = &self.catalog;
        let incarnation = entity.incarnation;
        if view == EntityView::Full {
            let record = entity.replication.get_or_insert_with(|| {
                EntityReplication::new(id as u64, incarnation, &catalog.protocol)
            });
            let mut result = Ok(());
            record.prepare(batch, |record| {
                result = capture(record, &entity.model, catalog);
            });
            result?;
            return Ok(record);
        }

        let EntityKind::Station(station) = &mut entity.model else {
            return Err(ProtocolError::Snapshot);
        };
        let cache = if view == EntityView::StationMarker {
            &mut station.marker_replication
        } else {
            &mut station.craft_replication
        };
        let record = cache.get_or_insert_with(|| {
            let mut record = EntityReplication::new(id as u64, incarnation, &catalog.protocol);
            record.view = view;
            Box::new(record)
        });
        let mut result = Ok(());
        record.prepare(batch, |record| {
            if view == EntityView::StationMarker {
                let object = &station.craft.object;
                let fields = &catalog.protocol.binary_field_ids;
                record.flag(fields.station_marker, Some(true));
                record.text(fields.kind, Some("station"));
                record.text(
                    fields.definition_id,
                    (!object.definition_id.is_empty()).then_some(&object.definition_id),
                );
                record.point(fields.position, Some(object.position));
                record.number(fields.radius, Some(object.radius));
            } else {
                result = capture_station_craft(record, &station.craft, catalog);
            }
        });
        result?;
        Ok(record)
    }

    fn station_stock(&mut self, id: i64) -> Result<Option<Arc<StationStock>>, ProtocolError> {
        let catalog = &self.catalog;
        let Some(entity) = self.entities.get_mut(&id) else {
            return Ok(None);
        };
        let EntityKind::Station(station) = &mut entity.model else {
            return Ok(None);
        };
        if station.stock_replication.is_none() {
            station.stock_replication = Some(Arc::new(capture_station_stock(
                &station.craft,
                entity.incarnation,
                catalog,
            )?));
        }
        Ok(station.stock_replication.clone())
    }
}

impl EntityKind {
    pub(crate) fn prepare_full_record(
        &self,
        catalog: &Catalog,
        batch: &SnapshotBatch,
    ) -> Result<EntityReplication, ProtocolError> {
        let mut record = EntityReplication::new(self.object().id as u64, 0, &catalog.protocol);
        let mut result = Ok(());
        record.prepare(batch, |record| result = capture(record, self, catalog));
        result?;
        Ok(record)
    }
}

fn capture(
    record: &mut EntityReplication,
    entity: &EntityKind,
    catalog: &Catalog,
) -> Result<(), ProtocolError> {
    let fields = &catalog.protocol.binary_field_ids;
    let object = entity.object();
    if let EntityKind::Item(item) = entity {
        record.number(fields.rounds, item.rounds.map(f64::from));
    }
    if let EntityKind::Asteroid(asteroid) = entity {
        record.asteroid_contents(fields.contents, &asteroid.contents);
        record.number(fields.decay, (object.decay != 0.0).then_some(object.decay));
        record.number(
            fields.max_health,
            (asteroid.max_health != object.radius * 2.0).then_some(asteroid.max_health),
        );
        record.outline(
            fields.shape_outline,
            object
                .shape_outline
                .as_ref()
                .map(|outline| outline.points.as_slice()),
        );
        record.capture_asteroid_segments(fields.segments, asteroid);
    }
    if let Some(craft) = entity.craft() {
        let mut modules = mounted_modules(craft, catalog);
        for object in &craft.cargo_contents {
            if let CargoObject::Module(module) = object {
                modules.push(module_source(module, None, catalog));
            }
        }
        cargo(record, craft, &modules, catalog)?;
        let max_speed = match entity {
            EntityKind::Ship(ship) => Some(ship.max_speed()),
            _ => (!object.speed_limit.is_nan()).then_some(object.speed_limit),
        };
        record.number(fields.docked_to, craft.docked_to.map(|id| id as f64));
        record.number(fields.max_speed, max_speed);
        record.number(
            fields.launching,
            craft.has_launching.then_some(craft.launching),
        );
        record.number(
            fields.transit_time,
            (craft.transit_time != 0.0).then_some(craft.transit_time),
        );
        record.number(
            fields.transit_gate,
            craft
                .transit_gate
                .filter(|gate| *gate != 0)
                .map(|id| id as f64),
        );
        capture_craft(record, craft, &modules, catalog)?;
    }
    if let EntityKind::Ship(ship) = entity {
        record.text(
            fields.npc_state,
            (!ship.npc_state.is_empty()).then_some(ship.npc_state),
        );
        record.text(
            fields.target_label,
            (!object.target_label.is_empty()).then_some(&object.target_label),
        );
        record.flag(fields.hostile, object.hostile.then_some(true));
        record.flag(fields.firing, Some(ship.firing));
        record.number(fields.fuel, Some(ship.fuel));
        record.number(fields.stored_power, Some(ship.stored_power));
        record.number(fields.thrust, Some(ship.forward));
        record.number(fields.turn, Some(ship.turn));
    }
    if let EntityKind::Portal(portal) = entity {
        record.number(fields.opening, Some(portal.opening));
        record.number(fields.opening_target, Some(portal.opening_target));
        record.number(
            fields.blocked_beams,
            portal
                .gate
                .is_some()
                .then_some(f64::from(portal.blocked_beams)),
        );
        record.text(fields.destination_name, Some(&portal.destination_name));
        record.text(fields.target_label, Some(&portal.target_label));
    }
    let friction = match entity {
        EntityKind::Module { module, .. } => module.spec.friction,
        _ => None,
    };
    record.base_fields(object, fields, entity.craft().is_some(), friction, None);
    Ok(())
}

fn mounted_modules<'a>(craft: &'a Craft, catalog: &Catalog) -> SmallVec<[ModuleSource<'a>; 16]> {
    // Craft construction orders mounts by hull layer. Only surviving
    // mounts occupy wire slots.
    craft
        .mounts
        .iter()
        .filter(|mount| {
            let hull = &craft.hulls[mount.hull];
            hull.present && (hull.health >= 1.0 || hull.health.is_nan())
        })
        .enumerate()
        .filter_map(|(index, mount)| {
            mount
                .module
                .as_ref()
                .map(|module| module_source(module, Some((index, mount)), catalog))
        })
        .collect()
}

fn capture_station_craft(
    record: &mut EntityReplication,
    craft: &Craft,
    catalog: &Catalog,
) -> Result<(), ProtocolError> {
    let fields = &catalog.protocol.binary_field_ids;
    let object = &craft.object;
    let modules = mounted_modules(craft, catalog);
    capture_craft(record, craft, &modules, catalog)?;
    let spec = catalog
        .station_specs
        .get(if object.definition_id.is_empty() {
            "corral-5"
        } else {
            &object.definition_id
        });
    record.base_fields(
        object,
        fields,
        true,
        None,
        spec.map(|spec| (spec.name.as_str(), spec.mass)),
    );
    Ok(())
}

fn capture_craft(
    record: &mut EntityReplication,
    craft: &Craft,
    modules: &[ModuleSource<'_>],
    catalog: &Catalog,
) -> Result<(), ProtocolError> {
    let fields = &catalog.protocol.binary_field_ids;
    let object = &craft.object;
    if object.kind != "station" {
        let health = craft
            .hulls
            .iter()
            .map(|hull| {
                if hull.plan.health.is_none() {
                    -1.0
                } else if !hull.present || hull.health.is_nan() {
                    0.0
                } else {
                    hull.health
                }
            })
            .collect::<SmallVec<[f64; 32]>>();
        record.numbers(fields.hull_health, Some(&health));
    }
    record.modules(fields.modules, (!modules.is_empty()).then_some(modules));
    if !craft.wreckage.is_empty() {
        let wreckage = craft
            .wreckage
            .iter()
            .map(|part| WreckageSegment {
                color: &part.color,
                radius: part.radius,
                offset: part.offset,
                health: part.health,
                shape_outline: part.outline.as_deref(),
                fill_shade: part.fill_shade,
                stroke: part.unstroked.then_some(&[]),
            })
            .collect::<SmallVec<[_; 8]>>();
        record.nested(
            fields.wreckage,
            FieldData::Wreckage(&wreckage),
            &catalog.protocol,
        )?;
    }
    record.number(fields.decay, (object.decay != 0.0).then_some(object.decay));
    record.strings(
        fields.shades,
        object.shades.as_deref().filter(|shades| {
            catalog
                .colors
                .get("white")
                .is_none_or(|white| white != shades)
        }),
    );
    Ok(())
}

fn capture_station_stock(
    craft: &Craft,
    incarnation: u64,
    catalog: &Catalog,
) -> Result<StationStock, ProtocolError> {
    let mut entries = Vec::with_capacity(craft.cargo_contents.len());
    let mut bytes = Vec::new();
    let mut templates = HashMap::new();
    for object in &craft.cargo_contents {
        let start = bytes.len();
        let id = object.id() as u64;
        match object {
            CargoObject::Item(item) => {
                let standard = item.object.resource.filter(|&resource| {
                    let template = templates.entry(resource).or_insert_with(|| {
                        let name = catalog.item_ids.get(usize::try_from(resource).ok()?)?;
                        Item::new(0, name, ObjectProperties::default(), catalog)
                    });
                    template
                        .as_ref()
                        .is_some_and(|template| standard_item(item, template))
                });
                if let Some(resource) = standard {
                    encode_stock_entry(
                        &mut bytes,
                        StockEntry::StandardItem {
                            id,
                            resource: resource as u64,
                        },
                        &catalog.protocol,
                    )?;
                } else {
                    let values = cargo_item(item, catalog);
                    encode_stock_entry(
                        &mut bytes,
                        StockEntry::Item(EntityRecord {
                            id,
                            values: &values,
                        }),
                        &catalog.protocol,
                    )?;
                }
            }
            CargoObject::Module(module) => {
                let source = module_source(module, None, catalog);
                encode_stock_entry(
                    &mut bytes,
                    StockEntry::Module(source.stock_state()),
                    &catalog.protocol,
                )?;
            }
        }
        entries.push((id, start..bytes.len()));
    }
    Ok(StationStock::new(
        craft.object.id as u64,
        incarnation,
        entries,
        bytes,
    ))
}

fn standard_item(item: &Item, template: &Item) -> bool {
    let a = &item.object;
    let b = &template.object;
    item.rounds == template.rounds
        && a.resource == b.resource
        && a.position == b.position
        && a.velocity == b.velocity
        && a.rotation == b.rotation
        && a.spin == b.spin
        && a.mass == b.mass
        && a.radius == b.radius
        && a.friction == b.friction
        && a.health == b.health
        && a.name == b.name
        && a.message == b.message
        && a.definition_id == b.definition_id
}

fn module_source<'a>(
    module: &'a InstalledModule,
    mount: Option<(usize, &'a Mount)>,
    catalog: &Catalog,
) -> ModuleSource<'a> {
    ModuleSource {
        module,
        kind_index: catalog
            .module_wire_index(&module.definition_id)
            .map_or(-1.0, |index| index as f64),
        mount,
    }
}

fn cargo(
    record: &mut EntityReplication,
    craft: &Craft,
    modules: &[ModuleSource<'_>],
    catalog: &Catalog,
) -> Result<(), ProtocolError> {
    let field = catalog.protocol.binary_field_ids.cargo_contents;
    if craft.cargo_contents.is_empty() {
        record.clear(field);
        return Ok(());
    }
    let item_fields = craft
        .cargo_contents
        .iter()
        .filter_map(|object| match object {
            CargoObject::Item(item) => Some(cargo_item(item, catalog)),
            CargoObject::Module(_) => None,
        })
        .collect::<SmallVec<[_; 4]>>();
    let mut item_fields = item_fields.iter();
    let entries = craft
        .cargo_contents
        .iter()
        .map(|object| match object {
            CargoObject::Item(item) => CargoEntry::Entity(EntityRecord {
                id: item.object.id as u64,
                values: item_fields.next().expect("fields for each cargo item"),
            }),
            CargoObject::Module(module) => CargoEntry::ModuleIndex(
                modules
                    .iter()
                    .position(|entry| entry.module.id == module.id)
                    .unwrap_or(0) as f64,
            ),
        })
        .collect::<SmallVec<[_; 8]>>();
    record.nested(field, FieldData::Cargo(&entries), &catalog.protocol)
}

fn cargo_item<'a>(item: &'a Item, catalog: &Catalog) -> SmallVec<[FieldValue<'a>; 16]> {
    let ids = &catalog.protocol.binary_field_ids;
    let object = &item.object;
    let mut values = SmallVec::<[FieldValue<'a>; 16]>::new();
    let mut add = |id, data| {
        values.push(FieldValue {
            id,
            value: Some(data),
        })
    };
    add(ids.kind, FieldData::Text("item"));
    if let Some(rounds) = item.rounds {
        add(ids.rounds, FieldData::Number(f64::from(rounds)));
    }
    if object.friction != 0.01 {
        add(ids.friction, FieldData::Number(object.friction));
    }
    if object.health.is_finite() {
        add(ids.health, FieldData::Number(object.health));
    }
    if !object.name.is_empty() {
        add(ids.name, FieldData::Text(&object.name));
    }
    if let Some(message) = &object.message {
        add(ids.message, FieldData::Text(message));
    }
    if let Some(resource) = object.resource {
        add(ids.resource, FieldData::Number(f64::from(resource)));
    }
    if !object.definition_id.is_empty() {
        add(ids.definition_id, FieldData::Text(&object.definition_id));
    }
    add(ids.mass, FieldData::Number(object.mass));
    add(ids.position, FieldData::Point(object.position));
    add(ids.radius, FieldData::Number(object.radius));
    add(ids.rotation, FieldData::Number(object.rotation));
    add(ids.spin, FieldData::Number(object.spin));
    if object.velocity != Vector::ZERO {
        add(ids.velocity, FieldData::Point(object.velocity));
    }
    values.sort_unstable_by_key(|field| field.id);
    values
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::protocol::append_entity_record_delta;
    use crate::simulation::game_object::ObjectProperties;

    use super::*;

    #[test]
    fn ship_npc_state_is_replicated_and_cleared() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let mut world = World::new(25.0, Arc::clone(&catalog));
        let id = world
            .spawn_player_ship(1, "mustang", ObjectProperties::default())
            .unwrap();
        let (source_index, _) = world
            .entities
            .indexed_values()
            .find(|(_, entity)| entity.model.object().id == id)
            .unwrap();
        let protocol = &catalog.protocol;
        let field = protocol.binary_field_ids.npc_state;
        let mut batch = SnapshotBatch::default();
        batch.begin();
        let mut baseline = world
            .prepare(source_index, id, EntityView::Full, &batch)
            .unwrap()
            .baseline();

        for state in ["Pursuing", "Waiting", "Fighting", "Collecting", ""] {
            let EntityKind::Ship(ship) = &mut world.entity_mut(id).unwrap().model else {
                panic!("fixture entity is not a ship");
            };
            ship.npc_state = state;
            batch.begin();
            let record = world
                .prepare(source_index, id, EntityView::Full, &batch)
                .unwrap();
            let fragment = batch
                .fragment(record, Some(baseline), protocol)
                .unwrap()
                .unwrap();
            baseline = record.baseline();

            let mut expected = Vec::new();
            append_entity_record_delta(
                &mut expected,
                &EntityRecord {
                    id: id as u64,
                    values: &[FieldValue {
                        id: field,
                        value: (!state.is_empty()).then_some(FieldData::Text(state)),
                    }],
                },
                protocol,
                None,
            )
            .unwrap();
            assert_eq!(batch.bytes(fragment), expected, "NPC state {state:?}");
        }

        batch.begin();
        let record = world
            .prepare(source_index, id, EntityView::Full, &batch)
            .unwrap();
        assert_eq!(
            batch.fragment(record, Some(baseline), protocol).unwrap(),
            None
        );
    }
}
