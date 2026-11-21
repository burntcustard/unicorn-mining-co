use crate::simulation::game_object::{GameObject, ObjectProperties};
use crate::specs::{CRAFT_FRICTION, CRAFT_HEALTH, Catalog};

use super::craft::Craft;

pub fn new_nav_beacon(id: i64, mut properties: ObjectProperties, catalog: &Catalog) -> Craft {
    let spec = &catalog.nav_beacon_spec;
    properties.mass.get_or_insert(spec.mass);
    properties.radius.get_or_insert(spec.radius);
    properties.friction.get_or_insert(CRAFT_FRICTION);
    properties.health.get_or_insert(CRAFT_HEALTH);
    let mut object = GameObject::new(id, properties, &catalog.simulation);
    object.kind = "navBeacon".into();
    object.name.clone_from(&spec.name);
    object.shades = catalog.colors.get("white").cloned();
    Craft::new(object, &spec.hull_segments)
}
