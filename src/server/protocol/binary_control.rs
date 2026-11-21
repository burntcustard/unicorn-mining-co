use crate::specs::{Protocol, ShipOffer};

use super::wire::{Reader, Writer, parse_uuid};
use super::{Input, ProtocolError, Snapshot, Vector, WorldSound, append_snapshot};

const HEADER: [u8; 3] = [0x55, 0x43, 1];
const MAX_CONTROL_BYTES: usize = 32 * 1024;
const MAX_NAME_CHARACTERS: usize = 16;
const MAX_TEXT_CHARACTERS: usize = 240;

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(
    test,
    serde(
        tag = "type",
        rename_all = "camelCase",
        rename_all_fields = "camelCase"
    )
)]
pub enum Control {
    SectorMap {
        position: Vector,
    },
    Hangar {
        command: String,
        ship_id: i64,
        value: String,
    },
    Profile {
        display_name: String,
    },
    Hello {
        player_token: Option<String>,
    },
    Prepare {
        player_token: Option<String>,
    },
    Input {
        tick: u64,
        sequence: u64,
        input: Input,
        offset: Option<f64>,
    },
    Dock {
        #[cfg_attr(test, serde(flatten))]
        action: DockAction,
        #[cfg_attr(test, serde(default))]
        sequence: u64,
    },
    Respawn,
    GateAccess {
        gate_id: u64,
    },
    Chat {
        channel: u8,
        text: String,
    },
    Activity,
    Play,
    SnapshotAck {
        sequence: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[cfg_attr(
    test,
    serde(
        tag = "action",
        rename_all = "camelCase",
        rename_all_fields = "camelCase"
    )
)]
pub enum DockAction {
    Refuel,
    BuyAmmo,
    Buy {
        module: i64,
        module_id: i64,
        mount: Option<i64>,
    },
    Sell {
        object_ids: Vec<i64>,
    },
    BuyStock {
        object_ids: Vec<i64>,
    },
    Equip {
        module_id: i64,
        mount: i64,
    },
    Remove {
        mount: i64,
    },
    RepairHull {
        hull_index: i64,
    },
    Paint {
        paint: i64,
        module_id: Option<i64>,
        mount: Option<i64>,
    },
    Repair {
        module_id: Option<i64>,
        mount: Option<i64>,
    },
}

#[derive(Debug, Default, Clone, PartialEq, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MapMarker {
    pub kind: String,
    pub id: i64,
    pub position: Vector,
    pub radius: f64,
    pub name: String,
    pub definition_id: String,
    pub color: String,
    pub sender_role: String,
}

#[derive(Debug, Clone, Copy)]
pub enum ServerControl<'a> {
    SectorMap {
        map_markers: &'a [MapMarker],
    },
    Hangar {
        ship_id: u64,
        credits: f64,
        hangar_error: &'a str,
        ships_for_sale: &'a [ShipOffer],
        hangar_ships: Snapshot<'a>,
    },
    Chat {
        channel: u8,
        sender: &'a str,
        sender_role: &'a str,
        text: &'a str,
        cargo_demand: Option<i64>,
    },
    Sounds {
        sounds: &'a [WorldSound],
    },
    Profile {
        display_name: &'a str,
    },
    Progress {
        unlocked_paints: u16,
        credits: Option<f64>,
    },
    Respawn {
        ship_id: u64,
    },
    Welcome {
        player_id: u64,
        ship_id: u64,
        server_tick: u64,
        player_token: &'a str,
        world_seed: f64,
        spawn: Vector,
        unlocked_paints: Option<u16>,
        credits: Option<f64>,
        display_name: Option<&'a str>,
        sector_name: Option<&'a str>,
    },
}

pub fn valid_display_name(value: &str) -> bool {
    value.len() <= MAX_NAME_CHARACTERS || value.chars().nth(MAX_NAME_CHARACTERS).is_none()
}

impl Writer<'_> {
    fn name(&mut self, value: &str) -> Result<(), ProtocolError> {
        if !valid_display_name(value) {
            return Err(ProtocolError::Control);
        }

        self.byte(value.len() as u8);
        self.data.extend_from_slice(value.as_bytes());
        Ok(())
    }

    fn text(&mut self, value: &str) -> Result<(), ProtocolError> {
        if value.chars().nth(MAX_TEXT_CHARACTERS).is_some() {
            return Err(ProtocolError::Control);
        }

        self.unsigned(value.len() as u64);
        self.data.extend_from_slice(value.as_bytes());
        Ok(())
    }

    fn uuid(&mut self, value: &str) -> Result<(), ProtocolError> {
        let decoded = parse_uuid(value).ok_or(ProtocolError::Control)?;
        self.data.extend_from_slice(&decoded);
        Ok(())
    }
}

impl Reader<'_> {
    fn name(&mut self) -> Result<String, ProtocolError> {
        let length = usize::from(self.byte()?);
        self.utf8_text(length, MAX_NAME_CHARACTERS)
    }

    fn text(&mut self) -> Result<String, ProtocolError> {
        let length = self.unsigned()?;
        if length > (MAX_TEXT_CHARACTERS * 4) as u64 {
            return Err(ProtocolError::Control);
        }

        self.utf8_text(length as usize, MAX_TEXT_CHARACTERS)
    }

    fn utf8_text(&mut self, length: usize, max_characters: usize) -> Result<String, ProtocolError> {
        if length > max_characters * 4 {
            return Err(ProtocolError::Control);
        }

        let value = std::str::from_utf8(self.take(length)?).map_err(|_| ProtocolError::Control)?;
        if value.chars().nth(max_characters).is_some() {
            return Err(ProtocolError::Control);
        }

        Ok(value.to_owned())
    }

    fn uuid(&mut self) -> Result<String, ProtocolError> {
        const DIGITS: &[u8; 16] = b"0123456789abcdef";
        let mut result = String::with_capacity(36);

        for (index, byte) in self.take(16)?.iter().copied().enumerate() {
            if matches!(index, 4 | 6 | 8 | 10) {
                result.push('-');
            }

            result.push(char::from(DIGITS[(byte >> 4) as usize]));
            result.push(char::from(DIGITS[(byte & 15) as usize]));
        }

        Ok(result)
    }
}

pub fn decode_client_control(
    data: &[u8],
    ids: &Protocol,
    step: f64,
) -> Result<Control, ProtocolError> {
    if data.len() < 4 || data.len() > MAX_CONTROL_BYTES || data[..3] != HEADER {
        return Err(ProtocolError::Control);
    }

    let mut reader = Reader::new(&data[4..]);
    let id = i32::from(data[3]);
    let message_id = |name| {
        ids.control_message_ids
            .get(name)
            .copied()
            .unwrap_or_default()
    };
    let control = match id {
        id if id == message_id("sectorMap") => Control::SectorMap {
            position: reader.vector()?,
        },
        id if id == message_id("hangar") => Control::Hangar {
            command: reader.name()?,
            ship_id: reader.signed()?,
            value: reader.name()?,
        },
        id if id == message_id("profile") => {
            let display_name = reader.name()?;
            if display_name.is_empty() {
                return Err(ProtocolError::Control);
            }

            Control::Profile { display_name }
        }
        id if id == message_id("hello") || id == message_id("prepare") => {
            let player_token = match reader.byte()? {
                0 => None,
                1 => Some(reader.uuid()?),
                _ => return Err(ProtocolError::Control),
            };
            if id == message_id("prepare") {
                Control::Prepare { player_token }
            } else {
                Control::Hello { player_token }
            }
        }
        id if id == message_id("input") => decode_input(&mut reader, step)?,
        id if id == message_id("dock") => {
            let action = decode_dock_action(&mut reader, ids)?;
            let sequence = if reader.is_empty() {
                0
            } else {
                reader.unsigned()?
            };
            Control::Dock { action, sequence }
        }
        id if id == message_id("respawn") => Control::Respawn,
        id if id == message_id("gateAccess") => Control::GateAccess {
            gate_id: reader.unsigned()?,
        },
        id if id == message_id("chat") => {
            let channel = reader.byte()?;
            if channel > 1 {
                return Err(ProtocolError::Control);
            }

            Control::Chat {
                channel,
                text: reader.text()?,
            }
        }
        id if id == message_id("activity") => Control::Activity,
        id if id == message_id("play") => Control::Play,
        id if id == message_id("snapshotAck") => Control::SnapshotAck {
            sequence: reader.unsigned()?,
        },
        _ => return Err(ProtocolError::Control),
    };

    if !reader.is_empty() {
        return Err(ProtocolError::Control);
    }

    Ok(control)
}

fn decode_input(reader: &mut Reader<'_>, step: f64) -> Result<Control, ProtocolError> {
    let tick = reader.unsigned()?;
    let sequence = reader.unsigned()?;
    let code = reader.byte()?;
    if code >= 192 {
        return Err(ProtocolError::Control);
    }

    let flags = reader.byte()?;
    let extra_controls = reader.byte()?;
    if extra_controls > 1 {
        return Err(ProtocolError::Control);
    }

    let offset = if flags & 1 != 0 {
        let offset = reader.number()?;
        if offset < 0.0 || offset >= step {
            return Err(ProtocolError::Control);
        }

        Some(offset)
    } else {
        None
    };

    let target_id = if flags & 64 != 0 {
        Some(reader.signed()?)
    } else {
        None
    };
    Ok(Control::Input {
        tick,
        sequence,
        input: Input {
            target_id,
            horn_drill: code & 1 != 0,
            cargo_hatch: code & 2 != 0,
            search_light: code & 4 != 0,
            shield_generator: code & 8 != 0,
            launch: code & 16 != 0,
            fire: flags & 2 != 0,
            cargo_release: flags & 32 != 0,
            plasma_active: flags & 4 != 0,
            autogun_active: flags & 8 != 0,
            laser_active: flags & 16 != 0,
            flight_mode: flags & 128 != 0,
            thrust_boost: extra_controls & 1 != 0,
            thrust: f64::from((code >> 5) & 1),
            turn: f64::from((code >> 7) & 1) - f64::from((code >> 6) & 1),
        },
        offset,
    })
}

fn decode_dock_action(
    reader: &mut Reader<'_>,
    ids: &Protocol,
) -> Result<DockAction, ProtocolError> {
    let id = i32::from(reader.byte()?);
    let action_id = |name| ids.dock_action_ids.get(name).copied().unwrap_or_default();
    let action = match id {
        id if id == action_id("refuel") => DockAction::Refuel,
        id if id == action_id("buyAmmo") => DockAction::BuyAmmo,
        id if id == action_id("buy") || id == action_id("buyEquipped") => {
            let module = reader.unsigned()? as i64;
            let module_id = reader.signed()?;
            let mount = if id == action_id("buyEquipped") {
                Some(reader.unsigned()? as i64)
            } else {
                None
            };
            DockAction::Buy {
                module,
                module_id,
                mount,
            }
        }
        id if id == action_id("sell") || id == action_id("buyStock") => {
            let count = reader.byte()?;
            if !(1..=100).contains(&count) {
                return Err(ProtocolError::Control);
            }

            let mut object_ids = Vec::with_capacity(usize::from(count));
            for _ in 0..count {
                object_ids.push(reader.signed()?);
            }

            if id == action_id("buyStock") {
                DockAction::BuyStock { object_ids }
            } else {
                DockAction::Sell { object_ids }
            }
        }
        id if id == action_id("equip") => DockAction::Equip {
            module_id: reader.signed()?,
            mount: reader.unsigned()? as i64,
        },
        id if id == action_id("remove") => DockAction::Remove {
            mount: reader.unsigned()? as i64,
        },
        id if id == action_id("repairHull") => DockAction::RepairHull {
            hull_index: reader.unsigned()? as i64,
        },
        id if id == action_id("paint") || id == action_id("repair") => {
            let paint = if id == action_id("paint") {
                Some(reader.unsigned()? as i64)
            } else {
                None
            };

            let mask = reader.byte()?;
            if mask & !3 != 0 {
                return Err(ProtocolError::Control);
            }

            let module_id = if mask & 1 != 0 {
                Some(reader.signed()?)
            } else {
                None
            };
            let mount = if mask & 2 != 0 {
                Some(reader.signed()?)
            } else {
                None
            };
            if let Some(paint) = paint {
                DockAction::Paint {
                    paint,
                    module_id,
                    mount,
                }
            } else {
                DockAction::Repair { module_id, mount }
            }
        }
        _ => return Err(ProtocolError::Control),
    };

    Ok(action)
}

pub fn encode_server_control(
    message: &ServerControl<'_>,
    ids: &Protocol,
) -> Result<Vec<u8>, ProtocolError> {
    let name = match message {
        ServerControl::SectorMap { .. } => "sectorMap",
        ServerControl::Hangar { .. } => "hangar",
        ServerControl::Chat { .. } => "chat",
        ServerControl::Sounds { .. } => "sounds",
        ServerControl::Profile { .. } => "profile",
        ServerControl::Progress { .. } => "progress",
        ServerControl::Respawn { .. } => "respawn",
        ServerControl::Welcome { .. } => "welcome",
    };
    let mut data = Vec::with_capacity(64);
    data.extend_from_slice(&HEADER);
    data.push(
        ids.control_message_ids
            .get(name)
            .copied()
            .unwrap_or_default() as u8,
    );
    let mut writer = Writer { data: &mut data };

    match *message {
        ServerControl::SectorMap { map_markers } => {
            writer.unsigned(map_markers.len() as u64);
            for marker in map_markers {
                let kind = match marker.kind.as_str() {
                    "field" => 0,
                    "station" => 1,
                    "ship" => 2,
                    "jumpGate" => 3,
                    "wormhole" => 4,
                    _ => return Err(ProtocolError::Control),
                };
                writer.byte(kind);
                writer.signed(marker.id);
                writer.vector(marker.position);
                writer.number(marker.radius);
                writer.text(&marker.name)?;
                writer.text(&marker.definition_id)?;
                writer.text(&marker.color)?;
                if kind == 2 {
                    writer.text(&marker.sender_role)?;
                }
            }
        }
        ServerControl::Hangar {
            ship_id,
            credits,
            hangar_error,
            ships_for_sale,
            hangar_ships,
        } => {
            writer.unsigned(ship_id);
            writer.number(credits);
            writer.text(hangar_error)?;
            writer.unsigned(ships_for_sale.len() as u64);
            for offer in ships_for_sale {
                writer.name(&offer.ship)?;
                writer.number(offer.price);
            }

            append_snapshot(writer.data, &hangar_ships, ids)?;
        }
        ServerControl::Chat {
            channel,
            sender,
            sender_role,
            text,
            cargo_demand,
        } => {
            if channel > 1 {
                return Err(ProtocolError::Control);
            }

            writer.byte(channel);
            writer.text(sender)?;
            writer.text(sender_role)?;
            writer.text(text)?;
            if let Some(cargo_demand) = cargo_demand {
                writer.unsigned(cargo_demand as u64);
            }
        }
        ServerControl::Sounds { sounds } => {
            writer.unsigned(sounds.len() as u64);
            for sound in sounds {
                if sound.effect > 9
                    || sound.effect == 8
                    || sound.by < 0
                    || !sound.position.x.is_finite()
                    || !sound.position.y.is_finite()
                {
                    return Err(ProtocolError::Control);
                }

                writer.byte(sound.effect);
                writer.signed(sound.id);
                writer.unsigned(sound.by as u64);
                writer.vector(sound.position);
            }
        }
        ServerControl::Profile { display_name } => writer.name(display_name)?,
        ServerControl::Progress {
            unlocked_paints,
            credits,
        } => {
            writer.unsigned(u64::from(unlocked_paints));
            if let Some(credits) = credits {
                if !credits.is_finite() || credits < 0.0 {
                    return Err(ProtocolError::Control);
                }

                writer.number(credits);
            }
        }
        ServerControl::Respawn { ship_id } => writer.unsigned(ship_id),
        ServerControl::Welcome {
            player_id,
            ship_id,
            server_tick,
            player_token,
            world_seed,
            spawn,
            unlocked_paints,
            credits,
            display_name,
            sector_name,
        } => {
            if credits.is_some_and(|credits| {
                unlocked_paints.is_none() || !credits.is_finite() || credits < 0.0
            }) || display_name.is_some() && credits.is_none()
                || sector_name.is_some() && display_name.is_none()
            {
                return Err(ProtocolError::Control);
            }

            writer.unsigned(player_id);
            writer.unsigned(ship_id);
            writer.unsigned(server_tick);
            writer.uuid(player_token)?;
            writer.number(world_seed);
            writer.vector(spawn);
            if let Some(unlocked_paints) = unlocked_paints {
                writer.unsigned(u64::from(unlocked_paints));
            }
            if let Some(credits) = credits {
                writer.number(credits);
            }
            if let Some(display_name) = display_name {
                writer.name(display_name)?;
            }
            if let Some(sector_name) = sector_name {
                writer.name(sector_name)?;
            }
        }
    }

    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::wire::hex_digit;
    use crate::specs::Catalog;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Fixture {
        client: Vec<Case<Control>>,
        server: Vec<Case<ServerMessage>>,
    }

    #[derive(Deserialize)]
    struct Case<Message> {
        message: Message,
        hex: String,
    }

    #[derive(Debug, Deserialize)]
    #[serde(
        tag = "type",
        rename_all = "camelCase",
        rename_all_fields = "camelCase"
    )]
    enum ServerMessage {
        SectorMap {
            map_markers: Vec<MapMarker>,
        },
        Chat {
            channel: u8,
            sender: String,
            sender_role: String,
            text: String,
            cargo_demand: Option<i64>,
        },
        Sounds {
            sounds: Vec<WorldSound>,
        },
        Profile {
            display_name: String,
        },
        Progress {
            unlocked_paints: u16,
            credits: Option<f64>,
        },
        Respawn {
            ship_id: u64,
        },
        Welcome {
            player_id: u64,
            ship_id: u64,
            server_tick: u64,
            player_token: String,
            world_seed: f64,
            spawn: Vector,
            unlocked_paints: Option<u16>,
            credits: Option<f64>,
            display_name: Option<String>,
            sector_name: Option<String>,
        },
    }

    impl ServerMessage {
        fn control(&self) -> ServerControl<'_> {
            match self {
                Self::SectorMap { map_markers } => ServerControl::SectorMap { map_markers },
                Self::Chat {
                    channel,
                    sender,
                    sender_role,
                    text,
                    cargo_demand,
                } => ServerControl::Chat {
                    channel: *channel,
                    sender,
                    sender_role,
                    text,
                    cargo_demand: *cargo_demand,
                },
                Self::Sounds { sounds } => ServerControl::Sounds { sounds },
                Self::Profile { display_name } => ServerControl::Profile { display_name },
                Self::Progress {
                    unlocked_paints,
                    credits,
                } => ServerControl::Progress {
                    unlocked_paints: *unlocked_paints,
                    credits: *credits,
                },
                Self::Respawn { ship_id } => ServerControl::Respawn { ship_id: *ship_id },
                Self::Welcome {
                    player_id,
                    ship_id,
                    server_tick,
                    player_token,
                    world_seed,
                    spawn,
                    unlocked_paints,
                    credits,
                    display_name,
                    sector_name,
                } => ServerControl::Welcome {
                    player_id: *player_id,
                    ship_id: *ship_id,
                    server_tick: *server_tick,
                    player_token,
                    world_seed: *world_seed,
                    spawn: *spawn,
                    unlocked_paints: *unlocked_paints,
                    credits: *credits,
                    display_name: display_name.as_deref(),
                    sector_name: sector_name.as_deref(),
                },
            }
        }
    }

    fn bytes(hex: &str) -> Vec<u8> {
        let (pairs, remainder) = hex.as_bytes().as_chunks::<2>();
        assert!(remainder.is_empty());
        pairs
            .iter()
            .map(|pair| hex_digit(pair[0]).unwrap() << 4 | hex_digit(pair[1]).unwrap())
            .collect()
    }

    #[test]
    fn controls_match_typescript_fixtures() -> Result<(), Box<dyn std::error::Error>> {
        let catalog = Catalog::load()?;
        let fixtures: Fixture = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/fixtures/controls.json"
        )))?;

        for Case { message, hex } in fixtures.client {
            let actual = decode_client_control(
                &bytes(&hex),
                &catalog.protocol,
                catalog.simulation.simulation_step,
            )?;
            assert_eq!(actual, message);
        }

        for Case { message, hex } in fixtures.server {
            let actual = encode_server_control(&message.control(), &catalog.protocol)?;
            assert_eq!(actual, bytes(&hex), "{message:?}");
        }

        Ok(())
    }

    #[test]
    fn input_flags_decode_independently() -> Result<(), Box<dyn std::error::Error>> {
        let catalog = Catalog::load()?;
        let id = catalog.protocol.control_message_ids["input"] as u8;
        let step = catalog.simulation.simulation_step;

        for flags in [0, 2, 4, 8, 6, 10, 12, 14, 16, 18, 30, 32, 128, 254] {
            for has_offset in [false, true] {
                for boost in [0, 1] {
                    let mut bytes = vec![
                        0x55,
                        0x43,
                        1,
                        id,
                        0,
                        1,
                        127,
                        flags | u8::from(has_offset),
                        boost,
                    ];
                    let mut writer = Writer { data: &mut bytes };
                    if has_offset {
                        writer.number(0.01);
                    }
                    if flags & 64 != 0 {
                        writer.signed(1 << 45);
                    }

                    let message = decode_client_control(&bytes, &catalog.protocol, step)?;
                    assert_eq!(
                        message,
                        Control::Input {
                            tick: 0,
                            sequence: 1,
                            input: Input {
                                horn_drill: true,
                                cargo_hatch: true,
                                search_light: true,
                                shield_generator: true,
                                launch: true,
                                fire: flags & 2 != 0,
                                plasma_active: flags & 4 != 0,
                                autogun_active: flags & 8 != 0,
                                laser_active: flags & 16 != 0,
                                cargo_release: flags & 32 != 0,
                                flight_mode: flags & 128 != 0,
                                thrust_boost: boost == 1,
                                target_id: (flags & 64 != 0).then_some(1 << 45),
                                thrust: 1.0,
                                turn: -1.0,
                            },
                            offset: has_offset.then_some(0.01),
                        }
                    );
                }
            }
        }

        let id = catalog.protocol.control_message_ids["dock"] as u8;
        let ammo = catalog.protocol.dock_action_ids["buyAmmo"] as u8;
        assert_eq!(
            decode_client_control(&[0x55, 0x43, 1, id, ammo], &catalog.protocol, step)?,
            Control::Dock {
                action: DockAction::BuyAmmo,
                sequence: 0
            },
        );
        Ok(())
    }

    #[test]
    fn rejects_malformed_inputs_and_tokens() -> Result<(), Box<dyn std::error::Error>> {
        let catalog = Catalog::load()?;
        let ids = &catalog.protocol;
        let step = catalog.simulation.simulation_step;
        let input_id = ids.control_message_ids["input"] as u8;

        for invalid in [2, 128, 255] {
            let bytes = [0x55, 0x43, 1, input_id, 0, 1, 0, 0, invalid];
            assert_eq!(
                decode_client_control(&bytes, ids, step),
                Err(ProtocolError::Control)
            );
        }
        for invalid in [
            &[][..],
            &[0x80, 0],
            &[0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x20],
        ] {
            let mut bytes = vec![0x55, 0x43, 1, input_id, 0, 1, 0, 64, 0];
            bytes.extend_from_slice(invalid);
            assert_eq!(
                decode_client_control(&bytes, ids, step),
                Err(ProtocolError::Control)
            );
        }
        for target in [0, -1, 1 << 45, (1 << 53) - 1, -((1 << 53) - 1)] {
            let mut bytes = vec![0x55, 0x43, 1, input_id, 0, 1, 0, 64, 0];
            Writer { data: &mut bytes }.signed(target);
            let Control::Input { input, .. } = decode_client_control(&bytes, ids, step)? else {
                panic!("expected input control");
            };
            assert_eq!(input.target_id, Some(target));
        }

        for kind in ["hello", "prepare"] {
            let mut packet = vec![0x55, 0x43, 1, ids.control_message_ids[kind] as u8];
            assert_eq!(
                decode_client_control(&packet, ids, step),
                Err(ProtocolError::Control)
            );

            packet.push(2);
            assert_eq!(
                decode_client_control(&packet, ids, step),
                Err(ProtocolError::Control)
            );
            packet[4] = 1;
            assert_eq!(
                decode_client_control(&packet, ids, step),
                Err(ProtocolError::Control)
            );
        }

        let profile = ids.control_message_ids["profile"] as u8;
        let invalid_utf8 = [0x55, 0x43, 1, profile, 1, 0xff];
        assert_eq!(
            decode_client_control(&invalid_utf8, ids, step),
            Err(ProtocolError::Control)
        );
        assert!(valid_display_name(&"🦄".repeat(16)));
        assert!(!valid_display_name(&"🦄".repeat(17)));
        assert_eq!(
            decode_client_control(&[0x55, 0x43, 1, input_id, 0, 1, 0, 0], ids, step),
            Err(ProtocolError::Control),
        );

        let mut data = Vec::new();
        let mut writer = Writer { data: &mut data };
        for invalid_uuid in [
            "01234567-89ab-cdef-0123-456789abcde-",
            "01234567-89ab-cdef_0123-456789abcdef",
            "01234567-89ab-cdef-0123-456789abcdeg",
        ] {
            assert_eq!(writer.uuid(invalid_uuid), Err(ProtocolError::Control));
        }
        assert!(data.is_empty());
        Ok(())
    }

    #[test]
    fn hangar_embeds_snapshot_after_offer_list() -> Result<(), Box<dyn std::error::Error>> {
        let catalog = Catalog::load()?;
        let message = ServerControl::Hangar {
            ship_id: 7,
            credits: 10.0,
            hangar_error: "",
            ships_for_sale: &[ShipOffer {
                ship: "kestrel".into(),
                price: 15.0,
            }],
            hangar_ships: Snapshot {
                tick: 2,
                next_entity_id: 8,
                load: true,
                ..Snapshot::default()
            },
        };
        let expected =
            bytes("5543010e0700000000000024400001076b65737472656c0000000000002e40554d0101020800");
        assert_eq!(
            encode_server_control(&message, &catalog.protocol)?,
            expected
        );
        Ok(())
    }
}
