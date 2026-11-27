//! JSON-lines bridge from the TypeScript trade test to the native session.

use std::error::Error;
use std::io::{Read, Write};
use std::sync::Arc;

use serde::Deserialize;

use crate::game_server::{Client, ClientId, Session};
use crate::objects::craft::{CargoObject, InstalledModule};
use crate::objects::item::Item;
use crate::objects::ship::Ship;
use crate::objects::station::Station;
use crate::protocol::{Control, DockAction, decode_client_control};
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::world::EntityKind;
use crate::specs::Catalog;
use crate::test_fixtures::{decode_hex, hex};
use crate::utilities::vector::Vector;
use crate::websocket::{FixtureSocket, MAX_SNAPSHOT_BUFFER};

use super::AuthoritativeSession;

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Command {
    kind: String,
    #[serde(default)]
    packets: Vec<String>,
}

struct TradeFixture {
    session: AuthoritativeSession,
    socket: FixtureSocket,
    client: Client,
    station_id: i64,
    packets: Vec<String>,
}

impl TradeFixture {
    fn new() -> Result<Self, Box<dyn Error>> {
        let catalog = Arc::new(Catalog::load()?);
        let mut socket = FixtureSocket::new();
        socket.enable_station_replication();
        Ok(Self {
            session: AuthoritativeSession::new(25.0, catalog)?,
            client: Client {
                id: ClientId(1),
                socket: socket.socket(),
            },
            socket,
            station_id: 0,
            packets: Vec::new(),
        })
    }

    fn collect(&mut self) {
        self.socket.drain(|data| self.packets.push(hex(data)));
    }

    fn receive(&mut self, control: Control) {
        self.session.receive(&self.client, control);
        self.collect();
    }

    fn reject_stock_request(&mut self) {
        self.receive(Control::Dock {
            action: DockAction::BuyStock {
                object_ids: Vec::new(),
            },
            sequence: 0,
        });
    }

    fn setup(&mut self) {
        self.receive(Control::Hello { player_id: None });
        let player = self.session.accounts.get_mut(&1).expect("fixture player");
        let sector = player.sector;
        player.credits = 10_000.0;
        let catalog = &self.session.catalog;
        let world = &mut self.session.sectors[sector].running.world;
        self.station_id = world.ids.entity();
        let stock = (0..32)
            .map(|_| {
                let pack = Item::new(
                    world.ids.entity(),
                    "autogunAmmo",
                    ObjectProperties::default(),
                    catalog,
                )
                .expect("fixture ammunition");
                CargoObject::Item(Box::new(pack))
            })
            .collect();
        let station = Station::new(
            self.station_id,
            "corral-5",
            ObjectProperties {
                position: player.position,
                ..ObjectProperties::default()
            },
            Some(stock),
            catalog,
            || world.ids.entity(),
        )
        .expect("authored fixture station");
        world.add_entity(EntityKind::Station(Box::new(station)), false);
        let autogun = InstalledModule::new(
            world.ids.object(),
            "autogun".to_owned(),
            Arc::clone(&catalog.module_specs["autogun"]),
        );
        let entity = world.entity_mut(player.ship_id).expect("fixture ship");
        let EntityKind::Ship(ship) = &mut entity.model else {
            panic!("fixture player must have an active ship");
        };
        ship.craft.docked_to = Some(self.station_id);
        ship.craft.cargo_contents.push(CargoObject::Module(autogun));
        self.session.sectors.commit_ids(sector);
        // A rejected stock action forces a load of the controlled dock state.
        self.reject_stock_request();
    }

    fn player_ship(&mut self) -> &mut Ship {
        let player = self.session.accounts.get(&1).expect("fixture player");
        let world = &mut self.session.sectors[player.sector].running.world;
        let entity = world.entity_mut(player.ship_id).expect("fixture ship");
        let EntityKind::Ship(ship) = &mut entity.model else {
            panic!("fixture player must have an active ship");
        };
        ship
    }

    fn handle(&mut self, command: Command) -> Result<(), Box<dyn Error>> {
        match command.kind.as_str() {
            "setup" => self.setup(),
            "drift" => self.session.sectors.next_entity_id += 100,
            "farStation" | "nearStation" => {
                let player = self.session.accounts.get(&1).expect("fixture player");
                let world = &self.session.sectors[player.sector].running.world;
                let station = world.entity(self.station_id).expect("fixture station");
                let offset = if command.kind == "farStation" {
                    4000.0
                } else {
                    0.0
                };
                let position = station.model.object().position + Vector::new(offset, 0.0);
                let ship = self.player_ship();
                ship.craft.docked_to = None;
                ship.craft.object.position = position;
                self.session.send_snapshot(1);
            }
            "redock" => {
                self.player_ship().craft.docked_to = Some(self.station_id);
                self.reject_stock_request();
            }
            "block" => self.socket.set_buffered_bytes(MAX_SNAPSHOT_BUFFER + 1),
            "unblock" => self.socket.set_buffered_bytes(0),
            "takeStock" => {
                let player = self.session.accounts.get(&1).expect("fixture player");
                let world = &mut self.session.sectors[player.sector].running.world;
                let station = world.entity_mut(self.station_id).expect("fixture station");
                let EntityKind::Station(station) = &mut station.model else {
                    panic!("fixture stock must be a station");
                };
                station.craft.cargo_contents.remove(0);
                station.stock_changed();
            }
            "tick" => self.session.tick(1),
            "receive" => {}
            _ => return Err(format!("unknown trade fixture command {}", command.kind).into()),
        }
        self.collect();
        for packet in command.packets {
            let data = decode_hex(&packet)?;
            let catalog = &self.session.catalog;
            let control =
                decode_client_control(&data, &catalog.protocol, catalog.simulation.simulation_step)
                    .map_err(|error| {
                        format!(
                            "decode {} control {}: {error}",
                            command.kind,
                            &packet[..packet.len().min(8)]
                        )
                    })?;
            self.receive(control);
        }
        Ok(())
    }
}

pub fn run(input: impl Read, mut output: impl Write) -> Result<(), Box<dyn Error>> {
    let mut fixture = TradeFixture::new()?;
    for command in serde_json::Deserializer::from_reader(input).into_iter::<Command>() {
        fixture.handle(command?)?;
        serde_json::to_writer(&mut output, &fixture.packets)?;
        output.write_all(b"\n")?;
        output.flush()?;
        fixture.packets.clear();
    }
    Ok(())
}
