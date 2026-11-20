use std::collections::HashMap;
use std::sync::Arc;

use smallvec::SmallVec;

use crate::objects::craft::{CargoObject, Craft, InstalledModule};
use crate::objects::item::Item;
use crate::objects::nav_beacon::new_nav_beacon;
use crate::objects::portal::Portal;
use crate::objects::projectile::Projectile;
use crate::objects::ship::Ship;
use crate::objects::station::Station;
use crate::random::SeededRandom;
use crate::replication::records::EntityReplication;
use crate::specs::Catalog;
use crate::utilities::OrderedMap;
use crate::vector::Vector;

use super::asteroid::Asteroid;
use super::asteroid_geometry::AsteroidOutlines;
use super::game_object::{GameObject, ObjectProperties};
use super::local_movement::MovementParent;
use super::regions::field_message;
use super::streaming::{GeneratedEntity, StreamingWorld};
use super::world_step::WorldIds;

pub enum EntityKind {
    Object(Box<GameObject>),
    Ship(Box<Ship>),
    Station(Box<Station>),
    Craft(Box<Craft>),
    Portal(Box<Portal>),
    Item(Box<Item>),
    Module {
        object: Box<GameObject>,
        module: InstalledModule,
    },
    Asteroid(Box<Asteroid>),
    Projectile(Box<Projectile>),
}

impl EntityKind {
    pub fn object(&self) -> &GameObject {
        match self {
            Self::Object(object) => object,
            Self::Ship(ship) => &ship.craft.object,
            Self::Station(station) => &station.craft.object,
            Self::Craft(craft) => &craft.object,
            Self::Portal(portal) => &portal.object,
            Self::Item(item) => &item.object,
            Self::Module { object, .. } => object,
            Self::Asteroid(asteroid) => &asteroid.object,
            Self::Projectile(projectile) => &projectile.object,
        }
    }

    pub fn object_mut(&mut self) -> &mut GameObject {
        match self {
            Self::Object(object) => object,
            Self::Ship(ship) => &mut ship.craft.object,
            Self::Station(station) => &mut station.craft.object,
            Self::Craft(craft) => &mut craft.object,
            Self::Portal(portal) => &mut portal.object,
            Self::Item(item) => &mut item.object,
            Self::Module { object, .. } => object,
            Self::Asteroid(asteroid) => &mut asteroid.object,
            Self::Projectile(projectile) => &mut projectile.object,
        }
    }

    pub fn craft(&self) -> Option<&Craft> {
        match self {
            Self::Ship(ship) => Some(&ship.craft),
            Self::Station(station) => Some(&station.craft),
            Self::Craft(craft) => Some(craft),
            _ => None,
        }
    }

    pub fn craft_mut(&mut self) -> Option<&mut Craft> {
        match self {
            Self::Ship(ship) => Some(&mut ship.craft),
            Self::Station(station) => Some(&mut station.craft),
            Self::Craft(craft) => Some(craft),
            _ => None,
        }
    }

    pub fn movement_parent(&self) -> Option<MovementParent> {
        match self {
            Self::Station(station) => Some(station.movement_parent()),
            _ => None,
        }
    }
}

pub struct Entity {
    pub model: EntityKind,
    pub generated: bool,
    pub incarnation: u64,
    pub(crate) replication: Option<EntityReplication>,
}

#[derive(Clone, Copy)]
pub(crate) struct EntityChange {
    pub(crate) generated: bool,
    pub(crate) removed: bool,
}

impl Entity {
    pub(crate) fn belongs_in_world_save(&self) -> bool {
        let object = self.model.object();
        object.player_id.is_none()
            && !matches!(object.kind.as_str(), "jumpGate" | "wormhole")
            && !matches!(self.model, EntityKind::Projectile(_))
    }

    pub(crate) fn transient(&self) -> bool {
        let object = self.model.object();
        object.decay > 0.0
            && match &self.model {
                EntityKind::Asteroid(asteroid) => asteroid.decaying(),
                _ => true,
            }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Player {
    pub id: i64,
    pub ship_id: i64,
    pub observer_range: f64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum IndexedEntityKind {
    Station,
    Portal,
}

impl IndexedEntityKind {
    fn of(model: &EntityKind) -> Option<Self> {
        match model {
            EntityKind::Station(_) => Some(Self::Station),
            EntityKind::Portal(_) => Some(Self::Portal),
            _ => None,
        }
    }
}

/// Entity insertion order determines tick and wire order.
pub struct World {
    pub catalog: Arc<Catalog>,
    pub tick: u64,
    pub ids: WorldIds,
    pub random: SeededRandom,
    pub(crate) entities: OrderedMap<i64, Entity>,
    pub(crate) players: OrderedMap<i64, Player>,
    pub(crate) outlines: AsteroidOutlines,
    entity_epoch: u64,
    // Retain registry order and keep slots for temporarily detached entities.
    indexed_entities: SmallVec<[(i64, IndexedEntityKind); 8]>,
    portal_epoch: u64,
    next_incarnation: u64,
    removed_parents: HashMap<i64, MovementParent>,
    save_changes: Option<HashMap<i64, EntityChange>>,
    destroyed_ships: Vec<Entity>,
}

impl World {
    pub fn new(seed: f64, catalog: Arc<Catalog>) -> Self {
        Self {
            catalog,
            tick: 0,
            ids: WorldIds::default(),
            random: SeededRandom::new(seed),
            entities: OrderedMap::default(),
            players: OrderedMap::default(),
            outlines: AsteroidOutlines::default(),
            entity_epoch: 0,
            indexed_entities: SmallVec::new(),
            portal_epoch: 0,
            next_incarnation: 1,
            removed_parents: HashMap::new(),
            save_changes: None,
            destroyed_ships: Vec::new(),
        }
    }

    pub fn entity_epoch(&self) -> u64 {
        self.entity_epoch
    }
    pub fn entity(&self, id: i64) -> Option<&Entity> {
        self.entities.get(&id)
    }
    pub fn entity_mut(&mut self, id: i64) -> Option<&mut Entity> {
        self.entities.get_mut(&id)
    }
    pub fn entities(&self) -> impl Iterator<Item = &Entity> {
        self.entities.values()
    }
    pub(crate) fn portal_epoch(&self) -> u64 {
        self.portal_epoch
    }
    pub(crate) fn portal_ids(&self) -> impl Iterator<Item = i64> + '_ {
        self.indexed_entities
            .iter()
            .filter_map(|&(id, kind)| (kind == IndexedEntityKind::Portal).then_some(id))
    }
    pub fn players(&self) -> impl Iterator<Item = &Player> {
        self.players.values()
    }
    pub fn player(&self, id: i64) -> Option<&Player> {
        self.players.get(&id)
    }
    pub fn set_player(&mut self, player: Player) {
        self.players.set(player.id, player);
    }
    pub fn remove_player(&mut self, id: i64) -> Option<Player> {
        self.players.remove(&id)
    }

    pub fn add_entity(&mut self, model: EntityKind, generated: bool) {
        let id = model.object().id;
        let entity = self.make_entity(model, generated);
        self.wake(entity);
        if !generated {
            self.mark_entity_changed(id);
        }
    }

    pub(crate) fn make_entity(&mut self, model: EntityKind, generated: bool) -> Entity {
        let incarnation = self.next_incarnation;
        self.next_incarnation = incarnation.wrapping_add(1);
        Entity {
            model,
            generated,
            incarnation,
            replication: None,
        }
    }

    pub fn remove_entity(&mut self, id: i64) -> Option<Entity> {
        let entity = self.unload_entity(id)?;
        self.record_change(&entity, true);
        Some(entity)
    }

    pub(crate) fn destroy_entity(&mut self, id: i64) {
        if let Some(entity) = self.remove_entity(id)
            && matches!(entity.model, EntityKind::Ship(_))
            && entity.model.object().dead
            && entity.model.object().player_id.is_some()
        {
            self.destroyed_ships.push(entity);
        }
    }

    pub(crate) fn take_destroyed_ships(&mut self) -> Vec<Entity> {
        std::mem::take(&mut self.destroyed_ships)
    }

    fn unload_entity(&mut self, id: i64) -> Option<Entity> {
        self.update_entity_index(id, None);
        let entity = self.entities.remove(&id)?;
        if let Some(parent) = entity.model.movement_parent() {
            self.removed_parents.insert(
                id,
                MovementParent {
                    resident: false,
                    ..parent
                },
            );
        }
        self.entity_epoch = self.entity_epoch.wrapping_add(1);
        Some(entity)
    }

    pub fn mark_entity_changed(&mut self, id: i64) {
        if let Some(changes) = &mut self.save_changes
            && let Some(entity) = self.entities.get(&id)
            && entity.belongs_in_world_save()
        {
            changes.insert(
                id,
                EntityChange {
                    generated: entity.generated,
                    removed: false,
                },
            );
        }
    }

    fn record_change(&mut self, entity: &Entity, removed: bool) {
        if let Some(changes) = &mut self.save_changes
            && entity.belongs_in_world_save()
        {
            changes.insert(
                entity.model.object().id,
                EntityChange {
                    generated: entity.generated,
                    removed,
                },
            );
        }
    }

    pub(crate) fn save_changes(&mut self) -> &mut HashMap<i64, EntityChange> {
        self.save_changes.get_or_insert_with(HashMap::new)
    }

    pub fn parent(&self, id: i64) -> Option<MovementParent> {
        self.entity(id)
            .and_then(|entity| entity.model.movement_parent())
            .or_else(|| self.removed_parents.get(&id).copied())
    }

    pub fn clear_removed_parents(&mut self) {
        self.removed_parents.clear();
    }

    pub(crate) fn activate_station_physics(&mut self, positions: &[Vector]) {
        const PLAYER_RANGE_SQUARED: f64 = 2_000.0 * 2_000.0;
        let observers = self.bounded_observers().collect::<SmallVec<[_; 8]>>();
        for &(id, kind) in &self.indexed_entities {
            if kind == IndexedEntityKind::Station
                && let Some(Entity {
                    model: EntityKind::Station(station),
                    ..
                }) = self.entities.get_mut(&id)
            {
                let object = &mut station.craft.object;
                object.inactive_physics = !observers.iter().any(|&(position, range)| {
                    object.position.distance_squared(position) <= range * range
                }) && !positions.iter().any(|&position| {
                    object.position.distance_squared(position) <= PLAYER_RANGE_SQUARED
                });
            }
        }
    }

    pub(crate) fn finish_entity_update(&mut self, id: i64, value: Option<Entity>) {
        let kind = value
            .as_ref()
            .and_then(|entity| IndexedEntityKind::of(&entity.model));
        if value.is_none() {
            self.entity_epoch = self.entity_epoch.wrapping_add(1);
        }
        self.entities.finish_update(id, value);
        self.update_entity_index(id, kind);
    }

    fn update_entity_index(&mut self, id: i64, kind: Option<IndexedEntityKind>) {
        let index = self
            .indexed_entities
            .iter()
            .position(|&(indexed, _)| indexed == id);
        let previous = index.map(|index| self.indexed_entities[index].1);
        if previous == kind {
            return;
        }
        if previous == Some(IndexedEntityKind::Portal) || kind == Some(IndexedEntityKind::Portal) {
            self.portal_epoch = self.portal_epoch.wrapping_add(1);
        }
        match (index, kind) {
            (Some(index), Some(kind)) => self.indexed_entities[index].1 = kind,
            (Some(index), None) => {
                self.indexed_entities.remove(index);
            }
            (None, Some(kind)) => {
                // Replacing a model retains its slot, including while other
                // entries are temporarily held by simulation callbacks.
                let slot = self.entities.slot(&id).expect("indexed entity has a slot");
                let index = self.indexed_entities.partition_point(|&(id, _)| {
                    self.entities.slot(&id).expect("indexed entity has a slot") < slot
                });
                self.indexed_entities.insert(index, (id, kind));
            }
            (None, None) => {}
        }
    }

    pub fn spawn_player_ship(
        &mut self,
        player: i64,
        definition: &str,
        mut properties: ObjectProperties,
    ) -> Option<i64> {
        let id = self.ids.entity();
        properties.player_id = Some(player);
        let ship = Ship::new_player(id, definition, properties, &self.catalog, || {
            self.ids.object()
        })?;
        self.add_entity(EntityKind::Ship(Box::new(ship)), false);
        self.set_player(Player {
            id: player,
            ship_id: id,
            observer_range: 0.0,
        });
        Some(id)
    }
}

impl StreamingWorld for World {
    type Entity = Entity;

    fn entities(&self) -> impl Iterator<Item = &Self::Entity> {
        self.entities()
    }
    fn base(entity: &Self::Entity) -> &GameObject {
        entity.model.object()
    }

    fn bounded_observers(&self) -> impl Iterator<Item = (Vector, f64)> {
        self.players()
            .filter(|player| player.observer_range > 0.0)
            .filter_map(|player| {
                let object = self.entity(player.ship_id)?.model.object();
                (!object.dead).then_some((object.position, player.observer_range))
            })
    }

    fn contains(&self, id: i64) -> bool {
        self.entities.contains_key(&id)
    }

    fn wake(&mut self, entity: Self::Entity) {
        let id = entity.model.object().id;
        let kind = IndexedEntityKind::of(&entity.model);
        self.removed_parents.remove(&id);
        self.ids.record_entity(id);
        self.entities.set(id, entity);
        self.update_entity_index(id, kind);
        self.entity_epoch = self.entity_epoch.wrapping_add(1);
    }

    fn sleep(&mut self, id: i64) -> Option<Self::Entity> {
        let entity = self.unload_entity(id)?;
        self.record_change(&entity, false);
        Some(entity)
    }

    fn spawn_generated(&mut self, id: i64, description: GeneratedEntity<'_>) -> bool {
        let catalog = &self.catalog;
        let model = match description {
            GeneratedEntity::Asteroid(description) => EntityKind::Asteroid(Box::new(
                Asteroid::from_generated(id, description, catalog, &mut self.outlines),
            )),
            GeneratedEntity::Station(description) => {
                let properties = ObjectProperties {
                    position: description.position,
                    radius: Some(description.radius),
                    spin: description.spin,
                    ..ObjectProperties::default()
                };
                let Some(station) = Station::new(
                    id,
                    &description.definition_id,
                    properties,
                    None,
                    catalog,
                    || self.ids.entity(),
                ) else {
                    return false;
                };
                EntityKind::Station(Box::new(station))
            }
            GeneratedEntity::Wreck(description) => {
                let Some(mut wreck) = Ship::new(
                    id,
                    "",
                    ObjectProperties {
                        position: description.position,
                        ..ObjectProperties::default()
                    },
                    catalog,
                ) else {
                    return false;
                };
                for &resource in &description.cargo_contents {
                    let Some(definition) = catalog.item_ids.get(resource as usize) else {
                        return false;
                    };
                    let Some(item) = Item::new(
                        self.ids.entity(),
                        definition,
                        ObjectProperties::default(),
                        catalog,
                    ) else {
                        return false;
                    };
                    wreck
                        .craft
                        .cargo_contents
                        .push(CargoObject::Item(Box::new(item)));
                }
                if let Some(field) = &description.clue_field {
                    let message = field_message(field.position, field.resource, None);
                    let Some(item) = Item::new(
                        self.ids.entity(),
                        "message",
                        ObjectProperties {
                            message: Some(message),
                            ..ObjectProperties::default()
                        },
                        catalog,
                    ) else {
                        return false;
                    };
                    wreck
                        .craft
                        .cargo_contents
                        .push(CargoObject::Item(Box::new(item)));
                }
                wreck.craft.object.paint = Some(description.paint);
                EntityKind::Ship(Box::new(wreck))
            }
            GeneratedEntity::Beacon(description) => {
                let properties = ObjectProperties {
                    position: description.position,
                    rotation: description.rotation,
                    spin: description.spin,
                    ..ObjectProperties::default()
                };
                EntityKind::Craft(Box::new(new_nav_beacon(id, properties, catalog)))
            }
        };
        self.add_entity(model, true);
        true
    }
}

#[cfg(test)]
mod tests {
    use crate::objects::portal::PortalOptions;

    use super::*;

    #[test]
    fn portal_index_preserves_slots_through_replacement_and_transfers() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let mut world = World::new(25.0, Arc::clone(&catalog));
        let ordinary = |id| {
            EntityKind::Object(Box::new(GameObject::new(
                id,
                Default::default(),
                &catalog.simulation,
            )))
        };
        let portal = |id| {
            EntityKind::Portal(Box::new(Portal::new(
                PortalOptions {
                    id,
                    position: Vector::ZERO,
                    destination_sector: "destination".into(),
                    destination_name: "Destination".into(),
                    wormhole: true,
                },
                &catalog,
            )))
        };

        world.add_entity(ordinary(42), false);
        world.add_entity(portal(8), false);
        world.add_entity(portal(12), false);
        let epoch = world.portal_epoch();
        world.add_entity(ordinary(71), false);
        world.remove_entity(71);
        world.add_entity(portal(12), false);
        assert_eq!(world.portal_epoch(), epoch);

        let held = world.entities.take_for_update(&8).unwrap();
        world.add_entity(portal(42), false);
        world.finish_entity_update(8, Some(held));
        assert_eq!(world.portal_ids().collect::<Vec<_>>(), [42, 8, 12]);
        assert_ne!(world.portal_epoch(), epoch);

        let transferred = world.remove_entity(42).unwrap();
        assert_eq!(world.portal_ids().collect::<Vec<_>>(), [8, 12]);
        world.wake(transferred);
        assert_eq!(world.portal_ids().collect::<Vec<_>>(), [8, 12, 42]);

        world.add_entity(ordinary(8), false);
        assert_eq!(world.portal_ids().collect::<Vec<_>>(), [12, 42]);
        let _held = world.entities.take_for_update(&42).unwrap();
        world.finish_entity_update(42, None);
        assert_eq!(world.portal_ids().collect::<Vec<_>>(), [12]);
    }

    #[test]
    fn indexed_station_activation_uses_its_current_position_after_waking() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let mut world = World::new(25.0, Arc::clone(&catalog));
        let station = Station::new(
            5,
            "corral-5",
            Default::default(),
            Some(vec![]),
            &catalog,
            || 0,
        )
        .unwrap();
        world.add_entity(EntityKind::Station(Box::new(station)), true);

        world.activate_station_physics(&[Vector::new(2000.0, 0.0)]);
        assert!(!world.entity(5).unwrap().model.object().inactive_physics);
        let mut sleeping = world.sleep(5).unwrap();
        sleeping.model.object_mut().position = Vector::new(5000.0, 0.0);
        world.wake(sleeping);
        world.activate_station_physics(&[Vector::new(2000.0, 0.0)]);
        assert!(world.entity(5).unwrap().model.object().inactive_physics);
        world.activate_station_physics(&[Vector::new(3000.0, 0.0)]);
        assert!(!world.entity(5).unwrap().model.object().inactive_physics);
    }
}
