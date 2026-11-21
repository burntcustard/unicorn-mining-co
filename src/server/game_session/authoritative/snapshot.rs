use super::*;

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
                player_id: account.id as u64,
                ship_id: account.ship_id as u64,
                server_tick: sector.running.world.tick,
                player_token: &account.token,
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
