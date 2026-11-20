//! Replay session actions from the TypeScript recording using the native server.

use std::collections::BTreeMap;
use std::error::Error;
use std::io::{Read, Write};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::game_server::{Client, ClientId, Session};
use crate::objects::{craft::CargoObject, item::Item};
use crate::protocol::{Control, decode_client_control};
use crate::simulation::{game_object::ObjectProperties, world::EntityKind};
use crate::test_fixtures::{decode_hex, hex, load_example_catalog};
use crate::websocket::FixtureSocket;

use super::AuthoritativeSession;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Action {
    kind: String,
    socket: u64,
    packet: String,
    ticks: u64,
    buffer: u64,
}

struct Connection {
    client: Client,
    socket: FixtureSocket,
    packets: Vec<Vec<u8>>,
}

impl Connection {
    fn new(id: u64) -> Self {
        let socket = FixtureSocket::new();
        Self {
            client: Client {
                id: ClientId(id),
                socket: socket.socket(),
            },
            socket,
            packets: Vec::new(),
        }
    }

    fn drain(&mut self) {
        self.socket
            .drain(|packet| self.packets.push(packet.to_vec()));
    }
}

#[derive(Serialize)]
struct SessionResult {
    packets: Vec<String>,
    code: u16,
}

pub fn run(input: impl Read, output: impl Write) -> Result<(), Box<dyn Error>> {
    let actions: Vec<Action> = serde_json::from_reader(input)?;
    let catalog = Arc::new(load_example_catalog()?);
    let mut session = AuthoritativeSession::new(25.0, Arc::clone(&catalog))?;
    let mut sockets: BTreeMap<u64, Connection> = BTreeMap::new();
    for action in actions {
        sockets
            .entry(action.socket)
            .or_insert_with(|| Connection::new(action.socket));
        let token = if action.kind == "reconnect" {
            let welcome = sockets
                .get(&action.buffer)
                .and_then(|connection| connection.packets.first())
                .ok_or("old socket has no welcome packet")?;
            Some(welcome_token(welcome)?)
        } else {
            None
        };
        let connection = sockets.get_mut(&action.socket).expect("fixture socket");
        match action.kind.as_str() {
            "receive" => {
                let control = decode_client_control(
                    &decode_hex(&action.packet)?,
                    &catalog.protocol,
                    catalog.simulation.simulation_step,
                )?;
                session.receive(&connection.client, control);
            }
            "dockSetup" => dock_setup(&mut session)?,
            "destroy" => {
                let player = session
                    .accounts
                    .get(&1)
                    .ok_or("fixture player not connected")?;
                session.sectors[player.sector]
                    .running
                    .world
                    .remove_entity(player.ship_id);
            }
            "ackLatest" => {
                if let Some(sequence) = connection.packets.last().and_then(|packet| receipt(packet))
                {
                    session.receive(&connection.client, Control::SnapshotAck { sequence });
                }
            }
            "tick" => session.tick(action.ticks),
            "disconnect" => session.disconnect(&connection.client),
            "buffer" => connection
                .socket
                .set_buffered_bytes(usize::try_from(action.buffer)?),
            "reconnect" => session.receive(
                &connection.client,
                Control::Hello {
                    player_token: token,
                },
            ),
            _ => return Err(format!("unknown session fixture action {}", action.kind).into()),
        }
        for connection in sockets.values_mut() {
            connection.drain();
        }
    }

    let result: BTreeMap<_, _> = sockets
        .into_iter()
        .map(|(id, connection)| {
            (
                id,
                SessionResult {
                    code: connection.socket.close_code(),
                    packets: connection
                        .packets
                        .iter()
                        .map(|packet| hex(packet))
                        .collect(),
                },
            )
        })
        .collect();
    serde_json::to_writer(output, &result)?;
    Ok(())
}

fn dock_setup(session: &mut AuthoritativeSession) -> Result<(), Box<dyn Error>> {
    let player = session
        .accounts
        .get_mut(&1)
        .ok_or("fixture player not connected")?;
    let world = &mut session.sectors[player.sector].running.world;
    let Some(EntityKind::Ship(ship)) = world
        .entity_mut(player.ship_id)
        .map(|entity| &mut entity.model)
    else {
        return Err("fixture player has no active ship".into());
    };
    let cargo = Item::new(
        123_456,
        "diamond",
        ObjectProperties::default(),
        &session.catalog,
    )
    .ok_or("diamond missing from fixture catalog")?;
    player.credits = 10_000.0;
    ship.craft.docked_to = Some(999);
    ship.craft.hulls[0].health = 1.0;
    ship.craft
        .cargo_contents
        .push(CargoObject::Item(Box::new(cargo)));
    Ok(())
}

fn read_unsigned(packet: &mut &[u8]) -> Option<u64> {
    let mut value = 0;
    for shift in (0..=49).step_by(7) {
        let (byte, following) = packet.split_first()?;
        *packet = following;
        value |= u64::from(byte & 127) << shift;
        if byte & 128 == 0 {
            return Some(value);
        }
    }
    None
}

fn receipt(packet: &[u8]) -> Option<u64> {
    if packet.get(..3)? != b"UM\x01" {
        return None;
    }
    let flags = *packet.get(3)?;
    if flags & 16 == 0 {
        return None;
    }
    let mut fields = &packet[4..];
    read_unsigned(&mut fields)?; // Tick.
    read_unsigned(&mut fields)?; // Next entity ID.
    if flags & 4 != 0 {
        read_unsigned(&mut fields)?;
    } // Input acknowledgment.
    if flags & 8 != 0 {
        read_unsigned(&mut fields)?;
    } // Zigzag input lead.
    read_unsigned(&mut fields)
}

fn welcome_token(packet: &[u8]) -> Result<String, Box<dyn Error>> {
    let mut fields = packet.get(4..).ok_or("fixture welcome header missing")?;
    for _ in 0..3 {
        read_unsigned(&mut fields).ok_or("fixture welcome field missing")?;
    }
    Ok(
        uuid::Uuid::from_slice(fields.get(..16).ok_or("fixture welcome token missing")?)?
            .to_string(),
    )
}
