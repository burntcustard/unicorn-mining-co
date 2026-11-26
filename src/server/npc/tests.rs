use std::sync::Arc;

use crate::objects::ship::Ship;
use crate::simulation::game_object::ObjectProperties;
use crate::specs::Catalog;
use crate::utilities::vector::Vector;

use super::flight::{
    AttackOptions, AttackWeapon, FlightContext, FlightTarget, Movement, Pilot, direction_of,
};
use super::perception::{Obstacle, ObstacleGeometry, clear_segment};
use super::prediction::{PredictionOptions, Predictor, ShipMotion};
use super::route::{RouteOptions, RoutePlan};

fn ship_motion(catalog: &Catalog) -> ShipMotion {
    let mut id = -1;
    let mut ship = Ship::new_player(1, "courser", ObjectProperties::default(), catalog, || {
        id -= 1;
        id
    })
    .unwrap();
    ship.craft.launching = 0.0;
    ShipMotion::from_ship(&ship, catalog, 55.0)
}

#[test]
fn combat_pilot_tracks_beam_targets_and_leads_projectile_shots() {
    let catalog = Catalog::load().unwrap();
    let mut ship = ship_motion(&catalog);
    ship.rotation = 0.23;
    let target = FlightTarget {
        entity_id: 2,
        position: Vector::new(300.0, 0.0),
        velocity: Vector::new(0.0, 180.0),
        radius: 40.0,
        is_ship: true,
    };
    let context = FlightContext {
        ship,
        rules: catalog.npc_movement,
        tick: 0,
        simulation_step: catalog.simulation.simulation_step,
        launching: false,
        obstacles: &[],
        target: Some(target),
    };
    let options = AttackOptions {
        pass_distance: 70.0,
        aim_tolerance: 0.12,
        weapon: AttackWeapon::Beam { range: 700.0 },
        aim_prediction_time: 1.0,
        can_fire: true,
    };
    let (_, beam_turn, beam_fire) = Pilot::default().attack(context, target, options);
    assert!(beam_turn < 0.0 && beam_fire);
    let (projectile_thrust, projectile_turn, projectile_fire) = Pilot::default().attack(
        context,
        target,
        AttackOptions {
            weapon: AttackWeapon::Projectile {
                speed: 300.0,
                cannon: false,
            },
            ..options
        },
    );
    assert!(projectile_turn > 0.0 && !projectile_fire);
    assert_eq!(
        projectile_thrust, 1.0,
        "a clear attack pass uses full thrust"
    );

    let nearby = FlightTarget {
        position: Vector::new(210.0, 0.0),
        velocity: Vector::ZERO,
        ..target
    };
    let (nearby_thrust, _, nearby_fire) = Pilot::default().attack(context, nearby, options);
    assert_eq!(nearby_thrust, 0.0, "a beam pilot coasts in effective range");
    assert!(nearby_fire);

    let after_pass = FlightContext {
        ship: ShipMotion {
            position: Vector::new(400.0, 0.0),
            velocity: Vector::new(100.0, 0.0),
            rotation: 0.0,
            ..ship
        },
        ..context
    };
    for weapon in [
        options.weapon,
        AttackWeapon::Projectile {
            speed: 1_000.0,
            cannon: true,
        },
    ] {
        let (thrust, _, fire) =
            Pilot::default().attack(after_pass, nearby, AttackOptions { weapon, ..options });
        assert!(!fire, "the target is now behind the ship");
        assert_eq!(thrust, 1.0, "the ship accelerates away from the target");
    }

    // Keep the shot slightly off the predicted intercept for both weapon profiles.
    let off_axis = FlightContext {
        ship: ShipMotion {
            rotation: (180.0_f64 / 1_000.0).atan() + 0.17,
            ..ship
        },
        ..context
    };
    for (cannon, can_fire, expected) in [
        (true, true, true),
        (false, true, false),
        (true, false, false),
    ] {
        let (_, _, fire) = Pilot::default().attack(
            off_axis,
            target,
            AttackOptions {
                weapon: AttackWeapon::Projectile {
                    speed: 1_000.0,
                    cannon,
                },
                can_fire,
                ..options
            },
        );
        assert_eq!(fire, expected);
    }

    // The farther intercept exceeds the fallback horizon, and faster shots need less lead.
    let speed = 625.0;
    let relative_velocity = Vector::new(145.0, 225.0);
    let velocity = Vector::new(-50.0, 40.0);
    let leading_context = FlightContext {
        ship: ShipMotion {
            velocity,
            rotation: (relative_velocity.y / speed).asin() + 0.10,
            ..ship
        },
        ..context
    };
    for (distance, projectile_speed, expected_fire) in [
        (350.0, speed, true),
        (900.0, speed, true),
        (900.0, speed * 2.0, false),
    ] {
        let moving_target = FlightTarget {
            position: ship.position + Vector::new(distance, 0.0),
            velocity: velocity + relative_velocity,
            ..target
        };
        let (_, _, fire) = Pilot::default().attack(
            leading_context,
            moving_target,
            AttackOptions {
                weapon: AttackWeapon::Projectile {
                    speed: projectile_speed,
                    cannon: false,
                },
                ..options
            },
        );
        assert_eq!(
            fire, expected_fire,
            "firing alignment for a projectile at {projectile_speed} m/s and {distance} m"
        );
    }

    let spinning = FlightContext {
        ship: ShipMotion {
            spin: ship.maximum_turn_rate * 0.8,
            ..ship
        },
        ..context
    };
    let (_, braking_turn, _) = Pilot::default().attack(spinning, target, options);
    assert!(braking_turn > 0.0 && braking_turn < 0.8);

    let mut looping = Pilot::default();
    let mut reversed = false;
    for tick in (0..=240).step_by(6) {
        let (thrust, turn, _) = looping.attack(FlightContext { tick, ..context }, target, options);
        reversed |= turn > 0.0 && thrust == 1.0;
    }
    assert!(reversed, "a persistent turn triggers a powered reversal");
}

#[test]
fn route_navigates_neighboring_asteroid_clusters_in_either_direction() {
    let catalog = Catalog::load().unwrap();
    let rules = catalog.npc_movement;
    let simulation = &catalog.simulation;
    let ship = ship_motion(&catalog);
    let target = Vector::new(1600.0, 0.0);
    for mirror in [-1.0, 1.0] {
        let mut plan = RoutePlan::default();
        let obstacles = [
            Obstacle::circle(Vector::new(450.0, 0.0), 170.0),
            Obstacle::circle(Vector::new(650.0, mirror * 200.0), 170.0),
            Obstacle::circle(Vector::new(900.0, mirror * -180.0), 170.0),
            Obstacle::circle(Vector::new(1200.0, mirror * 40.0), 170.0),
        ];
        let mut position = Vector::ZERO;
        for decision in 0..100 {
            if position.distance(target) <= 10.0 {
                break;
            }
            let (waypoint, _) = plan.waypoint(
                RouteOptions {
                    position,
                    target,
                    ship_radius: ship.radius,
                    minimum_speed_squared: simulation.motion.minimum_speed_squared,
                    simulation_step: simulation.simulation_step,
                    tick: decision * 6,
                    rules,
                },
                &obstacles,
            );
            let offset = waypoint - position;
            assert!(offset.length() >= 1.0, "route stalled at {position:?}");
            assert!(clear_segment(
                position,
                waypoint,
                ship.radius + rules.clearance_distance,
                &obstacles,
                false
            ));
            position = position.add_scaled(offset.normalized(), offset.length().min(80.0));
        }
        assert!(
            position.distance(target) <= 10.0,
            "never exited cluster at {position:?}"
        );
    }
}

#[test]
fn prediction_checks_crossings_between_samples_and_rotating_outlines() {
    let catalog = Catalog::load().unwrap();
    let rules = catalog.npc_movement;
    let mut ship = ship_motion(&catalog);
    let mut obstacle = Obstacle {
        velocity: Vector::new(3000.0, 0.0),
        ..Obstacle::circle(Vector::new(-150.0, 0.0), 1.0)
    };
    let mut forecast = Predictor::default();
    for offset in [0.0, ship.radius + rules.clearance_distance + 10.0] {
        obstacle.position.y = offset;
        forecast.reset(
            ship,
            rules,
            PredictionOptions {
                obstacles: std::slice::from_ref(&obstacle),
                radius: ship.radius,
                ..PredictionOptions::default()
            },
        );
        assert_eq!(forecast.predict(0.0, 0.0, 0.0).safe, offset != 0.0);
    }
    ship.position = Vector::new(0.0, 125.0);
    let polygon = Arc::new(
        ObstacleGeometry::new(
            &[
                [-180.0, -45.0],
                [180.0, -45.0],
                [180.0, 45.0],
                [-180.0, 45.0],
            ],
            0.0,
        )
        .unwrap(),
    );
    for spin in [-0.5, 0.0, 0.5] {
        let rock = Obstacle {
            spin,
            polygon: Some(Arc::clone(&polygon)),
            ..Obstacle::circle(Vector::ZERO, 200.0)
        };
        forecast.reset(
            ship,
            rules,
            PredictionOptions {
                obstacles: std::slice::from_ref(&rock),
                radius: ship.radius,
                ..PredictionOptions::default()
            },
        );
        assert_eq!(forecast.predict(0.0, 0.0, 0.0).safe, spin == 0.0);
    }
}

#[test]
fn obstacle_motion_matches_integrated_turning_braking_and_stop() {
    for (speed, heading, turn, change) in [
        (150.0, 0.7, 0.4, -35.0),
        (90.0, -1.2, -0.3, -40.0),
        (100.0, 0.4, 0.2, 20.0),
    ] {
        let direction = direction_of(heading);
        let side = Vector::new(-direction.y, direction.x);
        let obstacle = Obstacle {
            velocity: direction * speed,
            acceleration: direction * change + side * (speed * turn),
            ..Obstacle::circle(Vector::new(42.0, -71.0), 1.0)
        };
        for duration in [0.2, 1.7, 2.5, 6.0] {
            let mut position = obstacle.position;
            let mut time = 0.0;
            while time < duration {
                let step = 0.0001_f64.min(duration - time);
                let middle = time + step * 0.5;
                let velocity = (speed + change * middle).max(0.0);
                let direction = direction_of(heading + turn * middle);
                position = position.add_scaled(direction, velocity * step);
                time += step;
            }
            assert!(obstacle.position_at(duration).distance(position) <= 0.0001);
        }
    }
}

#[test]
fn waiting_pilot_faces_the_destination_without_thrusting() {
    let catalog = Catalog::load().unwrap();
    let ship = ShipMotion {
        rotation: -0.5,
        ..ship_motion(&catalog)
    };
    let mut pilot = Pilot::default();
    let context = FlightContext {
        ship,
        rules: catalog.npc_movement,
        tick: 0,
        simulation_step: catalog.simulation.simulation_step,
        launching: false,
        obstacles: &[],
        target: None,
    };
    let (thrust, turn) = pilot.steer(
        context,
        &Movement {
            position: Vector::new(300.0, 0.0),
            waiting: true,
            ..Movement::default()
        },
    );
    assert_eq!(thrust, 0.0);
    assert!(turn > 0.0);
}

use super::contact_forecast::{ContactForecast, ForecastKind, ForecastOptions, ForecastSource};
use super::perception::physical_bounds;
use crate::gameplay::collision_world::{CollisionEntity, GameCollisions, ObjectCollider};
use crate::gameplay::game_collisions::ColliderGeometry;
use crate::objects::item::Item;
use crate::objects::station::Station;
use crate::simulation::game_object::GameObject;

enum ForecastEntity<'a> {
    Ship(&'a mut Ship),
    Station(&'a mut Station),
    Item(&'a mut Item),
}

impl CollisionEntity for ForecastEntity<'_> {
    type Collider = ObjectCollider;

    fn object(&self) -> &GameObject {
        match self {
            Self::Ship(ship) => ship.object(),
            Self::Station(station) => station.object(),
            Self::Item(item) => item.object(),
        }
    }

    fn object_mut(&mut self) -> &mut GameObject {
        match self {
            Self::Ship(ship) => ship.object_mut(),
            Self::Station(station) => station.object_mut(),
            Self::Item(item) => item.object_mut(),
        }
    }

    fn with_colliders(&self, use_colliders: impl FnOnce(&[ColliderGeometry<'_, Self::Collider>])) {
        match self {
            Self::Ship(ship) => ship.with_colliders(use_colliders),
            Self::Station(station) => station.with_colliders(use_colliders),
            Self::Item(item) => item.with_colliders(use_colliders),
        }
    }
}

#[test]
fn detached_contact_forecast_rejects_station_wall_as_in_go() {
    let catalog = Catalog::load().unwrap();
    let rules = &catalog.simulation;
    let mut id = -1;
    let mut ship = Ship::new_player(
        1,
        "courser",
        ObjectProperties {
            position: Vector::new(500.0, 0.0),
            ..ObjectProperties::default()
        },
        &catalog,
        || {
            id -= 1;
            id
        },
    )
    .unwrap();
    let mut station = Station::new(
        100,
        "corral-5",
        ObjectProperties {
            radius: Some(400.0),
            ..ObjectProperties::default()
        },
        Some(Vec::new()),
        &catalog,
        || unreachable!(),
    )
    .unwrap();
    let mut collisions = GameCollisions::new(&catalog, true);
    let mut entities = [
        ForecastEntity::Ship(&mut ship),
        ForecastEntity::Station(&mut station),
    ];
    collisions.capture_poses(&mut entities);
    collisions.step(&mut entities, 0.0, &catalog, &mut Vec::new());
    ship.craft.object.position = Vector::new(260.0, 150.0);
    let (radius, _) = physical_bounds(&ship, false, rules.linear_slop);
    let motion = ShipMotion::from_ship(&ship, &catalog, radius);
    let forecast = ContactForecast::new(
        ForecastOptions {
            catalog: &catalog,
            ship_motion: motion,
            tick: 0,
            docking: true,
            can_dock: true,
            can_collect: false,
            centers: &[],
        },
        ForecastSource {
            object: &ship.craft.object,
            kind: ForecastKind::Ship,
            prepared: collisions.prepared_body(1),
        },
        ForecastSource {
            object: &station.craft.object,
            kind: ForecastKind::Station {
                local_movement_radius: station.local_movement_radius,
            },
            prepared: collisions.prepared_body(100),
        },
        [],
    );
    let prediction = forecast
        .predict(0.0, 0.0, rules.simulation_step, 0.0)
        .unwrap();
    assert!(!prediction.safe && !prediction.arrived);
}

#[test]
fn detached_pickup_forecast_leaves_live_cargo_and_parent_unchanged() {
    let catalog = Catalog::load().unwrap();
    let rules = &catalog.simulation;
    let mut id = -1;
    let mut ship = Ship::new_player(
        1,
        "courser",
        ObjectProperties {
            player_number: Some(1),
            ..ObjectProperties::default()
        },
        &catalog,
        || {
            id -= 1;
            id
        },
    )
    .unwrap();
    ship.craft.set_module_active("cargoHatch", true);
    ship.craft.update_modules(1.0, 1.0, None);
    let mut station = Station::new(
        100,
        "corral-5",
        ObjectProperties {
            spin: 0.03,
            ..ObjectProperties::default()
        },
        Some(Vec::new()),
        &catalog,
        || unreachable!(),
    )
    .unwrap();
    let mut item = Item::new(
        101,
        "gold",
        ObjectProperties {
            position: Vector::new(200.0, 50.0),
            velocity: Vector::new(80.0, -35.0),
            spin: -2.4,
            ..ObjectProperties::default()
        },
        &catalog,
    )
    .unwrap();
    item.object.local_movement.parent = Some(100);
    item.object.local_movement.rate = 0.4;
    item.object.decay = 100.0;
    item.object.health = 0.1;
    let mut collisions = GameCollisions::new(&catalog, true);
    let mut entities = [
        ForecastEntity::Ship(&mut ship),
        ForecastEntity::Station(&mut station),
        ForecastEntity::Item(&mut item),
    ];
    collisions.capture_poses(&mut entities);
    collisions.step(&mut entities, 0.0, &catalog, &mut Vec::new());
    let before = [&ship.craft.object, &station.craft.object, &item.object].map(Clone::clone);
    let (radius, _) = physical_bounds(&ship, false, rules.linear_slop);
    let motion = ShipMotion::from_ship(&ship, &catalog, radius);
    let forecast = ContactForecast::new(
        ForecastOptions {
            catalog: &catalog,
            ship_motion: motion,
            tick: 0,
            docking: false,
            can_dock: false,
            can_collect: true,
            centers: &[],
        },
        ForecastSource {
            object: &ship.craft.object,
            kind: ForecastKind::Ship,
            prepared: collisions.prepared_body(1),
        },
        ForecastSource {
            object: &item.object,
            kind: ForecastKind::GameObject,
            prepared: collisions.prepared_body(101),
        },
        [ForecastSource {
            object: &station.craft.object,
            kind: ForecastKind::Station {
                local_movement_radius: station.local_movement_radius,
            },
            prepared: collisions.prepared_body(100),
        }],
    );
    assert!(forecast.predict(1.0, 0.0, 6.0, 0.0).is_some());
    for (current, before) in [&ship.craft.object, &station.craft.object, &item.object]
        .into_iter()
        .zip(before)
    {
        assert_eq!(current.position, before.position);
        assert_eq!(current.velocity, before.velocity);
        assert_eq!(current.rotation, before.rotation);
        assert_eq!(current.spin, before.spin);
        assert_eq!(current.health.to_bits(), before.health.to_bits());
        assert_eq!(current.dead, before.dead);
        assert_eq!(current.local_movement.parent, before.local_movement.parent);
        assert_eq!(current.local_movement.rate, before.local_movement.rate);
    }
    assert!(ship.craft.cargo_contents.is_empty());
}
