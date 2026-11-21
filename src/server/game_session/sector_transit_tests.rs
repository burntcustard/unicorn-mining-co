use std::sync::Arc;

use crate::simulation::game_object::ObjectProperties;
use crate::simulation::geometry::rotate_point;
use crate::simulation::running_world::RunningWorld;
use crate::simulation::sector_generation::generate_sector_map;
use crate::simulation::update_world::WorldStepOptions;

use super::*;

fn player(ship_id: i64) -> PortalPlayer<'static> {
    PortalPlayer {
        player_id: 1,
        ship_id,
        travelled_tick: None,
        display_name: "Custard",
        hidden_position: None,
    }
}

fn player_names(players: &[PortalPlayer<'static>]) -> impl Fn(i64) -> &'static str {
    |id| {
        players
            .iter()
            .find(|player| player.player_id == id)
            .map_or("", |player| player.display_name)
    }
}

fn world(
    catalog: &Arc<Catalog>,
    gate_id: i64,
    destination_sector: &str,
    wormhole: bool,
) -> RunningWorld {
    let mut world = RunningWorld::new(25.0, Arc::clone(catalog));
    let mut gate = Portal::new(
        PortalOptions {
            id: gate_id,
            position: Vector::new(1234.0, -5678.0),
            destination_sector: destination_sector.into(),
            destination_name: "Destination".into(),
            wormhole,
        },
        catalog,
    );
    gate.connection_id = "link".into();
    world
        .world
        .add_entity(EntityKind::Portal(Box::new(gate)), false);
    world
}

fn spawn(world: &mut World, player_position: Vector) -> i64 {
    world
        .spawn_player_ship(
            1,
            "courser",
            ObjectProperties {
                position: player_position,
                ..ObjectProperties::default()
            },
        )
        .unwrap()
}

fn use_opening(gate: &mut Portal) {
    let spec = gate.gate.as_ref().unwrap();
    let duration = (spec.opening_duration + spec.state_hold_duration) / 1000.0;
    gate.request_exit_opening();
    gate.advance(duration);
}

#[test]
fn beam_interruption_announces_once_and_retains_later_beams() {
    let catalog = Arc::new(Catalog::load().unwrap());
    let step = catalog.simulation.simulation_step;
    for linked in [false, true] {
        for rotation in [0.0, 0.71] {
            let mut source = world(&catalog, 5, "other", false);
            let mut destination = world(&catalog, 9, "start", false);
            let gate = portal_mut(&mut source.world, 5).unwrap();
            if linked {
                gate.connect(portal_mut(&mut destination.world, 9).unwrap());
            }
            gate.object.rotation = rotation;
            use_opening(gate);
            let location = gate.object.position;
            let ship_id = spawn(&mut source.world, location + Vector::new(5000.0, 0.0));
            let players = [player(ship_id)];
            let mut effects = PortalEffects::default();
            let mut traffic = PortalTraffic::default();
            traffic.update_gates(&mut source.world, players, step, &mut effects);
            assert_eq!(
                effects.notices,
                vec![GateNotice {
                    gate_id: 5,
                    kind: GateNoticeKind::Closing
                }]
            );
            let gate = portal_mut(&mut source.world, 5).unwrap();
            gate.advance(catalog.jump_gate_spec.closing_duration / 4000.0);
            let gate_before = gate.opening;
            let interrupt = |source: &mut World,
                             traffic: &mut PortalTraffic,
                             effects: &mut PortalEffects,
                             beam| {
                let y = catalog.jump_gate_spec.beam_offsets[beam];
                let start = location + rotate_point(Vector::new(0.0, y - 10.0), rotation);
                let end = location + rotate_point(Vector::new(0.0, y + 10.0), rotation);
                let ship = ship_mut(source, ship_id).unwrap();
                ship.craft.object.position = start;
                ship.craft.object.radius = 1.0;
                traffic.prepare(source, players, effects);
                ship_mut(source, ship_id).unwrap().craft.object.position = end;
                traffic.finish(source, player_names(&players), effects);
            };
            interrupt(&mut source.world, &mut traffic, &mut effects, 0);
            let gate = portal(&source.world, 5).unwrap();
            assert_eq!(gate.opening, gate_before);
            assert_eq!(gate.opening_target, 1.0);
            assert_eq!(gate.blocked_beams, 1);
            assert_eq!(effects.notices[1].kind, GateNoticeKind::ClosingInterrupted);
            for index in 1..catalog.jump_gate_spec.beam_offsets.len() {
                interrupt(&mut source.world, &mut traffic, &mut effects, index);
                let gate = portal(&source.world, 5).unwrap();
                assert_eq!(gate.blocked_beams, (1 << (index + 1)) - 1);
                assert_eq!(gate.opening, gate_before);
            }
            assert_eq!(effects.notices.len(), 2);
            let gate = portal_mut(&mut source.world, 5).unwrap();
            gate.advance(catalog.jump_gate_spec.opening_duration / 1000.0);
            let gate = portal(&source.world, 5).unwrap();
            assert_eq!(gate.opening, 1.0);
            assert_eq!(gate.blocked_beams, 0);
        }
    }
}

#[test]
fn recovery_opens_only_local_gate_for_rotated_octagon_interiors() {
    let catalog = Arc::new(Catalog::load().unwrap());
    for (offset, inside) in [
        (Vector::new(0.0, 180.0), true),
        (Vector::new(120.0, 140.0), true),
        (Vector::new(210.0, 0.0), false),
        (Vector::new(0.0, 230.0), false),
        (Vector::new(180.0, 180.0), false),
        (Vector::new(1000.0, 0.0), false),
    ] {
        for rotation in [0.0, 0.71] {
            let mut source = world(&catalog, 5, "other", false);
            let mut destination = world(&catalog, 9, "start", false);
            let gate = portal_mut(&mut source.world, 5).unwrap();
            gate.connect(portal_mut(&mut destination.world, 9).unwrap());
            gate.object.rotation = rotation;
            let position = gate.object.position + rotate_point(offset, rotation);
            let ship_id = spawn(&mut source.world, position);
            let players = [player(ship_id)];
            let mut traffic = PortalTraffic::default();
            let mut effects = PortalEffects::default();
            traffic.prepare(&mut source.world, players, &mut effects);
            traffic.prepare(&mut source.world, players, &mut effects);
            assert_eq!(effects.notices.len(), usize::from(inside));
            if inside {
                assert_eq!(
                    effects.notices[0].kind,
                    GateNoticeKind::Recovery {
                        player_name: "Custard".into()
                    }
                );
            }
            assert!(effects.travel.is_empty());
            let gate = portal(&source.world, 5).unwrap();
            assert_eq!(gate.opening, 0.0);
            assert_eq!(gate.opening_target, f64::from(inside));
            assert_eq!(portal(&destination.world, 9).unwrap().opening_target, 0.0);
        }
    }
}

#[test]
fn expired_unoccupied_gate_cancels_a_queued_opening_during_its_hold() {
    let catalog = Arc::new(Catalog::load().unwrap());
    let mut source = world(&catalog, 5, "other", false);
    let gate = portal_mut(&mut source.world, 5).unwrap();
    gate.connected = Some(9);
    gate.close_after = 0.0;
    gate.request_opening(1.0);
    assert_eq!(gate.opening_target, 0.0);

    let mut traffic = PortalTraffic::default();
    traffic.update_gates(
        &mut source.world,
        [],
        (catalog.jump_gate_spec.state_hold_duration + 1000.0) / 1000.0,
        &mut PortalEffects::default(),
    );
    let gate = portal(&source.world, 5).unwrap();
    assert_eq!(gate.opening_target, 0.0);
    assert_eq!(gate.opening, 0.0);
}

#[test]
fn initial_opening_ignores_beam_crossings() {
    let catalog = Arc::new(Catalog::load().unwrap());
    let mut source = world(&catalog, 5, "other", false);
    let gate = portal_mut(&mut source.world, 5).unwrap();
    gate.request_exit_opening();
    gate.advance(catalog.jump_gate_spec.opening_duration / 2000.0);
    let position = gate.object.position;
    let ship_id = spawn(&mut source.world, position);
    let players = [player(ship_id)];
    let mut traffic = PortalTraffic::default();
    let mut effects = PortalEffects::default();
    for &y in &catalog.jump_gate_spec.beam_offsets {
        let ship = ship_mut(&mut source.world, ship_id).unwrap();
        ship.craft.object.position = position + Vector::new(0.0, y - 10.0);
        ship.craft.object.radius = 1.0;
        traffic.prepare(&mut source.world, players, &mut effects);
        ship_mut(&mut source.world, ship_id)
            .unwrap()
            .craft
            .object
            .position = position + Vector::new(0.0, y + 10.0);
        traffic.finish(&mut source.world, player_names(&players), &mut effects);
    }
    let gate = portal(&source.world, 5).unwrap();
    assert_eq!(gate.opening, 0.5);
    assert_eq!(gate.opening_target, 1.0);
    assert_eq!(gate.blocked_beams, 0);
    assert!(effects.notices.is_empty());
}

#[test]
fn normal_world_ticks_reopen_a_closing_gate() {
    let catalog = Arc::new(Catalog::load().unwrap());
    let step = catalog.simulation.simulation_step;
    let mut source = world(&catalog, 5, "other", false);
    let mut destination = world(&catalog, 9, "start", false);
    let gate = portal_mut(&mut source.world, 5).unwrap();
    gate.connect(portal_mut(&mut destination.world, 9).unwrap());
    gate.object.rotation = 0.71;
    use_opening(gate);
    gate.request_opening(0.0);
    gate.advance(catalog.jump_gate_spec.closing_duration / 10000.0);
    let position = gate.object.position
        + rotate_point(
            Vector::new(0.0, catalog.jump_gate_spec.beam_offsets[0]),
            gate.object.rotation,
        );
    let velocity = rotate_point(Vector::new(0.0, 100.0), gate.object.rotation);
    let ship_id = spawn(&mut source.world, position);
    ship_mut(&mut source.world, ship_id)
        .unwrap()
        .craft
        .object
        .velocity = velocity;
    let players = [player(ship_id)];
    let mut traffic = PortalTraffic::default();
    let mut effects = PortalEffects::default();
    let tick =
        |source: &mut RunningWorld, traffic: &mut PortalTraffic, effects: &mut PortalEffects| {
            traffic.update_gates(&mut source.world, players, step, effects);
            traffic.prepare(&mut source.world, players, effects);
            source.update(WorldStepOptions::default(), &mut Vec::new());
            traffic.finish(&mut source.world, player_names(&players), effects);
        };
    tick(&mut source, &mut traffic, &mut effects);
    let gate = portal(&source.world, 5).unwrap();
    assert_eq!(gate.opening_target, 1.0);
    assert_ne!(gate.blocked_beams, 0);
    let previous = gate.opening;
    tick(&mut source, &mut traffic, &mut effects);
    let gate = portal(&source.world, 5).unwrap();
    assert!(gate.opening > previous);
    assert_ne!(gate.blocked_beams, 0);
    assert_eq!(
        effects
            .notices
            .iter()
            .map(|notice| &notice.kind)
            .collect::<Vec<_>>(),
        [
            &GateNoticeKind::Closing,
            &GateNoticeKind::ClosingInterrupted
        ]
    );
}

#[test]
fn gate_access_opens_only_the_requested_gate_after_its_hold() {
    let catalog = Arc::new(Catalog::load().unwrap());
    let mut source = world(&catalog, 5, "other", false);
    let mut destination = world(&catalog, 9, "start", false);
    let center = portal(&source.world, 5).unwrap().object.position;
    let ship_id = spawn(&mut source.world, center + Vector::new(0.0, 5000.0));
    assert!(!eligible_gate_access(&source.world, ship_id, 5));
    ship_mut(&mut source.world, ship_id)
        .unwrap()
        .craft
        .object
        .position = center + Vector::new(0.0, 500.0);
    assert!(eligible_gate_access(&source.world, ship_id, 5));

    let mut access = GateAccess::default();
    access.request(5);
    let delay = catalog.jump_gate_spec.access_response_delay / 1000.0;
    let (pending, endpoint) =
        advance_gate_access(&mut source.world, &mut access, ship_id, true, delay);
    assert!(pending.pending && !pending.granted && endpoint.is_none());
    let (granted, endpoint) =
        advance_gate_access(&mut source.world, &mut access, ship_id, true, delay);
    assert!(!granted.pending && granted.granted);
    assert_eq!(
        connect_portals(
            &mut source.world,
            &endpoint.unwrap(),
            &mut destination.world
        ),
        Some(9)
    );
    assert_eq!(portal(&source.world, 5).unwrap().opening_target, 0.0);

    let mut traffic = PortalTraffic::default();
    let mut effects = PortalEffects::default();
    let players = [player(ship_id)];
    traffic.update_gates(
        &mut source.world,
        players,
        catalog.jump_gate_spec.state_hold_duration / 1000.0,
        &mut effects,
    );
    assert_eq!(portal(&source.world, 5).unwrap().opening_target, 1.0);
    traffic.update_gates(
        &mut source.world,
        players,
        catalog.jump_gate_spec.opening_duration / 1000.0,
        &mut effects,
    );
    assert_eq!(portal(&source.world, 5).unwrap().opening, 1.0);
    assert_eq!(portal(&destination.world, 9).unwrap().opening, 0.0);
}

#[test]
fn closed_gate_and_wormhole_transfer_hold_at_exit_and_keep_rotation() {
    let catalog = Arc::new(Catalog::load().unwrap());
    let step = catalog.simulation.simulation_step;
    for wormhole in [false, true] {
        let mut source = world(&catalog, 5, "other", wormhole);
        let mut destination = world(&catalog, 9, "start", wormhole);
        let gate_position = portal(&source.world, 5).unwrap().object.position;
        let gate_radius = portal(&source.world, 5).unwrap().travel_radius;
        let ship_id = spawn(&mut source.world, gate_position + Vector::new(0.0, 500.0));
        let players = [player(ship_id)];
        let mut effects = PortalEffects::default();
        let mut source_traffic = PortalTraffic::default();
        let mut destination_traffic = PortalTraffic::default();
        let traveler = ship_mut(&mut source.world, ship_id).unwrap();
        traveler.craft.object.rotation = 0.75;
        traveler.craft.object.spin = 1.0;
        traveler.craft.object.velocity = Vector::new(0.0, -400.0);
        traveler.firing = true;
        traveler.fly(1.0, 1.0);
        source_traffic.prepare(&mut source.world, players, &mut effects);
        ship_mut(&mut source.world, ship_id)
            .unwrap()
            .craft
            .object
            .position = gate_position + Vector::new(0.0, -500.0);
        source_traffic.finish(&mut source.world, player_names(&players), &mut effects);
        let traveler = ship(&source.world, ship_id).unwrap();
        assert_eq!(traveler.craft.transit_gate, Some(5));
        assert!(traveler.craft.transit_time < 0.0);
        assert_eq!(
            traveler.craft.object.position,
            gate_position + Vector::new(0.0, gate_radius)
        );
        assert_eq!(traveler.craft.object.velocity, Vector::ZERO);
        assert_eq!(traveler.craft.object.spin, 0.0);
        assert_eq!(traveler.forward, 0.0);
        assert_eq!(traveler.turn, 0.0);
        assert!(!traveler.firing);
        if wormhole {
            assert!(effects.travel.is_empty());
        } else {
            let [TransitAction::OpenDestination(entrance)] = effects.travel.as_slice() else {
                panic!("closed gate must open the destination immediately")
            };
            assert_eq!(
                request_destination_opening(&mut source.world, entrance, &mut destination.world),
                Some(9)
            );
            assert_eq!(portal(&destination.world, 9).unwrap().opening, 0.0);
            assert_eq!(portal(&destination.world, 9).unwrap().opening_target, 1.0);
            destination_traffic.update_gates(&mut destination.world, [], step, &mut effects);
            let opening = portal(&destination.world, 9).unwrap().opening;
            assert!(opening > 0.0 && opening < 1.0);
        }
        effects.travel.clear();
        let mut arrival = None;
        for _ in 0..400 {
            source_traffic.update_gates(&mut source.world, players, step, &mut effects);
            destination_traffic.update_gates(&mut destination.world, [], step, &mut effects);
            source_traffic.prepare(&mut source.world, players, &mut effects);
            for action in effects.travel.drain(..) {
                if let TransitAction::OpenDestination(entrance) = action {
                    request_destination_opening(
                        &mut source.world,
                        &entrance,
                        &mut destination.world,
                    );
                }
            }
            source.update(WorldStepOptions::default(), &mut Vec::new());
            source_traffic.finish(&mut source.world, player_names(&players), &mut effects);
            if let Some(TransitAction::Arrive { departure, .. }) = effects.travel.pop() {
                arrival = Some(departure);
                break;
            }
        }
        let departure = arrival.expect("departure must finish using ordinary ship update");
        let destination_id =
            connect_portals(&mut source.world, &departure, &mut destination.world).unwrap();
        let arrival =
            SectorArrival::from_portal(portal(&destination.world, destination_id).unwrap());
        assert!(transfer_player(
            &mut source.world,
            &mut destination.world,
            1,
            ship_id,
            arrival
        ));
        assert!(source.world.entity(ship_id).is_none() && source.world.player(1).is_none());
        let arrived = ship(&destination.world, ship_id).unwrap();
        assert_eq!(arrived.craft.transit_gate, Some(9));
        assert!(arrived.craft.transit_time > 0.0);
        assert_eq!(arrived.craft.object.rotation, 0.75);
        for _ in 0..400 {
            effects.travel.clear();
            destination_traffic.update_gates(&mut destination.world, players, step, &mut effects);
            destination_traffic.prepare(&mut destination.world, players, &mut effects);
            destination.update(WorldStepOptions::default(), &mut Vec::new());
            destination_traffic.finish(
                &mut destination.world,
                player_names(&players),
                &mut effects,
            );
            assert!(
                effects.travel.is_empty(),
                "staying inside the exit cannot bounce back"
            );
            if ship(&destination.world, ship_id)
                .unwrap()
                .craft
                .transit_time
                == 0.0
            {
                break;
            }
        }
        let arrived = ship(&destination.world, ship_id).unwrap();
        assert_eq!(arrived.craft.transit_time, 0.0);
        assert_eq!(arrived.craft.object.position, arrival.position);
        assert_eq!(arrived.craft.object.rotation, 0.75);
        destination_traffic.prepare(&mut destination.world, players, &mut effects);
        ship_mut(&mut destination.world, ship_id)
            .unwrap()
            .craft
            .object
            .position += Vector::new(0.0, 1000.0);
        destination_traffic.finish(&mut destination.world, player_names(&players), &mut effects);
        assert!(
            ship(&destination.world, ship_id)
                .unwrap()
                .craft
                .transit_gate
                .is_none()
        );
        assert!(effects.travel.is_empty());
    }
}

#[test]
fn generated_gate_pairs_share_rotation_and_keep_sector_offsets() {
    let catalog = Catalog::load().unwrap();
    let sectors = generate_sector_map(25, &catalog).unwrap();
    let start = &catalog.starting_sector_id;
    let portals = build_sector_portals(&sectors, start, &catalog).unwrap();
    assert_eq!(portals.id_offset, 0);
    for (index, portal) in portals.portals.iter().enumerate() {
        assert_eq!(portal.object.id, (1 << 32) + index as i64);
        let next = build_sector_portals(&sectors, &portal.destination_sector, &catalog).unwrap();
        let destination = next
            .portals
            .iter()
            .find(|exit| exit.connection_id == portal.connection_id)
            .unwrap();
        assert!(destination.object.id >= next.id_offset + (1 << 32));
        assert_eq!(portal.object.rotation, destination.object.rotation);
        assert_eq!(destination.destination_sector, *start);
    }
}
