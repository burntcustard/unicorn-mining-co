use serde_json::{Value, json};
use unicorn_mining_server::gameplay::collision_world::ColliderPart;
use unicorn_mining_server::objects::ship::Ship;
use unicorn_mining_server::vector::RotValue;

pub fn capture(ship: &Ship, colliding: bool) -> Vec<Value> {
    let object = &ship.craft.object;
    let (sin, cos) = (-object.rotation).sin_cos();
    let inverse = RotValue { sin, cos };
    let mut result = Vec::new();
    ship.craft.with_hitboxes(|colliders| {
        result.extend(
            colliders
                .iter()
                .filter(|collider| !colliding || collider.collides)
                .map(|collider| {
                    let hull_index = match collider.user_data.part {
                        ColliderPart::Hull(index) => index as i64,
                        _ => -1,
                    };
                    json!({
                        "hullIndex": hull_index,
                        "position": collider.pose.position,
                        "localPosition": inverse.rotate(collider.pose.position - object.position),
                        "radius": collider.radius,
                        "points": collider.outline,
                    })
                }),
        );
    });
    result
}
