use crate::gameplay::game_collisions::{ColliderMaterial, Pose};
use crate::test_fixtures::load_example_catalog;
use crate::utilities::vector_math::RotValue;
use crate::{objects::ship::Ship, simulation::geometry::rotate_point};

use super::*;

struct Collider {
    part: ColliderPart,
    physical: bool,
    pickup: bool,
    outline: Vec<Point>,
}

struct Entity {
    object: GameObject,
    colliders: Vec<Collider>,
}

impl CollisionEntity for Entity {
    type Collider = ObjectCollider;

    fn object(&self) -> &GameObject {
        &self.object
    }

    fn object_mut(&mut self) -> &mut GameObject {
        &mut self.object
    }

    fn with_colliders(&self, visit: impl FnOnce(&[ColliderGeometry<'_, ObjectCollider>])) {
        if self.object.kind == "projectile" {
            visit(&[]);
            return;
        }
        if self.colliders.is_empty() {
            self.object.with_colliders(visit);
            return;
        }
        let colliders: SmallVec<[_; 8]> = self
            .colliders
            .iter()
            .map(|part| ColliderGeometry {
                pose: Pose {
                    position: self.object.position,
                    rotation: self.object.rotation,
                },
                radius: self.object.radius,
                collision_margin: None,
                outline: (!part.outline.is_empty()).then_some(part.outline.as_slice()),
                collides: part.physical,
                physical: part.physical,
                pickup_point: part.pickup,
                catches: false,
                user_data: ObjectCollider {
                    owner: self.object.id,
                    part: part.part,
                    dock_segment: false,
                    catches: false,
                    material: ColliderMaterial {
                        friction: 0.0,
                        bounciness: 0.0,
                        speed: 0.0,
                        gate_panel: None,
                    },
                },
            })
            .collect();
        visit(&colliders);
    }
}

struct World(Vec<Entity>);

impl WeaponWorld for World {
    type Entity = Entity;

    fn weapon_targets(&self) -> impl Iterator<Item = &Entity> {
        self.0.iter()
    }

    fn weapon_target(&self, id: i64) -> Option<&Entity> {
        self.0.iter().find(|entity| entity.object.id == id)
    }

    fn weapon_target_mut(&mut self, id: i64) -> Option<&mut Entity> {
        self.0.iter_mut().find(|entity| entity.object.id == id)
    }

    fn for_each_weapon_target_mut(&mut self, visit: impl FnMut(&mut Entity)) {
        self.0.iter_mut().for_each(visit);
    }

    fn fracture_asteroid(
        &mut self,
        entity: i64,
        _target: FractureTarget,
        by: i64,
        catalog: &Catalog,
        events: &mut Vec<SimulationEvent>,
    ) {
        let object = &mut self.weapon_target_mut(entity).unwrap().object;
        if object.kind == "asteroid" && object.health < 1.0 && !object.dead {
            object.dead = true;
            let position = object.position;
            events.push(SimulationEvent::AsteroidDestroyed {
                asteroid_id: entity,
                by,
                contents: vec![1],
            });
            self.0.push(body(200, position, 2.0, 1.0, catalog));
        }
    }
}

fn body(id: i64, position: Vector, radius: f64, mass: f64, catalog: &Catalog) -> Entity {
    Entity {
        object: GameObject::new(
            id,
            ObjectProperties {
                position,
                radius: Some(radius),
                mass: Some(mass),
                health: Some(100.0),
                ..Default::default()
            },
            &catalog.simulation,
        ),
        colliders: Vec::new(),
    }
}

#[test]
fn weapon_geometry_follows_awake_entity_incarnations() {
    use std::sync::Arc;

    use crate::simulation::streaming::StreamingWorld;
    use crate::simulation::world::{EntityKind, World as SimulationWorld};

    let catalog = Arc::new(Catalog::load().unwrap());
    let mut world = SimulationWorld::new(25.0, Arc::clone(&catalog));
    let mut geometry = WeaponGeometry::default();
    let add = |world: &mut SimulationWorld, id, radius| {
        world.add_entity(
            EntityKind::Object(Box::new(
                body(id, Vector::ZERO, radius, 1.0, &catalog).object,
            )),
            false,
        );
    };
    let cache = |world: &SimulationWorld, geometry: &mut WeaponGeometry, id, index| {
        let entity = world.entity(id).unwrap();
        entity.with_colliders(|colliders| {
            geometry.shape(
                colliders[0],
                entity.incarnation,
                index,
                catalog.simulation.linear_slop,
            );
        });
    };
    for id in 1..=4 {
        add(&mut world, id, 10.0);
        cache(&world, &mut geometry, id, 2);
    }

    let sleeper = world.sleep(1).unwrap();
    world.destroy_entity(2);
    add(&mut world, 2, 20.0);
    cache(&world, &mut geometry, 2, 0);
    assert_eq!(geometry.entities[&2].colliders.len(), 1);
    assert_eq!(
        geometry.entities[&2].colliders[0].as_ref().unwrap().radius,
        20.0
    );
    world.destroy_entity(3);
    add(&mut world, 3, 30.0);
    world.destroy_entity(4);

    geometry.retain_awake(|id| world.entity(id).map(|entity| entity.incarnation));
    assert_eq!(geometry.entities.len(), 1);
    assert!(geometry.entities.contains_key(&2));
    world.wake(sleeper);
    cache(&world, &mut geometry, 1, 0);
    assert_eq!(geometry.entities[&1].colliders.len(), 1);

    let entity = world.entity_mut(1).unwrap();
    entity.model.object_mut().radius = 40.0;
    cache(&world, &mut geometry, 1, 0);
    assert_eq!(
        geometry.entities[&1].colliders[0].as_ref().unwrap().radius,
        40.0
    );
}

#[test]
fn station_interior_absorbs_projectile_before_far_target_without_an_explosion() {
    let catalog = load_example_catalog().unwrap();
    let definition = "plasmaAccelerator";
    for mode in ["hull", "module", "ship", "nearerImpact"] {
        let mut station = body(1, Vector::new(50.0, 0.0), 22.4, 1.0, &catalog);
        station.object.kind = if mode == "ship" { "ship" } else { "station" }.into();
        station.colliders.push(Collider {
            part: if mode == "module" {
                ColliderPart::Module {
                    mount: 0,
                    model_part: 0,
                }
            } else {
                ColliderPart::Hull(0)
            },
            physical: false,
            pickup: false,
            outline: vec![[-10.0, -20.0], [10.0, -20.0], [10.0, 20.0], [-10.0, 20.0]],
        });

        let x = if mode == "nearerImpact" { 20.0 } else { 80.0 };
        let target = body(2, Vector::new(x, 0.0), 5.0, 1.0, &catalog);
        let mut world = World(vec![station, target]);
        let mut geometry = WeaponGeometry::default();
        let mut events = Vec::new();
        let mut projectile = Projectile::new(
            3,
            definition,
            ObjectProperties {
                velocity: Vector::new(1000.0, 0.0),
                ..Default::default()
            },
            &catalog,
        )
        .unwrap();
        projectile.capture_sweep();
        assert_eq!(projectile.update(0.1), MovementOutcome::Moved);
        projectile.resolve_hits(
            0.1,
            &mut WeaponContext {
                world: &mut world,
                geometry: &mut geometry,
                catalog: &catalog,
                events: &mut events,
            },
        );
        assert!(projectile.object.dead, "{mode}");
        if mode == "hull" {
            assert!(events.is_empty());
            assert_eq!(world.0[0].object.health, 100.0);
            assert_eq!(world.0[1].object.health, 100.0);
            assert_eq!(world.0[1].object.velocity, Vector::ZERO);
        } else {
            assert!(matches!(
                events.first(),
                Some(SimulationEvent::CollisionEvent { a: 3, b: 2, .. })
            ));
            assert_eq!(world.0[1].object.health, 100.0 - projectile.damage);
        }
    }
}

#[test]
fn expiry_explodes_once_and_hit_keeps_direct_damage_out_of_splash() {
    let catalog = load_example_catalog().unwrap();
    for definition in ["plasmaAccelerator", "autogun"] {
        for hit in [false, true] {
            let mut world = World(vec![
                body(1, Vector::new(20.0, 0.0), 5.0, 3.0, &catalog),
                body(2, Vector::new(13.0, 10.0), 1.0, 1.0, &catalog),
                body(3, Vector::new(13.0, 10.0), 1.0, 1000.0, &catalog),
                body(4, Vector::new(13.0, 50.0), 1.0, 1.0, &catalog),
                body(5, Vector::new(13.0, -8.0), 1.0, 1.0, &catalog),
                body(6, Vector::new(13.0, 12.0), 1.0, 1.0, &catalog),
            ]);
            world.0[4].object.buried = true;
            world.0[5].object.kind = "projectile".into();
            let mut geometry = WeaponGeometry::default();
            let mut events = Vec::new();
            let mut projectile = Projectile::new(
                7,
                definition,
                ObjectProperties {
                    player_number: Some(50),
                    position: Vector::new(if hit { -80.0 } else { 13.0 }, 0.0),
                    velocity: if hit {
                        Vector::new(600.0, 0.0)
                    } else {
                        Vector::ZERO
                    },
                    ..Default::default()
                },
                &catalog,
            )
            .unwrap();
            assert_eq!(projectile.object.health, projectile.damage);
            let mut context = WeaponContext {
                world: &mut world,
                geometry: &mut geometry,
                catalog: &catalog,
                events: &mut events,
            };
            if hit {
                projectile.update(0.3);
                projectile.resolve_hits(0.3, &mut context);
                assert!(matches!(
                    events.first(),
                    Some(SimulationEvent::CollisionEvent {
                        a: 7,
                        b: 1,
                        by: 50,
                        ..
                    })
                ));
                assert_eq!(world.0[0].object.health, 100.0 - projectile.damage);
            } else {
                assert_eq!(
                    projectile.update(projectile.spec.lifetime - 0.001),
                    MovementOutcome::Moved
                );
                assert!(!projectile.object.dead);
                assert_eq!(projectile.update(0.002), MovementOutcome::Died);
                projectile.on_death(&mut context);
                let first = context.events.len();
                projectile.on_death(&mut context);
                assert_eq!(context.events.len(), first);
                assert_eq!(
                    projectile.death_event().is_none(),
                    projectile.spec.fade_out > 0.0
                );
            }

            assert!(projectile.object.dead);
            assert_eq!(projectile.update(0.1), MovementOutcome::Skipped);
            if let Some(explosion) = &projectile.spec.explosion {
                let (light, heavy) = (&world.0[1].object, &world.0[2].object);
                assert!(light.velocity.y > heavy.velocity.y && heavy.velocity.y > 0.0);
                assert!(light.velocity.length() <= explosion.max_speed);
                assert_eq!(light.health, 100.0 - explosion.damage);
                assert_eq!(heavy.health, light.health);
                assert!(world.0[5].object.velocity.y > 0.0);
                assert_eq!(world.0[5].object.health, 100.0);
            } else {
                assert_eq!(world.0[1].object.health, 100.0);
                assert_eq!(world.0[1].object.velocity, Vector::ZERO);
            }
            for index in [3, 4] {
                assert_eq!(world.0[index].object.health, 100.0);
                assert_eq!(world.0[index].object.velocity, Vector::ZERO);
            }
        }
    }
}

#[test]
fn explosion_deduplicates_parts_and_pushes_fragments_created_by_damage() {
    let catalog = Catalog::load().unwrap();
    let mut fitted = body(1, Vector::new(10.0, 0.0), 2.0, 1.0, &catalog);
    for model_part in 0..2 {
        fitted.colliders.push(Collider {
            part: ColliderPart::Module {
                mount: 0,
                model_part,
            },
            physical: true,
            pickup: false,
            outline: Vec::new(),
        });
    }
    let mut asteroid = body(2, Vector::new(0.0, 10.0), 2.0, 1.0, &catalog);
    asteroid.object.kind = "asteroid".into();
    asteroid.object.health = 5.0;

    let mut world = World(vec![fitted, asteroid]);
    let mut geometry = WeaponGeometry::default();
    let mut events = Vec::new();
    explode(
        ExplosionSource {
            id: 3,
            player_number: Some(5),
            position: Vector::ZERO,
            velocity: Vector::ZERO,
        },
        &specs::ProjectileExplosion {
            radius: 20.0,
            impulse: 8.0,
            max_speed: 0.0,
            damage: 10.0,
        },
        None,
        &mut WeaponContext {
            world: &mut world,
            geometry: &mut geometry,
            catalog: &catalog,
            events: &mut events,
        },
    );

    assert_eq!(world.0[0].object.health, 90.0);
    assert!(world.0[1].object.dead);
    assert_eq!(world.0[2].object.health, 100.0);
    assert!(world.0[2].object.velocity.y > 0.0);
    assert!(matches!(
        events.as_slice(),
        [
            SimulationEvent::CollisionEvent { b: 1, .. },
            SimulationEvent::CollisionEvent { b: 2, .. },
            SimulationEvent::AsteroidDestroyed {
                asteroid_id: 2,
                by: 5,
                ..
            },
        ]
    ));
}

#[test]
fn splash_uses_shared_wreckage_health_and_separate_intact_parts() {
    use std::sync::Arc;

    use crate::objects::craft::{Craft, InstalledModule};
    use crate::objects::wreckage::WreckagePart;
    use crate::simulation::world::{EntityKind, World as SimulationWorld};

    let catalog = Arc::new(Catalog::load().unwrap());
    let mut world = SimulationWorld::new(25.0, Arc::clone(&catalog));
    let wreckage = Craft::from_wreckage(
        1,
        ObjectProperties {
            health: Some(100.0),
            ..Default::default()
        },
        [-3.0, 3.0]
            .map(|x| WreckagePart {
                color: String::new(),
                outline: None,
                radius: 2.0,
                offset: Vector::new(x, 0.0),
                health: 100.0,
                fill_shade: None,
                unstroked: false,
            })
            .to_vec(),
        None,
        &catalog,
    );
    world.add_entity(EntityKind::Craft(Box::new(wreckage)), false);

    let mut hulls = [-3.0, 3.0].map(|x| specs::HullSegment {
        health: Some(100.0),
        points: vec![[x - 1.0, -1.0], [x + 1.0, -1.0], [x, 1.0]],
        ..Default::default()
    });
    hulls[0].mounts.push(vec![specs::MountPoint::default()]);
    let mut intact = Craft::new(body(2, Vector::ZERO, 6.0, 1.0, &catalog).object, &hulls);
    intact.fit(
        0,
        Some(InstalledModule::new(
            4,
            "example".into(),
            Arc::new(specs::Module {
                health: 100.0,
                model: vec![
                    specs::ModelPart {
                        radius: 2.0,
                        ..Default::default()
                    };
                    2
                ],
                ..Default::default()
            }),
        )),
    );
    world.add_entity(EntityKind::Craft(Box::new(intact)), false);

    let mut direct = None;
    world.entity(1).unwrap().with_colliders(|colliders| {
        assert_eq!(colliders.len(), 2);
        direct = Some(colliders[0].user_data);
    });
    let source = ExplosionSource {
        id: 3,
        player_number: Some(5),
        position: Vector::ZERO,
        velocity: Vector::ZERO,
    };
    let spec = specs::ProjectileExplosion {
        radius: 12.0,
        damage: 10.0,
        ..Default::default()
    };
    let mut geometry = WeaponGeometry::default();

    for (exclude, expected_health) in [(None, 90.0), (direct, 80.0)] {
        let mut events = Vec::new();
        if let Some(hit) = exclude {
            assert_eq!(world.damage_weapon_target(hit, 10.0, 5, &mut events), 10.0);
        }
        explode(
            source,
            &spec,
            exclude,
            &mut WeaponContext {
                world: &mut world,
                geometry: &mut geometry,
                catalog: &catalog,
                events: &mut events,
            },
        );
        assert_eq!(world.entity(1).unwrap().object().health, expected_health);
        let intact = world.entity(2).unwrap().model.craft().unwrap();
        assert!(
            intact
                .hulls
                .iter()
                .all(|hull| hull.health == expected_health)
        );
        assert_eq!(intact.mounts[0].health, expected_health);
        assert_eq!(events.len(), if exclude.is_some() { 3 } else { 4 });
    }
}

#[test]
fn beams_damage_nearest_target_once_per_tick_at_rotated_poses() {
    let catalog = Catalog::load().unwrap();
    for angle in [0.0, std::f64::consts::FRAC_PI_2, std::f64::consts::PI] {
        let rotation = RotValue::new(angle);
        let position = |x| rotation.rotate(Vector::new(x, 8.0));
        let mut world = World(vec![
            body(2, position(250.0), 5.0, 1.0, &catalog),
            body(1, position(150.0), 5.0, 1.0, &catalog),
        ]);
        let mut geometry = WeaponGeometry::default();
        let mut events = Vec::new();
        let beam = LaserBeam {
            source: 3,
            player_number: 7,
            start: position(10.0),
            end: position(350.0),
            damage: 0.1,
        };
        for _ in 0..30 {
            resolve_laser(
                beam,
                1.0 / 30.0,
                &mut WeaponContext {
                    world: &mut world,
                    geometry: &mut geometry,
                    catalog: &catalog,
                    events: &mut events,
                },
            );
        }
        assert_eq!(world.0[0].object.health, 100.0);
        assert!((world.0[1].object.health - 97.0).abs() < 1e-10);
        assert_eq!(events.len(), 30);
        for event in events {
            let SimulationEvent::LaserDamage {
                target_id: 1,
                by: 7,
                position,
                ..
            } = event
            else {
                panic!("beam must damage its nearest physical target");
            };
            let local = RotValue::new(-angle).rotate(position);
            assert!((143.0..150.0).contains(&local.x));
            assert!((local.y - 8.0).abs() < 1e-9);
        }
    }
}

#[test]
fn ship_lasers_require_an_active_fully_deployed_mount() {
    use std::sync::Arc;

    use super::super::craft::InstalledModule;

    let catalog = load_example_catalog().unwrap();
    let source = Vector::new(10.0, 25.0);
    let angle = std::f64::consts::FRAC_PI_2;
    let mut ship = Ship::new(
        5,
        "mustang",
        ObjectProperties {
            player_number: Some(12),
            position: source,
            rotation: angle,
            ..Default::default()
        },
        &catalog,
    )
    .unwrap();
    let index = ship
        .craft
        .mounts
        .iter()
        .position(|mount| mount.accepts("laser"))
        .unwrap();
    let spec = Arc::new(catalog.module_specs["laser"].clone());
    ship.craft.fit(
        index,
        Some(InstalledModule::new(20, "laser".into(), Arc::clone(&spec))),
    );
    assert!(ship.laser_beams().next().is_none());

    ship.firing = true;
    ship.craft.set_module_active("laser", true);
    assert!(ship.laser_beams().next().is_none());
    let mount = &mut ship.craft.mounts[index];
    let position = mount.position;
    let module = mount.module.as_mut().unwrap();
    for part in &mut module.parts {
        part.activation_progress = 1.0;
    }
    module.aim_rotation = 0.25;
    let beam = ship.laser_beams().next().unwrap();
    let muzzle = rotate_point(Vector::new(spec.barrel_length, 0.0), 0.25);
    assert_eq!(beam.start, source + rotate_point(position + muzzle, angle));
    assert_eq!(
        beam.end,
        beam.start + rotate_point(Vector::new(spec.reach, 0.0), angle + 0.25)
    );
    assert_eq!(beam.damage, spec.damage);
    assert_eq!((beam.source, beam.player_number), (5, 12));

    ship.craft.launching = 1.0;
    assert!(ship.laser_beams().next().is_none());
    ship.craft.launching = 0.0;
    ship.craft.docked_to = Some(99);
    assert!(ship.laser_beams().next().is_none());
    ship.craft.docked_to = None;
    ship.craft.set_module_active("laser", false);
    assert!(ship.laser_beams().next().is_none());
}

#[test]
fn indexed_projectile_targets_keep_motion_boundary_and_nan_fallback() {
    let catalog = Catalog::load().unwrap();
    let mut on_edge = body(10, Vector::new(52.5, 0.0), 2.0, 1.0, &catalog);
    on_edge.object.velocity = Vector::new(120.0, 0.0);
    let mut just_outside = body(20, Vector::new(52.5_f64.next_up(), 0.0), 2.0, 1.0, &catalog);
    just_outside.object.velocity = on_edge.object.velocity;
    let mut crossing = body(30, Vector::new(40.0, 0.0), 2.0, 1.0, &catalog);
    crossing.object.velocity = Vector::new(320.0, 0.0);
    let mut tied = body(40, crossing.object.position, 2.0, 1.0, &catalog);
    tied.object.velocity = crossing.object.velocity;
    let mut entities = vec![on_edge, just_outside, crossing, tied];
    entities.extend((100..200).map(|id| {
        body(
            id,
            Vector::new(1_000.0 + id as f64, 50.0),
            1.0,
            1.0,
            &catalog,
        )
    }));
    let world = World(entities);
    let dt = 0.25;
    let shot = CircleShape::new(Vector::ZERO, 0.5);
    let mut trace = Trace {
        entity: 1,
        player: None,
        shape: &shot.base,
        start: Vector::new(-20.0, 0.0),
        end: Vector::ZERO,
        target_motion_dt: Some(dt),
    };
    let mut indexed = ProjectileTargets::default();
    indexed.rebuild(world.weapon_targets().map(CollisionEntity::object), dt, 16);
    assert!(!indexed.by_x.is_empty());
    assert_eq!(
        indexed.nearby(&trace, 20.0).collect::<Vec<_>>(),
        [10, 30, 40]
    );
    let mut geometry = WeaponGeometry::default();
    let slop = catalog.simulation.linear_slop;
    let reference = trace_world(trace, &world, None, &mut geometry, slop).unwrap();
    let hit = trace_world(trace, &world, Some(&mut indexed), &mut geometry, slop).unwrap();
    assert_eq!(hit.collider.owner, 30);
    assert_eq!(hit.fraction, reference.fraction);

    trace.end.y = f64::NAN;
    let original_order: Vec<_> = world
        .weapon_targets()
        .map(|entity| entity.object.id)
        .collect();
    assert_eq!(
        indexed.nearby(&trace, f64::NAN).collect::<Vec<_>>(),
        original_order
    );

    let mut world = world;
    world.0[1].object.position.y = f64::NAN;
    indexed.rebuild(world.weapon_targets().map(CollisionEntity::object), dt, 16);
    trace.end.y = 0.0;
    assert!(indexed.by_x.is_empty());
    assert_eq!(
        indexed.nearby(&trace, 20.0).collect::<Vec<_>>(),
        [10, 20, 30, 40]
    );
}

use crate::objects::modules::laser::{LaserBeam, resolve_laser};
