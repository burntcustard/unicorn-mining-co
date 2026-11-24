//! Transient multiplayer audio derived from authoritative simulation events.

use crate::protocol::{SimulationEvent, WorldSound};
use crate::utilities::vector::Vector;
use crate::websocket::MAX_SNAPSHOT_BUFFER;

#[derive(Clone, Copy, Debug)]
pub struct SoundShip {
    pub id: i64,
    pub position: Vector,
}

pub trait WorldSoundLookup {
    fn player_ship(&self, player_number: i64) -> Option<SoundShip>;
    fn ship_player(&self, entity_id: i64) -> Option<i64>;
    fn entity_player(&self, entity_id: i64) -> Option<i64>;
    fn entity_position(&self, entity_id: i64) -> Option<Vector>;
}

fn owner(lookup: &impl WorldSoundLookup, id: i64) -> i64 {
    lookup
        .ship_player(id)
        .or_else(|| lookup.entity_player(id))
        .unwrap_or_default()
}

fn player_sound(effect: u8, by: i64, lookup: &impl WorldSoundLookup, sounds: &mut Vec<WorldSound>) {
    if let Some(ship) = lookup.player_ship(by) {
        sounds.push(WorldSound {
            effect,
            id: ship.id,
            by,
            position: ship.position,
        });
    }
}

pub fn build_world_sounds(
    events: &[SimulationEvent],
    lookup: &impl WorldSoundLookup,
    sounds: &mut Vec<WorldSound>,
) {
    sounds.clear();
    for (index, event) in events.iter().enumerate() {
        match event {
            SimulationEvent::ItemCollected { by, .. } => player_sound(2, *by, lookup, sounds),
            SimulationEvent::ModuleChanged {
                module,
                player_number,
                active,
            } => {
                let effect = match (module.as_str(), active) {
                    ("cargoHatch", true) => 0,
                    ("cargoHatch", false) => 1,
                    ("shieldGenerator", true) => 6,
                    ("shieldGenerator", false) => 7,
                    ("searchLight", _) => 9,
                    _ => continue,
                };
                player_sound(effect, *player_number, lookup, sounds);
            }
            SimulationEvent::CollisionEvent {
                a,
                b,
                impact,
                shield,
                damage,
                position,
                ..
            } if *impact >= 40.0 => {
                if shield[0] || shield[1] {
                    let id = if shield[0] { *a } else { *b };
                    sounds.push(WorldSound {
                        effect: 5,
                        id,
                        by: owner(lookup, id),
                        position: *position,
                    });
                    continue;
                }
                for (id, amount) in [*a, *b].into_iter().zip(*damage) {
                    if amount > 0.0 {
                        let by = owner(lookup, id);
                        if by != 0 {
                            sounds.push(WorldSound {
                                effect: 3,
                                id,
                                by,
                                position: *position,
                            });
                        }
                    }
                }
            }
            SimulationEvent::AsteroidSplit { asteroid_id, .. } => {
                fracture_sound(events, index, *asteroid_id, None, lookup, sounds);
            }
            SimulationEvent::AsteroidDestroyed {
                asteroid_id, by, ..
            } => {
                fracture_sound(events, index, *asteroid_id, Some(*by), lookup, sounds);
            }
            _ => {}
        }
    }
}

fn fracture_sound(
    events: &[SimulationEvent],
    index: usize,
    id: i64,
    destroyed_by: Option<i64>,
    lookup: &impl WorldSoundLookup,
    sounds: &mut Vec<WorldSound>,
) {
    // A collision event can follow the fracture. Check the nearer side first,
    // with an equal-distance tie choosing the earlier event.
    let maximum_distance = index.max(events.len() - index - 1);
    for distance in 1..=maximum_distance {
        for candidate in [index.checked_sub(distance), Some(index + distance)]
            .into_iter()
            .flatten()
        {
            match events.get(candidate) {
                Some(
                    SimulationEvent::DrillDamage {
                        target_id,
                        by,
                        position,
                        ..
                    }
                    | SimulationEvent::LaserDamage {
                        target_id,
                        by,
                        position,
                        ..
                    },
                ) if *target_id == id => {
                    sounds.push(WorldSound {
                        effect: 4,
                        id,
                        by: destroyed_by.unwrap_or(*by),
                        position: *position,
                    });
                    return;
                }
                Some(SimulationEvent::CollisionEvent {
                    a,
                    b,
                    impact,
                    shield,
                    position,
                    ..
                }) if *a == id || *b == id => {
                    let shield_bounce = *impact >= 40.0 && (shield[0] || shield[1]);
                    if !shield_bounce {
                        let other = if *a == id { *b } else { *a };
                        let by = destroyed_by.unwrap_or_else(|| owner(lookup, other));
                        sounds.push(WorldSound {
                            effect: 4,
                            id,
                            by,
                            position: *position,
                        });
                    }
                    return;
                }
                _ => {}
            }
        }
    }

    if let Some(position) = lookup.entity_position(id) {
        sounds.push(WorldSound {
            effect: 4,
            id,
            by: destroyed_by.unwrap_or_default(),
            position,
        });
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SoundRecipient {
    pub player_number: i64,
    pub position: Vector,
    pub socket_open: bool,
    pub needs_load: bool,
    pub welcome_pending: bool,
    pub in_world: bool,
    pub buffered_bytes: usize,
}

pub fn nearby_world_sounds<'a>(
    sounds: &[WorldSound],
    recipient: SoundRecipient,
    reach: f64,
    nearby: &'a mut Vec<WorldSound>,
) -> &'a [WorldSound] {
    nearby.clear();
    if recipient.socket_open
        && !recipient.needs_load
        && !recipient.welcome_pending
        && recipient.in_world
        && recipient.buffered_bytes <= MAX_SNAPSHOT_BUFFER
    {
        let squared_reach = reach * reach;
        nearby.extend(sounds.iter().copied().filter(|sound| {
            sound.by == recipient.player_number
                || sound.position.distance_squared(recipient.position) <= squared_reach
        }));
    }
    nearby
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHIP: i64 = 25;
    const ACTOR: i64 = 7;
    const SHIP_POSITION: Vector = Vector { x: 100.0, y: 200.0 };
    const CONTACT: Vector = Vector { x: 150.0, y: 200.0 };

    struct Lookup;

    impl WorldSoundLookup for Lookup {
        fn player_ship(&self, player_number: i64) -> Option<SoundShip> {
            (player_number == ACTOR).then_some(SoundShip {
                id: SHIP,
                position: SHIP_POSITION,
            })
        }

        fn ship_player(&self, entity_id: i64) -> Option<i64> {
            (entity_id == SHIP).then_some(ACTOR)
        }

        fn entity_player(&self, entity_id: i64) -> Option<i64> {
            match entity_id {
                SHIP => Some(8),
                26 => Some(9),
                _ => None,
            }
        }

        fn entity_position(&self, entity_id: i64) -> Option<Vector> {
            (entity_id == -98).then_some(CONTACT)
        }
    }

    fn collision(a: i64, b: i64, shield: [bool; 2]) -> SimulationEvent {
        SimulationEvent::CollisionEvent {
            by: ACTOR,
            shield,
            a,
            b,
            impact: 400.0,
            colors: [String::new(), String::new()],
            damage: [2.0, 2.0],
            position: CONTACT,
        }
    }

    fn split() -> SimulationEvent {
        SimulationEvent::AsteroidSplit {
            asteroid_id: -99,
            child_ids: vec![],
        }
    }

    fn drill(target_id: i64) -> SimulationEvent {
        SimulationEvent::DrillDamage {
            target_id,
            by: ACTOR,
            position: CONTACT,
            damage: 5.0,
            color: "#fff".into(),
            resource: None,
        }
    }

    #[test]
    fn routes_authoritative_actions_in_order_and_applies_every_observer_limit() {
        let mut events = vec![SimulationEvent::ItemCollected {
            by: ACTOR,
            item_id: 99,
            message: None,
            resource: 1,
            unlock: None,
        }];
        for (module, active) in [
            ("cargoHatch", true),
            ("cargoHatch", false),
            ("shieldGenerator", true),
            ("shieldGenerator", false),
            ("searchLight", true),
            ("flightMode", true),
        ] {
            events.push(SimulationEvent::ModuleChanged {
                player_number: ACTOR,
                module: module.into(),
                active,
            });
        }
        events.extend([collision(SHIP, -99, [false; 2]), drill(-99), split()]);
        events.push(SimulationEvent::AsteroidDestroyed {
            asteroid_id: -99,
            by: ACTOR,
            contents: vec![],
        });
        let mut sounds = Vec::new();
        build_world_sounds(&events, &Lookup, &mut sounds);
        let effects = sounds.iter().map(|sound| sound.effect).collect::<Vec<_>>();
        assert_eq!(effects, [2, 0, 1, 6, 7, 9, 3, 4, 4]);
        assert!(
            sounds[..6].iter().all(|sound| sound.id == SHIP
                && sound.by == ACTOR
                && sound.position == SHIP_POSITION)
        );
        assert!(
            sounds[6..]
                .iter()
                .all(|sound| sound.by == ACTOR && sound.position == CONTACT)
        );

        let observer = SoundRecipient {
            player_number: 21,
            position: Vector::new(200.0, 200.0),
            socket_open: true,
            needs_load: false,
            welcome_pending: false,
            in_world: true,
            buffered_bytes: MAX_SNAPSHOT_BUFFER,
        };
        let mut nearby = Vec::new();
        assert_eq!(
            nearby_world_sounds(&sounds, observer, 200.0, &mut nearby),
            sounds
        );
        for skipped in [
            SoundRecipient {
                socket_open: false,
                ..observer
            },
            SoundRecipient {
                in_world: false,
                ..observer
            },
            SoundRecipient {
                needs_load: true,
                ..observer
            },
            SoundRecipient {
                welcome_pending: true,
                ..observer
            },
            SoundRecipient {
                buffered_bytes: MAX_SNAPSHOT_BUFFER + 1,
                ..observer
            },
            SoundRecipient {
                position: Vector::new(1e9, 0.0),
                ..observer
            },
        ] {
            assert!(nearby_world_sounds(&sounds, skipped, 200.0, &mut nearby).is_empty());
        }
        let actor = SoundRecipient {
            player_number: ACTOR,
            position: Vector::new(1e9, 0.0),
            ..observer
        };
        assert_eq!(
            nearby_world_sounds(&sounds, actor, 200.0, &mut nearby),
            sounds
        );
    }

    #[test]
    fn shield_impact_supersedes_nearest_linked_fracture_in_either_order() {
        let expected = [WorldSound {
            effect: 5,
            id: SHIP,
            by: ACTOR,
            position: CONTACT,
        }];
        let mut sounds = Vec::new();
        for (a, b, shield) in [(SHIP, -99, [true, false]), (-99, SHIP, [false, true])] {
            build_world_sounds(&[split(), collision(a, b, shield)], &Lookup, &mut sounds);
            assert_eq!(sounds, expected);
            build_world_sounds(&[collision(a, b, shield), split()], &Lookup, &mut sounds);
            assert_eq!(sounds, expected);
        }

        let unrelated = SimulationEvent::AsteroidSplit {
            asteroid_id: -100,
            child_ids: vec![],
        };
        build_world_sounds(
            &[collision(SHIP, -99, [true, false]), drill(-100), unrelated],
            &Lookup,
            &mut sounds,
        );
        assert_eq!(
            sounds.iter().map(|sound| sound.effect).collect::<Vec<_>>(),
            [5, 4]
        );
    }

    #[test]
    fn fracture_attribution_uses_nearest_event_with_earlier_tie() {
        let later = SimulationEvent::LaserDamage {
            target_id: -99,
            by: 22,
            damage: 1.0,
            color: "#fff".into(),
            position: Vector::ZERO,
        };
        let mut sounds = Vec::new();
        build_world_sounds(&[drill(-99), split(), later], &Lookup, &mut sounds);
        assert_eq!(
            sounds,
            [WorldSound {
                effect: 4,
                id: -99,
                by: ACTOR,
                position: CONTACT
            }]
        );

        build_world_sounds(
            &[SimulationEvent::AsteroidDestroyed {
                asteroid_id: -98,
                by: 55,
                contents: vec![],
            }],
            &Lookup,
            &mut sounds,
        );
        assert_eq!(
            sounds,
            [WorldSound {
                effect: 4,
                id: -98,
                by: 55,
                position: CONTACT
            }]
        );

        build_world_sounds(
            &[split(), collision(26, -99, [false; 2])],
            &Lookup,
            &mut sounds,
        );
        assert_eq!(sounds[0].by, 9);
        assert_eq!(sounds[0].effect, 4);
    }
}
