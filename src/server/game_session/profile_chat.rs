use std::io;
use std::time::{Duration, Instant};

use crate::persistence::PlayerRole;
use crate::protocol::{ServerControl, valid_display_name};
use crate::utilities::vector::Vector;

use super::name_matching::equal_name;

const INITIAL_OWNER_NAME: &str = "burntcustard";
const CHAT_INTERVAL: Duration = Duration::from_millis(500);
const MAX_CHAT_CHARACTERS: usize = 240;
pub const BANNED_CODE: u16 = 4003;
pub const BANNED_MESSAGE: &str =
    "Sorry, you have been banned. Contact john@burnt.io if you think this was a mistake";

#[derive(Clone, Copy)]
pub struct ProfileView<'a> {
    pub player_number: i64,
    pub display_name: &'a str,
    pub role: PlayerRole,
    pub banned: bool,
}

pub struct ProfileFields<'a> {
    pub display_name: &'a mut String,
    pub role: &'a mut PlayerRole,
    pub banned: &'a mut bool,
}

pub enum ProfileMatch {
    Missing,
    Unique(i64, PlayerRole),
    Ambiguous,
    Unavailable,
}

pub trait ProfileRoster {
    fn profiles(&self) -> impl Iterator<Item = ProfileView<'_>>;
    fn profile(&self, id: i64) -> Option<ProfileView<'_>>;
    fn profile_mut(&mut self, id: i64) -> Option<ProfileFields<'_>>;

    fn has_owner(&self) -> bool {
        self.profiles()
            .any(|profile| profile.role == PlayerRole::Owner)
    }

    fn name_taken(&self, name: &str) -> io::Result<bool> {
        Ok(self
            .profiles()
            .any(|profile| equal_name(profile.display_name, name)))
    }

    fn find_named_profile(&mut self, name: &str) -> ProfileMatch {
        let mut matches = self
            .profiles()
            .filter(|profile| equal_name(profile.display_name, name));
        match (matches.next(), matches.next()) {
            (None, _) => ProfileMatch::Missing,
            (Some(profile), None) => ProfileMatch::Unique(profile.player_number, profile.role),
            _ => ProfileMatch::Ambiguous,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProfileChange {
    Ignored,
    NameTaken,
    Unchanged,
    Changed { assigned_owner: Option<i64> },
}

pub fn set_profile_name(
    roster: &mut impl ProfileRoster,
    player_number: i64,
    display_name: String,
) -> io::Result<ProfileChange> {
    if display_name.is_empty() || !valid_display_name(&display_name) {
        return Ok(ProfileChange::Ignored);
    }
    let Some(profile) = roster.profile(player_number) else {
        return Ok(ProfileChange::Ignored);
    };
    if !profile.display_name.is_empty() {
        return Ok(ProfileChange::Unchanged);
    }
    if roster.name_taken(&display_name)? {
        return Ok(ProfileChange::NameTaken);
    }

    let Some(fields) = roster.profile_mut(player_number) else {
        return Ok(ProfileChange::Ignored);
    };
    *fields.display_name = display_name;
    Ok(ProfileChange::Changed {
        assigned_owner: assign_initial_owner(roster),
    })
}

/// Bootstrap ownership once for a uniquely matching account.
pub fn assign_initial_owner(roster: &mut impl ProfileRoster) -> Option<i64> {
    if roster.has_owner() {
        return None;
    }
    let ProfileMatch::Unique(id, _) = roster.find_named_profile(INITIAL_OWNER_NAME) else {
        return None;
    };
    *roster.profile_mut(id)?.role = PlayerRole::Owner;
    Some(id)
}

fn can_moderate(role: PlayerRole) -> bool {
    matches!(role, PlayerRole::Admin | PlayerRole::Owner)
}

#[derive(Debug, PartialEq)]
pub enum ChatDispatch<'a> {
    Ignore,
    Relay {
        channel: u8,
        text: &'a str,
    },
    Reply {
        channel: u8,
        text: String,
    },
    Moderated {
        channel: u8,
        text: String,
        target_id: i64,
        disconnect_if_connected: bool,
    },
    Teleport {
        channel: u8,
        destination: Vector,
    },
    List {
        channel: u8,
        include_locations: bool,
    },
}

#[derive(Default)]
pub struct ChatThrottle {
    last: Option<Instant>,
}

impl ChatThrottle {
    pub fn dispatch<'a>(
        &mut self,
        roster: &mut impl ProfileRoster,
        player_number: i64,
        channel: u8,
        text: &'a str,
        now: Instant,
    ) -> ChatDispatch<'a> {
        let text = text.trim();
        if text.is_empty()
            || self
                .last
                .is_some_and(|then| now.saturating_duration_since(then) < CHAT_INTERVAL)
        {
            return ChatDispatch::Ignore;
        }
        let Some(player) = roster.profile(player_number) else {
            return ChatDispatch::Ignore;
        };
        if player.banned {
            return ChatDispatch::Ignore;
        }

        self.last = Some(now);
        let mut fields = text.split_whitespace();
        let Some(command) = fields.next() else {
            return ChatDispatch::Ignore;
        };
        let moderator = can_moderate(player.role);

        match command {
            "/tp" | "/admin" | "/unadmin" | "/ban" | "/pardon" if !moderator => {
                reply(channel, "Only admins and owners can use this command.")
            }
            "/tp" => teleport_command(channel, fields),
            "/admin" | "/unadmin" | "/ban" | "/pardon" => {
                let target_name = text[command.len()..].trim();
                moderation_command(roster, channel, command, target_name)
            }
            "/list" if fields.next().is_some() => reply(channel, "Usage: /list"),
            "/list" => ChatDispatch::List {
                channel,
                include_locations: moderator,
            },
            _ => ChatDispatch::Relay { channel, text },
        }
    }
}

fn reply(channel: u8, text: impl Into<String>) -> ChatDispatch<'static> {
    ChatDispatch::Reply {
        channel,
        text: text.into(),
    }
}

fn moderation_command(
    roster: &mut impl ProfileRoster,
    channel: u8,
    command: &str,
    target_name: &str,
) -> ChatDispatch<'static> {
    if target_name.is_empty() {
        return reply(channel, format!("Usage: {command} playername"));
    }

    let target_id = match roster.find_named_profile(target_name) {
        ProfileMatch::Missing => return reply(channel, "Player not found."),
        ProfileMatch::Ambiguous => {
            return reply(
                channel,
                "More than one player has that name; no changes were made.",
            );
        }
        ProfileMatch::Unavailable => return reply(channel, "Player lookup unavailable."),
        ProfileMatch::Unique(_, PlayerRole::Owner) => {
            return reply(channel, "Owners cannot be changed by this command.");
        }
        ProfileMatch::Unique(id, _) => id,
    };

    let Some(target) = roster.profile_mut(target_id) else {
        return reply(channel, "Player not found.");
    };
    let text = match command {
        "/admin" => {
            *target.role = PlayerRole::Admin;
            format!("{} is now an admin.", target.display_name)
        }
        "/unadmin" => {
            *target.role = PlayerRole::User;
            format!("{} is now a user.", target.display_name)
        }
        "/ban" => {
            *target.banned = true;
            format!("{} has been banned.", target.display_name)
        }
        "/pardon" => {
            *target.banned = false;
            format!("{} has been pardoned.", target.display_name)
        }
        _ => return ChatDispatch::Ignore,
    };
    ChatDispatch::Moderated {
        channel,
        text,
        target_id,
        disconnect_if_connected: command == "/ban",
    }
}

fn coordinate(value: &str) -> Option<f64> {
    let (negative, unsigned) = strip_sign(value);
    let parsed = if let Some(hex) = unsigned
        .strip_prefix("0x")
        .or_else(|| unsigned.strip_prefix("0X"))
    {
        hex_coordinate(hex, negative)?
    } else if value.contains('_') {
        strip_digit_separators(value)?.parse().ok()?
    } else {
        value.parse().ok()?
    };

    f64::is_finite(parsed).then_some(parsed)
}

fn strip_sign(value: &str) -> (bool, &str) {
    match value.as_bytes().first() {
        Some(b'-') => (true, &value[1..]),
        Some(b'+') => (false, &value[1..]),
        _ => (false, value),
    }
}

fn strip_digit_separators(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut clean = String::with_capacity(value.len());
    for (index, character) in value.char_indices() {
        if character == '_' {
            if index == 0
                || !bytes[index - 1].is_ascii_digit()
                || !bytes.get(index + 1).is_some_and(u8::is_ascii_digit)
            {
                return None;
            }
        } else {
            clean.push(character);
        }
    }
    Some(clean)
}

fn binary_exponent(value: &str) -> Option<i32> {
    let (negative, digits) = strip_sign(value);
    let digits = if digits.contains('_') {
        std::borrow::Cow::Owned(strip_digit_separators(digits)?)
    } else {
        std::borrow::Cow::Borrowed(digits)
    };
    if digits.is_empty() {
        return None;
    }

    let mut exponent = 0_i32;
    for byte in digits.bytes() {
        if !byte.is_ascii_digit() {
            return None;
        }
        exponent = exponent
            .saturating_mul(10)
            .saturating_add(i32::from(byte - b'0'));
    }
    Some(if negative { -exponent } else { exponent })
}

fn hex_coordinate(hex: &str, negative: bool) -> Option<f64> {
    let (digits, exponent) = hex.split_once(['p', 'P'])?;
    let exponent = binary_exponent(exponent)?;
    let bytes = digits.as_bytes();
    let mut point = false;
    let mut saw_digit = false;
    let mut fraction = 0_i32;
    let mut significand = 0_u64;
    let mut kept_digits = 0;
    let mut discarded_digits = 0_i32;
    let mut sticky = false;
    for (index, &byte) in bytes.iter().enumerate() {
        match byte {
            b'.' if !point => point = true,
            b'_' => {
                let preceded = index == 0 || bytes[index - 1].is_ascii_hexdigit();
                let followed = bytes.get(index + 1).is_some_and(u8::is_ascii_hexdigit);
                if !preceded || !followed {
                    return None;
                }
            }
            byte => {
                let digit = u64::from(char::from(byte).to_digit(16)?);
                saw_digit = true;
                fraction += i32::from(point);
                if digit != 0 || kept_digits != 0 {
                    if kept_digits < 16 {
                        significand = (significand << 4) | digit;
                        kept_digits += 1;
                    } else {
                        discarded_digits += 1;
                        sticky |= digit != 0;
                    }
                }
            }
        }
    }
    if !saw_digit {
        return None;
    }

    let sign = u64::from(negative) << 63;
    if significand == 0 {
        return Some(f64::from_bits(sign));
    }
    let power = exponent.saturating_add(4 * (discarded_digits - fraction));
    let highest_bit = 63 - significand.leading_zeros() as i32;
    let highest_exponent = power.saturating_add(highest_bit);
    if highest_exponent > 1023 {
        return None;
    }
    if highest_exponent < -1075 {
        return Some(f64::from_bits(sign));
    }

    // Round directly to the binary64 significand, including subnormal values and ties.
    let bits = if highest_exponent >= -1022 {
        let fraction_bits = round_significand(significand, highest_bit - 52, sticky);
        (((highest_exponent + 1022) as u64) << 52) + fraction_bits
    } else {
        round_significand(significand, -1074 - power, sticky)
    };
    Some(f64::from_bits(sign | bits))
}

fn round_significand(value: u64, shift: i32, sticky: bool) -> u64 {
    if shift <= 0 {
        return value << (-shift as u32);
    }
    let Some(half) = 1_u64.checked_shl((shift - 1) as u32) else {
        return 0;
    };
    let remainder = value & (half | (half - 1));
    let truncated = value.checked_shr(shift as u32).unwrap_or_default();
    truncated + u64::from(remainder > half || remainder == half && (sticky || truncated & 1 != 0))
}

fn teleport_command<'a>(
    channel: u8,
    mut fields: impl Iterator<Item = &'a str>,
) -> ChatDispatch<'static> {
    let (Some(x), Some(y), None) = (fields.next(), fields.next(), fields.next()) else {
        return reply(channel, "Usage: /tp x y (for example, /tp -5804 -53070)");
    };

    let x = x.strip_suffix(',').unwrap_or(x);
    let (Some(x), Some(y)) = (coordinate(x), coordinate(y)) else {
        return reply(
            channel,
            "Coordinates must be finite numbers. Usage: /tp x y",
        );
    };
    ChatDispatch::Teleport {
        channel,
        destination: Vector { x, y },
    }
}

pub fn teleport_reply(can_relocate: bool, destination: Vector) -> String {
    if can_relocate {
        format!(
            "Teleported to {}, {}.",
            general_float(destination.x),
            general_float(destination.y)
        )
    } else {
        "You must be flying a ship to teleport. Leave the station or respawn first.".to_owned()
    }
}

pub fn system_chat(channel: u8, text: &str) -> ServerControl<'_> {
    ServerControl::Chat {
        channel,
        sender: "System",
        sender_role: "friendly",
        text,
        cargo_demand: None,
    }
}

pub fn player_chat<'a>(player: ProfileView<'a>, channel: u8, text: &'a str) -> ServerControl<'a> {
    let sender_role = match player.role {
        PlayerRole::User => "user",
        PlayerRole::Admin => "admin",
        PlayerRole::Owner => "owner",
    };
    ServerControl::Chat {
        channel,
        sender: player.display_name,
        sender_role,
        text,
        cargo_demand: None,
    }
}

pub fn receives_relay(
    channel: u8,
    sender_sector: &str,
    recipient_sector: &str,
    connected: bool,
    played: bool,
) -> bool {
    connected && played && (channel == 1 || recipient_sector == sender_sector)
}

pub struct OnlinePlayer<'a> {
    pub display_name: &'a str,
    pub sector_id: &'a str,
    pub sector_name: Option<&'a str>,
    pub position: Vector,
    pub socket_open: bool,
    pub playing: bool,
}

pub fn list_players<'a>(
    players: impl IntoIterator<Item = OnlinePlayer<'a>>,
    include_locations: bool,
) -> Vec<String> {
    let mut lines = Vec::new();
    for player in players {
        if !player.socket_open || !player.playing {
            continue;
        }
        let name = if player.display_name.is_empty() {
            "Unnamed player"
        } else {
            player.display_name
        };
        let line = if include_locations {
            format!(
                "{name} — {} ({}, {})",
                player.sector_name.unwrap_or(player.sector_id),
                general_float(player.position.x.round()),
                general_float(player.position.y.round()),
            )
        } else {
            name.to_owned()
        };
        lines.push(line);
    }
    lines.sort_unstable();

    let mut replies = Vec::new();
    let mut text = format!("Players online: {}", lines.len());
    for line in lines {
        if text.chars().count() + 1 + line.chars().count() > MAX_CHAT_CHARACTERS {
            replies.push(std::mem::replace(&mut text, line));
        } else {
            text.push('\n');
            text.push_str(&line);
        }
    }
    replies.push(text);
    replies
}

// Use the shortest round-trippable spelling, with scientific notation outside the decimal exponent range.
fn general_float(value: f64) -> String {
    if value == f64::INFINITY {
        return "+Inf".to_owned();
    }
    if value == f64::NEG_INFINITY {
        return "-Inf".to_owned();
    }
    let scientific = format!("{value:e}");
    if let Some((mantissa, exponent)) = scientific.split_once('e')
        && let Ok(exponent) = exponent.parse::<i32>()
        && !(-4..6).contains(&exponent)
    {
        return format!("{mantissa}e{exponent:+03}");
    }
    value.to_string()
}

const GATE_RESPONSE_MARGIN: f64 = 1e-9;

#[derive(Clone, Copy, Debug)]
struct GateRequest {
    id: i64,
    elapsed: f64,
    pending_sent: bool,
}

#[derive(Default)]
pub struct GateAccess {
    request: Option<GateRequest>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GateReplies {
    pub pending: bool,
    pub granted: bool,
}

impl GateAccess {
    /// Start an eligible access request. Repeating the same request leaves its timer running.
    pub fn request(&mut self, gate_id: i64) {
        if self.gate_id() != Some(gate_id) {
            self.request = Some(GateRequest {
                id: gate_id,
                elapsed: 0.0,
                pending_sent: false,
            });
        }
    }

    pub fn gate_id(&self) -> Option<i64> {
        self.request.map(|request| request.id)
    }

    pub fn cancel(&mut self) {
        self.request = None;
    }

    /// Advance after the world checks the pending gate, player, sector and approach range.
    pub fn advance(&mut self, dt: f64, response_delay_ms: f64, eligible: bool) -> GateReplies {
        if !eligible {
            self.cancel();
            return GateReplies::default();
        }
        let Some(request) = &mut self.request else {
            return GateReplies::default();
        };

        request.elapsed += dt;
        let delay = response_delay_ms / 1000.0;
        let pending = !request.pending_sent && request.elapsed + GATE_RESPONSE_MARGIN >= delay;
        request.pending_sent |= pending;
        let granted = request.elapsed + GATE_RESPONSE_MARGIN >= 2.0 * delay;
        if granted {
            self.cancel();
        }

        GateReplies { pending, granted }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Account {
        id: i64,
        name: String,
        role: PlayerRole,
        banned: bool,
    }

    impl Account {
        fn view(&self) -> ProfileView<'_> {
            ProfileView {
                player_number: self.id,
                display_name: &self.name,
                role: self.role,
                banned: self.banned,
            }
        }
    }

    struct Roster(Vec<Account>);

    impl Roster {
        fn new(names: &[&str]) -> Self {
            Self(
                names
                    .iter()
                    .enumerate()
                    .map(|(index, name)| Account {
                        id: (index + 1) as i64,
                        name: (*name).into(),
                        role: PlayerRole::User,
                        banned: false,
                    })
                    .collect(),
            )
        }
    }

    impl ProfileRoster for Roster {
        fn profiles(&self) -> impl Iterator<Item = ProfileView<'_>> {
            self.0.iter().map(Account::view)
        }

        fn profile(&self, id: i64) -> Option<ProfileView<'_>> {
            self.0
                .iter()
                .find(|account| account.id == id)
                .map(Account::view)
        }

        fn profile_mut(&mut self, id: i64) -> Option<ProfileFields<'_>> {
            let account = self.0.iter_mut().find(|account| account.id == id)?;
            Some(ProfileFields {
                display_name: &mut account.name,
                role: &mut account.role,
                banned: &mut account.banned,
            })
        }
    }

    fn dispatch<'a>(roster: &mut Roster, id: i64, text: &'a str) -> ChatDispatch<'a> {
        ChatThrottle::default().dispatch(roster, id, 1, text, Instant::now())
    }

    #[test]
    fn profile_values_are_authoritative_immutable_and_preserve_unicode() {
        let mut roster = Roster::new(&["", "", ""]);
        assert_eq!(
            set_profile_name(&mut roster, 4, "unknown".into()).unwrap(),
            ProfileChange::Ignored
        );
        for invalid in ["".to_owned(), "a".repeat(17), "🦄".repeat(17)] {
            assert_eq!(
                set_profile_name(&mut roster, 2, invalid).unwrap(),
                ProfileChange::Ignored
            );
        }

        // Long s and ASCII s lie in the same simple-fold orbit.
        assert_eq!(
            set_profile_name(&mut roster, 1, "BURNTCUſTARD".into()).unwrap(),
            ProfileChange::Changed {
                assigned_owner: Some(1)
            },
        );
        assert_eq!(roster.profile(1).unwrap().role, PlayerRole::Owner);
        assert_eq!(
            set_profile_name(&mut roster, 2, "burntcustard".into()).unwrap(),
            ProfileChange::NameTaken,
        );
        assert!(roster.profile(2).unwrap().display_name.is_empty());
        assert_eq!(
            set_profile_name(&mut roster, 2, "Another Pilot".into()).unwrap(),
            ProfileChange::Changed {
                assigned_owner: None
            },
        );
        assert_eq!(roster.profile(2).unwrap().role, PlayerRole::User);

        let name = " aē🦄 <&>\0 ";
        assert_eq!(
            set_profile_name(&mut roster, 3, name.into()).unwrap(),
            ProfileChange::Changed {
                assigned_owner: None
            },
        );
        assert_eq!(
            set_profile_name(&mut roster, 3, "replacement".into()).unwrap(),
            ProfileChange::Unchanged
        );
        assert_eq!(roster.profile(3).unwrap().display_name, name);
        assert_eq!(
            set_profile_name(&mut roster, 3, "".into()).unwrap(),
            ProfileChange::Ignored
        );
    }

    #[test]
    fn ownership_bootstrap_requires_one_unique_account_and_no_current_owner() {
        let mut roster = Roster::new(&["burntcustard", "BurntCustard", "Other"]);
        assert_eq!(assign_initial_owner(&mut roster), None);
        assert!(
            roster
                .profiles()
                .all(|profile| profile.role == PlayerRole::User)
        );

        roster.profile_mut(2).unwrap().display_name.clear();
        assert_eq!(assign_initial_owner(&mut roster), Some(1));
        *roster.profile_mut(1).unwrap().display_name = "Former owner name".into();
        *roster.profile_mut(2).unwrap().display_name = "burntcustard".into();
        assert_eq!(assign_initial_owner(&mut roster), None);
        assert_eq!(roster.profile(1).unwrap().role, PlayerRole::Owner);
        assert_eq!(roster.profile(2).unwrap().role, PlayerRole::User);
    }

    #[test]
    fn moderation_matches_unique_names_and_preserves_owner_authority() {
        let mut roster = Roster::new(&["burntcustard", "Other Admin", "Pilot", ""]);
        assign_initial_owner(&mut roster);
        for command in [
            "/admin Other Admin",
            "/unadmin burntcustard",
            "/ban Other Admin",
            "/pardon Other Admin",
            "/tp 100 200",
        ] {
            assert_eq!(
                dispatch(&mut roster, 3, command),
                reply(1, "Only admins and owners can use this command.")
            );
        }
        assert_eq!(roster.profile(2).unwrap().role, PlayerRole::User);

        assert_eq!(
            dispatch(&mut roster, 1, "/admin other admin"),
            ChatDispatch::Moderated {
                channel: 1,
                text: "Other Admin is now an admin.".into(),
                target_id: 2,
                disconnect_if_connected: false,
            },
        );
        assert_eq!(roster.profile(2).unwrap().role, PlayerRole::Admin);
        assert!(matches!(
            dispatch(&mut roster, 2, "/admin Pilot"),
            ChatDispatch::Moderated { target_id: 3, .. }
        ));
        assert!(matches!(
            dispatch(&mut roster, 3, "/unadmin Other Admin"),
            ChatDispatch::Moderated { target_id: 2, .. }
        ));
        assert_eq!(roster.profile(2).unwrap().role, PlayerRole::User);
        assert_eq!(roster.profile(3).unwrap().role, PlayerRole::Admin);

        for command in [
            "/admin burntcustard",
            "/unadmin burntcustard",
            "/ban burntcustard",
            "/pardon burntcustard",
        ] {
            assert_eq!(
                dispatch(&mut roster, 3, command),
                reply(1, "Owners cannot be changed by this command.")
            );
        }
        *roster.profile_mut(4).unwrap().display_name = "Other Admin".into();
        assert_eq!(
            dispatch(&mut roster, 1, "/admin Other Admin"),
            reply(
                1,
                "More than one player has that name; no changes were made."
            )
        );
        assert_eq!(
            dispatch(&mut roster, 1, "/ban missing"),
            reply(1, "Player not found.")
        );
        assert_eq!(
            dispatch(&mut roster, 1, "/unadmin"),
            reply(1, "Usage: /unadmin playername")
        );
    }

    #[test]
    fn self_ban_blocks_chat_and_pardon_preserves_account_role() {
        let mut roster = Roster::new(&["burntcustard", "Admin"]);
        assign_initial_owner(&mut roster);
        dispatch(&mut roster, 1, "/admin Admin");
        assert_eq!(
            dispatch(&mut roster, 2, "/ban Admin"),
            ChatDispatch::Moderated {
                channel: 1,
                text: "Admin has been banned.".into(),
                target_id: 2,
                disconnect_if_connected: true,
            },
        );
        assert!(roster.profile(2).unwrap().banned);
        assert_eq!(
            dispatch(&mut roster, 2, "/pardon Admin"),
            ChatDispatch::Ignore
        );
        assert!(matches!(
            dispatch(&mut roster, 1, "/pardon ADMIN"),
            ChatDispatch::Moderated {
                target_id: 2,
                disconnect_if_connected: false,
                ..
            }
        ));
        assert!(!roster.profile(2).unwrap().banned);
        assert_eq!(roster.profile(2).unwrap().role, PlayerRole::Admin);
    }

    #[test]
    fn chat_trim_cooldown_channel_and_roles_match_the_original() {
        let mut roster = Roster::new(&["Pilot 🦄"]);
        let time = Instant::now();
        let mut throttle = ChatThrottle::default();
        assert_eq!(
            throttle.dispatch(&mut roster, 1, 1, "   ", time),
            ChatDispatch::Ignore
        );
        assert_eq!(
            throttle.dispatch(&mut roster, 1, 1, "  Hello sectors  ", time),
            ChatDispatch::Relay {
                channel: 1,
                text: "Hello sectors",
            }
        );
        assert_eq!(
            throttle.dispatch(
                &mut roster,
                1,
                1,
                "too fast",
                time + Duration::from_millis(499)
            ),
            ChatDispatch::Ignore
        );
        assert_eq!(
            throttle.dispatch(&mut roster, 1, 0, "/list extra", time + CHAT_INTERVAL),
            reply(0, "Usage: /list")
        );

        for (role, wire_role) in [
            (PlayerRole::User, "user"),
            (PlayerRole::Admin, "admin"),
            (PlayerRole::Owner, "owner"),
        ] {
            *roster.profile_mut(1).unwrap().role = role;
            let packet = player_chat(roster.profile(1).unwrap(), 1, "Hello sectors");
            assert!(matches!(packet, ServerControl::Chat {
                channel: 1, sender: "Pilot 🦄", sender_role, text: "Hello sectors", cargo_demand: None,
            } if sender_role == wire_role));
        }
        assert!(receives_relay(1, "a", "b", true, true));
        assert!(receives_relay(0, "a", "a", true, true));
        assert!(!receives_relay(0, "a", "b", true, true));
        assert!(!receives_relay(1, "a", "b", false, true));
        assert!(!receives_relay(1, "a", "b", true, false));
    }

    #[test]
    fn teleport_dispatch_keeps_valid_go_float_syntax_and_rejects_invalid_input() {
        let mut roster = Roster::new(&["burntcustard"]);
        assign_initial_owner(&mut roster);
        for (command, expected) in [
            (
                "/tp -5804 -53070",
                Vector {
                    x: -5804.0,
                    y: -53070.0,
                },
            ),
            (
                "  /tp 123.5, -456.25  ",
                Vector {
                    x: 123.5,
                    y: -456.25,
                },
            ),
            ("/tp 1_000.2e-1, -0.0", Vector { x: 100.02, y: -0.0 }),
            ("/tp 0x_1.8P1 -0X.8p+1", Vector { x: 3.0, y: -1.0 }),
            ("/tp 0x1.00000000000008p0 .5", Vector { x: 1.0, y: 0.5 }),
        ] {
            let ChatDispatch::Teleport {
                channel,
                destination,
            } = dispatch(&mut roster, 1, command)
            else {
                panic!("expected valid command {command}");
            };
            assert_eq!(channel, 1);
            assert_eq!(destination.x.to_bits(), expected.x.to_bits(), "{command}");
            assert_eq!(destination.y.to_bits(), expected.y.to_bits(), "{command}");
        }

        for invalid in ["/tp", "/tp 1", "/tp 1 2 3"] {
            assert_eq!(
                dispatch(&mut roster, 1, invalid),
                reply(1, "Usage: /tp x y (for example, /tp -5804 -53070)")
            );
        }
        for invalid in [
            "/tp nope 2",
            "/tp NaN 2",
            "/tp 1 +Inf",
            "/tp 1e999 2",
            "/tp 0x1 2",
            "/tp 1_ 2",
            "/tp 0x_.1p1 2",
            "/tp 1e_2 2",
        ] {
            assert_eq!(
                dispatch(&mut roster, 1, invalid),
                reply(1, "Coordinates must be finite numbers. Usage: /tp x y"),
                "{invalid}"
            );
        }
        assert_eq!(
            teleport_reply(
                true,
                Vector {
                    x: 0.00001,
                    y: 1000000.0
                }
            ),
            "Teleported to 1e-05, 1e+06."
        );
        assert_eq!(
            teleport_reply(false, Vector::default()),
            "You must be flying a ship to teleport. Leave the station or respawn first."
        );
    }

    #[test]
    fn list_preserves_sorted_players_unicode_packet_boundaries_and_roles() {
        let player = |display_name| OnlinePlayer {
            display_name,
            sector_id: "sector-id",
            sector_name: Some("Sector"),
            position: Vector {
                x: 1e300,
                y: -1e300,
            },
            socket_open: true,
            playing: true,
        };
        let online = [
            player("Pilot"),
            OnlinePlayer {
                sector_name: None,
                position: Vector {
                    x: 123.0,
                    y: -456.0,
                },
                ..player("Other")
            },
            OnlinePlayer {
                socket_open: false,
                ..player("Offline")
            },
            OnlinePlayer {
                playing: false,
                ..player("Menu")
            },
        ];
        assert_eq!(
            list_players(online, false),
            ["Players online: 2\nOther\nPilot"]
        );

        let mut roster = Roster::new(&["burntcustard", "Other"]);
        assign_initial_owner(&mut roster);
        assert_eq!(
            dispatch(&mut roster, 1, "/list"),
            ChatDispatch::List {
                channel: 1,
                include_locations: true
            }
        );
        assert_eq!(
            dispatch(&mut roster, 2, "/list"),
            ChatDispatch::List {
                channel: 1,
                include_locations: false
            }
        );

        let mut names = (0..12)
            .map(|index| format!("Pilot {index:02} 🦄"))
            .collect::<Vec<_>>();
        names.extend(["Pilot".into(), "Other".into()]);
        let replies = list_players(names.iter().map(|name| player(name.as_str())), true);
        let total = replies.join("\n");
        assert!(replies.len() > 1);
        assert!(replies.iter().all(|reply| reply.chars().count() <= 240));
        assert!(total.starts_with("Players online: 14\n"));
        assert_eq!(total.matches('\n').count(), 14);
        assert!(total.contains("(1e+300, -1e+300)"));
    }

    #[test]
    fn gate_access_delay_retains_repeats_and_cancels_when_out_of_range() {
        let mut access = GateAccess::default();
        let response_ms = 1000.0;
        assert_eq!(
            access.advance(20.0, response_ms, true),
            GateReplies::default()
        );

        access.request(1);
        assert_eq!(
            access.advance(0.5, response_ms, true),
            GateReplies::default()
        );
        access.request(1);
        assert_eq!(
            access.advance(0.5, response_ms, true),
            GateReplies {
                pending: true,
                granted: false
            }
        );
        assert_eq!(
            access.advance(0.5, response_ms, true),
            GateReplies::default()
        );
        assert_eq!(
            access.advance(0.5, response_ms, true),
            GateReplies {
                pending: false,
                granted: true
            }
        );
        assert_eq!(access.gate_id(), None);

        access.request(1);
        assert!(access.advance(1.0, response_ms, true).pending);
        assert_eq!(
            access.advance(1.0, response_ms, false),
            GateReplies::default()
        );
        assert_eq!(access.gate_id(), None);

        access.request(1);
        access.advance(0.9, response_ms, true);
        access.request(2);
        assert_eq!(access.gate_id(), Some(2));
        assert_eq!(
            access.advance(0.2, response_ms, true),
            GateReplies::default()
        );
        assert_eq!(
            access.advance(2.0, response_ms, true),
            GateReplies {
                pending: true,
                granted: true
            }
        );
    }
}
