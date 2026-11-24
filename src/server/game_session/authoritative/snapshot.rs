use super::*;

use crate::movement_transport::{MAX_MOVEMENT_BYTES, MOVEMENT_SHIP_LIMIT, MovementSender};
use crate::simulation::world::World;

#[cold]
fn send_movement(sender: &MovementSender, account: &Account, world: &World, visible_range: f64) {
    // Keep a second of pose traffic within the SCTP congestion window even
    // without acknowledgments. Crowds also share a lower per-observer rate.
    let crowded = world.players.len() > 4;
    let interval = if crowded { 3 } else { 1 };
    if !sender.should_send(world.tick, interval)
        || crowded && !account.delivery.wants_movement(world.tick)
    {
        return;
    }

    let mut nearby = SmallVec::<[_; 40]>::new();
    let range_squared = visible_range * visible_range;

    for player in world.players.values() {
        let id = player.ship_id;
        if id == account.ship_id || !account.selection.contains(id) {
            continue;
        }
        let Some(EntityKind::Ship(ship)) = world.entity(id).map(|entity| &entity.model) else {
            continue;
        };
        let craft = &ship.craft;
        let object = &craft.object;
        let distance = object.position.distance_squared(account.position);
        if object.dead
            || craft.docked_to.is_some()
            || craft.launching != 0.0
            || distance > range_squared
        {
            continue;
        }
        nearby.push((distance, id, object));
    }
    if nearby.len() > MOVEMENT_SHIP_LIMIT {
        nearby.select_nth_unstable_by(MOVEMENT_SHIP_LIMIT, |left, right| {
            left.0.total_cmp(&right.0)
        });
    }

    let mut packet = [0; MAX_MOVEMENT_BYTES];
    packet[..8].copy_from_slice(&world.tick.to_le_bytes());
    let mut size = 8;
    for &(_, id, object) in nearby.iter().take(MOVEMENT_SHIP_LIMIT) {
        packet[size..size + 8].copy_from_slice(&id.to_le_bytes());
        size += 8;
        for value in [
            object.position.x,
            object.position.y,
            object.velocity.x,
            object.velocity.y,
            object.rotation,
            object.spin,
        ] {
            packet[size..size + 4].copy_from_slice(&(value as f32).to_le_bytes());
            size += 4;
        }
    }
    if size > 8 {
        sender.send(world.tick, &packet[..size]);
    }
}

pub(super) fn send_snapshot(
    account: &mut Account,
    sector: &mut SectorRuntime,
    catalog: &Catalog,
    world_seed: f64,
    committed: u64,
    regular: bool,
) {
    let Some(client) = account.socket.as_ref() else {
        return;
    };
    let socket = &client.socket;
    if !socket.is_open() || account.save_sequence > committed {
        return;
    }
    if std::mem::take(&mut account.welcome_pending) {
        send_control(
            socket,
            ServerControl::Welcome {
                player_number: account.player_number as u64,
                ship_id: account.ship_id as u64,
                server_tick: sector.running.world.tick,
                player_id: &account.player_id,
                world_seed,
                spawn: account.position,
                unlocked_paints: Some(account.unlocked_paints),
                credits: Some(account.credits),
                display_name: Some(&account.name),
                sector_name: Some(&sector.sector.name),
            },
            catalog,
        );
    }
    if let Some((sender, text)) = account.arrival_message.take() {
        send_control(
            socket,
            ServerControl::Chat {
                sender: &sender,
                sender_role: "friendly",
                channel: 0,
                text: &text,
                cargo_demand: None,
            },
            catalog,
        );
    }
    if std::mem::take(&mut account.profile_pending) {
        send_control(
            socket,
            ServerControl::Profile {
                display_name: &account.name,
            },
            catalog,
        );
    }
    if !account.playing {
        return;
    }
    if std::mem::take(&mut account.respawn_pending) {
        send_control(
            socket,
            ServerControl::Respawn {
                ship_id: account.ship_id as u64,
            },
            catalog,
        );
    }
    if std::mem::take(&mut account.progress_pending) {
        send_control(
            socket,
            ServerControl::Progress {
                unlocked_paints: account.unlocked_paints,
                credits: Some(account.credits),
            },
            catalog,
        );
    }
    if let Some(error) = account.hangar.response.take()
        && let Err(error) = hangar::send(account, &sector.running.world, socket, error)
    {
        eprintln!("hangar snapshot encoding failed: {error}");
        socket.close_with(1011, "Invalid server snapshot");
        return;
    }

    let tick = sector.running.world.tick;
    let prepared = match account.delivery.prepare(SnapshotRequest {
        tick,
        step: catalog.simulation.simulation_step,
        regular,
        buffered_bytes: socket.buffered_bytes(),
        dock_sequence: account.dock_sequence,
    }) {
        Ok(prepared) => prepared,
        Err(stall) => {
            if stall == SnapshotStall::SocketLimit {
                socket.terminate();
            } else if regular && let Some(sender) = socket.movement() {
                send_movement(
                    sender,
                    account,
                    &sector.running.world,
                    catalog.simulation.visible_range,
                );
            }
            if let Some(stats) = &mut account.stats {
                stats.record_stall(stall);
            }
            return;
        }
    };
    let plan = prepared.plan();
    sector.prepare_replication();
    let world = &mut sector.running.world;
    let docked_station = world
        .entity(account.ship_id)
        .and_then(|entity| entity.model.craft())
        .filter(|craft| !craft.object.dead && craft.launching == 0.0)
        .and_then(|craft| craft.docked_to);
    let mut forced = SmallVec::<[i64; 2]>::new();
    if plan.force_ship_update {
        forced.push(account.ship_id);
        if let Some(docked) = world
            .entity(account.ship_id)
            .and_then(|entity| entity.model.craft())
            .and_then(|craft| craft.docked_to)
        {
            forced.push(docked);
        }
    }
    account
        .selection
        .set_snapshot_deltas(socket.snapshot_deltas());
    let selection = account.selection.select(
        &mut sector.view,
        &catalog.simulation,
        SelectOptions {
            tick,
            load: plan.load,
            players: world.players.len(),
            position: account.position,
            owned: account.ship_id,
            force_update: &forced,
        },
    );
    let aliases = account
        .dock_aliases
        .iter()
        .map(|(&from, &(to, _))| [from, to])
        .collect::<SmallVec<[[i64; 2]; 16]>>();
    let packet = account.writer.encode(
        selection,
        SnapshotMetadata {
            load: plan.load,
            tick,
            next_entity_id: world.ids.next_entity as u64,
            ack: Some(account.inputs.acknowledged_sequence()),
            sequence: plan.receipt_sequence,
            dock_sequence: Some(account.dock_sequence),
            credits: Some(account.credits),
            dock_ids: &aliases,
            input_lead: account.inputs.input_lead(),
            station_replication: socket.station_replication(),
            docked_station,
        },
        &mut sector.batch,
        &catalog.protocol,
        world,
    );
    let packet = match packet {
        Ok(packet) => packet,
        Err(error) => {
            eprintln!("snapshot encoding failed: {error}");
            socket.close_with(1011, "Invalid server snapshot");
            return;
        }
    };
    prepared.commit();
    account.inputs.clear_input_lead();
    if let Some(stats) = &mut account.stats {
        stats.record_snapshot(
            &account.delivery,
            SnapshotSample {
                tick,
                regular,
                requested: plan.receipt_sequence.is_some(),
                bytes: packet.len(),
            },
        );
    }
    send(socket, packet);
}
