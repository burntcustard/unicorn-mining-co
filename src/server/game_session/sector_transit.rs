//! Sector-local portal phases and paired endpoint transfer.

use std::collections::HashSet;

use crate::objects::portal::{Portal, PortalOptions};
use crate::objects::ship::Ship;
use crate::protocol::ServerControl;
use crate::simulation::local_movement::LocalMovement;
use crate::simulation::sector_generation::{SectorConnectionSite, SectorMap};
use crate::simulation::world::{EntityKind, World};
use crate::specs::{Catalog, Portal as PortalRules};
use crate::utilities::round_ties_up;
use crate::utilities::vector::Vector;

use super::{GateAccess, GateReplies};

const DEPARTURE_COMPLETE: f64 = -1e-6;

#[derive(Clone, Copy, Debug)]
pub struct PortalPlayer<'a> {
    pub player_number: i64,
    pub ship_id: i64,
    pub travelled_tick: Option<u64>,
    pub display_name: &'a str,
    pub hidden_position: Option<Vector>,
}

#[derive(Clone, Copy)]
struct PlayerSweep {
    player_number: i64,
    ship_id: i64,
    from: Vector,
    travelled_tick: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PortalEndpoint {
    pub id: i64,
    pub destination_sector: String,
    pub destination_name: String,
    pub connection_id: String,
    pub jump_gate: bool,
    pub connected: Option<i64>,
}

impl From<&Portal> for PortalEndpoint {
    fn from(portal: &Portal) -> Self {
        Self {
            id: portal.object.id,
            destination_sector: portal.destination_sector.clone(),
            destination_name: portal.destination_name.clone(),
            connection_id: portal.connection_id.clone(),
            jump_gate: portal.gate.is_some(),
            connected: portal.connected,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TransitAction {
    /// Connect both gates and request that the exit start moving before arrival.
    OpenDestination(PortalEndpoint),
    /// Load the other sector, resolve the paired portal, and relocate this ship.
    Arrive {
        player_number: i64,
        ship_id: i64,
        player_name: String,
        departure: PortalEndpoint,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GateNoticeKind {
    Closing,
    ClosingInterrupted,
    Recovery { player_name: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GateNotice {
    pub gate_id: i64,
    pub kind: GateNoticeKind,
}

impl GateNotice {
    /// Choose a single variant before broadcasting this sector notice.
    pub fn text(&self, catalog: &Catalog, choose: impl FnOnce(usize) -> usize) -> String {
        let dialog = &catalog.jump_gate_dialog;
        match &self.kind {
            GateNoticeKind::Closing => choose_dialog(&dialog.closing, choose).to_owned(),
            GateNoticeKind::ClosingInterrupted => {
                choose_dialog(&dialog.closing_interrupted, choose).to_owned()
            }
            GateNoticeKind::Recovery { player_name } => {
                choose_dialog(&dialog.recovery, choose).replace("{player}", player_name)
            }
        }
    }

    pub fn control<'a>(&self, gate: &'a Portal, text: &'a str) -> ServerControl<'a> {
        gate_chat(gate, text)
    }
}

#[derive(Default)]
pub struct PortalEffects {
    pub notices: Vec<GateNotice>,
    pub travel: Vec<TransitAction>,
}

/// Keep one instance with each running sector. Gate effects are drained at the
/// phase that produced them, so destination requests run before local movement.
#[derive(Default)]
pub struct PortalTraffic {
    portal_epoch: Option<u64>,
    portals: Vec<i64>,
    gate_positions: Vec<Vector>,
    closing: HashSet<i64>,
    before: Vec<PlayerSweep>,
}

impl PortalTraffic {
    fn refresh_portals(&mut self, world: &World) {
        let epoch = world.portal_epoch();
        if self.portal_epoch == Some(epoch) {
            return;
        }
        self.portal_epoch = Some(epoch);
        self.portals.clear();
        self.portals.extend(world.portal_ids());
    }

    /// Run once for every instantiated sector before any sector advances physics.
    pub fn update_gates<'a>(
        &mut self,
        world: &mut World,
        players: impl IntoIterator<Item = PortalPlayer<'a>>,
        dt: f64,
        effects: &mut PortalEffects,
    ) {
        self.refresh_portals(world);
        let now = world_seconds(world);
        let mut players = Some(players);
        for &gate_id in &self.portals {
            let Some(gate) = portal(world, gate_id).filter(|gate| gate.gate.is_some()) else {
                continue;
            };
            if !gate.needs_occupancy(now) {
                if gate.connected.is_some() {
                    portal_mut(world, gate_id)
                        .expect("gate remains in the sector")
                        .advance(dt);
                }
                continue;
            }
            if let Some(players) = players.take() {
                self.gate_positions.clear();
                self.gate_positions
                    .extend(players.into_iter().filter_map(|player| {
                        world.player(player.player_number)?;
                        ship(world, player.ship_id)
                            .map(|ship| ship.craft.object.position)
                            .or(player.hidden_position)
                    }));
            }
            let position = gate.object.position;
            let radius = gate.object.radius;
            let occupied = self
                .gate_positions
                .iter()
                .any(|ship| ship.distance_squared(position) < radius * radius);
            let gate = portal_mut(world, gate_id).expect("gate remains in the sector");
            if occupied && gate.opening_target == 1.0 {
                gate.request_opening(1.0);
            }
            if !occupied && now >= gate.close_after {
                gate.request_opening(0.0);
            }
            // An unconnected gate advances on its normal simulation update.
            if gate.connected.is_some() {
                gate.advance(dt);
            }
        }
        self.collect_closing_starts(world, effects);
    }

    /// Capture player sweeps and request smooth recovery before advancing the world.
    pub fn prepare<'a>(
        &mut self,
        world: &mut World,
        players: impl IntoIterator<Item = PortalPlayer<'a>>,
        effects: &mut PortalEffects,
    ) {
        self.refresh_portals(world);
        self.before.clear();
        for player in players {
            if world.player(player.player_number).is_none() {
                continue;
            }
            let Some(ship) = ship(world, player.ship_id) else {
                continue;
            };
            let craft = &ship.craft;
            let from = craft.object.position;
            self.before.push(PlayerSweep {
                player_number: player.player_number,
                ship_id: player.ship_id,
                from,
                travelled_tick: player.travelled_tick,
            });
            if craft.object.dead || craft.docked_to.is_some() {
                continue;
            }
            let (transit_gate, transit_time) = (craft.transit_gate, craft.transit_time);
            for &gate_id in &self.portals {
                let Some(gate) = portal(world, gate_id).filter(|gate| gate.gate.is_some()) else {
                    continue;
                };
                if transit_gate == Some(gate_id) && transit_time != 0.0 {
                    if transit_time < 0.0 {
                        effects
                            .travel
                            .push(TransitAction::OpenDestination(PortalEndpoint::from(gate)));
                    } else {
                        portal_mut(world, gate_id)
                            .expect("gate remains in the sector")
                            .request_exit_opening();
                    }
                } else if gate.opening == 0.0
                    && gate.opening_target == 0.0
                    && gate.contains_interior(from)
                {
                    portal_mut(world, gate_id)
                        .expect("gate remains in the sector")
                        .request_exit_opening();
                    effects.notices.push(GateNotice {
                        gate_id,
                        kind: GateNoticeKind::Recovery {
                            player_name: player.display_name.to_owned(),
                        },
                    });
                }
            }
        }
    }

    /// Run after world movement. Test beams before starting any new transit.
    pub fn finish<'a>(
        &mut self,
        world: &mut World,
        player_name: impl Fn(i64) -> &'a str,
        effects: &mut PortalEffects,
    ) {
        self.refresh_portals(world);
        self.collect_closing_starts(world, effects);
        self.interrupt_closing(world, effects);
        self.cross_portals(world, player_name, effects);
    }

    fn collect_closing_starts(&mut self, world: &mut World, effects: &mut PortalEffects) {
        for &gate_id in &self.portals {
            if portal_mut(world, gate_id).is_some_and(Portal::take_closing_start) {
                self.closing.insert(gate_id);
                effects.notices.push(GateNotice {
                    gate_id,
                    kind: GateNoticeKind::Closing,
                });
            }
        }
    }

    fn interrupt_closing(&mut self, world: &mut World, effects: &mut PortalEffects) {
        let now = world_seconds(world);
        for &gate_id in &self.portals {
            let Some(gate) = portal(world, gate_id) else {
                continue;
            };
            let Some(rules) = &gate.gate else { continue };
            let closing = gate.opening_target == 0.0
                && (gate.opening > 0.0 || self.closing.contains(&gate_id));
            let reopening =
                gate.opening_target == 1.0 && gate.opening < 1.0 && gate.blocked_beams != 0;
            if !closing && !reopening {
                self.closing.remove(&gate_id);
                continue;
            }
            let mut blocked = 0;
            for sweep in &self.before {
                let Some(ship) = ship(world, sweep.ship_id) else {
                    continue;
                };
                let craft = &ship.craft;
                if craft.object.dead || craft.docked_to.is_some() || craft.transit_time != 0.0 {
                    continue;
                }
                blocked |=
                    gate.crossed_beams(sweep.from, craft.object.position, craft.object.radius);
            }
            if blocked != 0 {
                let opening_time = rules.opening_duration / 1000.0;
                let gate = portal_mut(world, gate_id).expect("gate remains in the sector");
                if reopening {
                    gate.blocked_beams |= blocked;
                } else {
                    gate.interrupt_closing(blocked);
                    gate.close_after = gate.close_after.max(now + opening_time);
                    self.closing.remove(&gate_id);
                    effects.notices.push(GateNotice {
                        gate_id,
                        kind: GateNoticeKind::ClosingInterrupted,
                    });
                }
            } else if gate.opening == 0.0 {
                self.closing.remove(&gate_id);
            }
        }
    }

    fn cross_portals<'a>(
        &self,
        world: &mut World,
        player_name: impl Fn(i64) -> &'a str,
        effects: &mut PortalEffects,
    ) {
        let portal_rules = &world.catalog.portal_spec;
        let departure_time =
            -(portal_rules.pull_duration + portal_rules.transit_scale_duration) / 1000.0;
        for sweep in &self.before {
            let Some(ship) = ship(world, sweep.ship_id) else {
                continue;
            };
            let craft = &ship.craft;
            if craft.object.dead
                || craft.docked_to.is_some()
                || craft.launching != 0.0
                || sweep.travelled_tick == Some(world.tick)
                || craft.transit_time > 0.0
            {
                continue;
            }
            if craft.transit_time < 0.0 {
                if craft.transit_time >= DEPARTURE_COMPLETE
                    && let Some(gate) = craft.transit_gate.and_then(|id| portal(world, id))
                {
                    let player_name = player_name(sweep.player_number);
                    effects.travel.push(TransitAction::Arrive {
                        player_number: sweep.player_number,
                        ship_id: sweep.ship_id,
                        departure: gate.into(),
                        player_name: if player_name.is_empty() {
                            "pilot"
                        } else {
                            player_name
                        }
                        .to_owned(),
                    });
                }
                continue;
            }
            let position = craft.object.position;
            // Leave the arrival trigger before accepting another crossing.
            if let Some(gate_id) = craft.transit_gate {
                if portal(world, gate_id).is_some_and(|gate| {
                    position.distance_squared(gate.object.position)
                        <= gate.travel_radius * gate.travel_radius
                }) {
                    continue;
                }
                ship_mut(world, sweep.ship_id)
                    .expect("traveler remains in the sector")
                    .craft
                    .transit_gate = None;
                continue;
            }
            for &gate_id in &self.portals {
                let Some(portal) =
                    portal(world, gate_id).filter(|portal| portal.crossed(sweep.from, position))
                else {
                    continue;
                };
                let endpoint = portal.gate.as_ref().map(|_| PortalEndpoint::from(portal));
                let center = portal.object.position;
                let radius = portal.travel_radius;
                let ship = ship_mut(world, sweep.ship_id).expect("traveler remains in the sector");
                if (position - center).length() > radius {
                    ship.craft.object.position =
                        center.add_scaled((sweep.from - center).normalized(), radius);
                }
                ship.craft.transit_gate = Some(gate_id);
                if let Some(endpoint) = endpoint {
                    effects
                        .travel
                        .push(TransitAction::OpenDestination(endpoint));
                }
                ship.craft.transit_time = departure_time;
                ship.craft.object.velocity = Vector::ZERO;
                ship.craft.object.spin = 0.0;
                ship.firing = false;
                ship.fly(0.0, 0.0);
                break;
            }
        }
    }
}

pub fn portal(world: &World, id: i64) -> Option<&Portal> {
    match &world.entity(id)?.model {
        EntityKind::Portal(portal) => Some(portal),
        _ => None,
    }
}

pub fn portal_mut(world: &mut World, id: i64) -> Option<&mut Portal> {
    match &mut world.entity_mut(id)?.model {
        EntityKind::Portal(portal) => Some(portal),
        _ => None,
    }
}

fn ship(world: &World, id: i64) -> Option<&Ship> {
    match &world.entity(id)?.model {
        EntityKind::Ship(ship) => Some(ship),
        _ => None,
    }
}

fn ship_mut(world: &mut World, id: i64) -> Option<&mut Ship> {
    match &mut world.entity_mut(id)?.model {
        EntityKind::Ship(ship) => Some(ship),
        _ => None,
    }
}

fn world_seconds(world: &World) -> f64 {
    world.tick as f64 * world.catalog.simulation.simulation_step
}

/// Match kind and connection ID when the other sector is first activated.
pub fn find_destination(world: &World, departure: &PortalEndpoint) -> Option<i64> {
    let is_pair = |portal: &Portal| {
        portal.gate.is_some() == departure.jump_gate
            && portal.connection_id == departure.connection_id
    };
    if let Some(id) = departure.connected
        && portal(world, id).is_some_and(is_pair)
    {
        return Some(id);
    }
    world.entities().find_map(|entity| match &entity.model {
        EntityKind::Portal(portal) if is_pair(portal) => Some(portal.object.id),
        _ => None,
    })
}

pub fn connect_portals(
    source: &mut World,
    departure: &PortalEndpoint,
    destination: &mut World,
) -> Option<i64> {
    let id = find_destination(destination, departure)?;
    let entrance = portal_mut(source, departure.id)?;
    let exit = portal_mut(destination, id)?;
    entrance.connect(exit);
    Some(id)
}

pub fn request_destination_opening(
    source: &mut World,
    departure: &PortalEndpoint,
    destination: &mut World,
) -> Option<i64> {
    let id = connect_portals(source, departure, destination)?;
    let now = world_seconds(source);
    let rules = &source.catalog.portal_spec;
    let exit = portal_mut(destination, id)?;
    if let Some(gate) = &exit.gate {
        let delay =
            (rules.pull_duration + rules.transit_scale_duration + gate.opening_duration) / 1000.0;
        exit.request_exit_opening();
        exit.close_after = exit.close_after.max(now + delay);
    }
    Some(id)
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SectorArrival {
    pub position: Vector,
    pub velocity: Vector,
    pub portal: Option<i64>,
}

impl SectorArrival {
    pub fn from_portal(portal: &Portal) -> Self {
        Self {
            position: portal.object.position,
            velocity: Vector::ZERO,
            portal: Some(portal.object.id),
        }
    }
}

pub fn apply_arrival(ship: &mut Ship, arrival: SectorArrival, rules: &PortalRules) {
    let craft = &mut ship.craft;
    craft.object.position = arrival.position;
    craft.object.velocity = arrival.velocity;
    craft.object.spin = 0.0;
    craft.object.pending_update_time = 0.0;
    craft.object.local_movement = LocalMovement::default();
    craft.transit_gate = arrival.portal;
    craft.transit_time = if arrival.portal.is_some() {
        (rules.transit_scale_duration + rules.arrival_hold_duration) / 1000.0
    } else {
        0.0
    };
    if arrival.portal.is_some() {
        ship.fly(0.0, 0.0);
    }
}

/// Transfer the original entity and observer while recreating sector-local caches.
/// The caller clears per-connection input/snapshot history and sends the new load.
pub fn transfer_player(
    source: &mut World,
    destination: &mut World,
    player_number: i64,
    ship_id: i64,
    arrival: SectorArrival,
) -> bool {
    if !source
        .player(player_number)
        .is_some_and(|player| player.ship_id == ship_id)
        || ship(source, ship_id).is_none()
        || destination.player(player_number).is_some()
        || destination.entity(ship_id).is_some()
    {
        return false;
    }
    let entity = source
        .remove_entity(ship_id)
        .expect("validated traveling ship exists");
    let player = source
        .remove_player(player_number)
        .expect("validated traveling player exists");
    let EntityKind::Ship(mut ship) = entity.model else {
        unreachable!("validated entity is a ship")
    };
    apply_arrival(&mut ship, arrival, &destination.catalog.portal_spec);
    destination.add_entity(EntityKind::Ship(ship), entity.generated);
    destination.set_player(player);
    true
}

pub fn relocate_local_player(
    world: &mut World,
    player_number: i64,
    ship_id: i64,
    arrival: SectorArrival,
) -> bool {
    if !world
        .player(player_number)
        .is_some_and(|player| player.ship_id == ship_id)
        || ship(world, ship_id).is_none()
    {
        return false;
    }
    let entity = world
        .remove_entity(ship_id)
        .expect("validated traveling ship exists");
    let player = world
        .remove_player(player_number)
        .expect("validated traveling player exists");
    let EntityKind::Ship(mut ship) = entity.model else {
        unreachable!("validated entity is a ship")
    };
    apply_arrival(&mut ship, arrival, &world.catalog.portal_spec);
    world.add_entity(EntityKind::Ship(ship), entity.generated);
    world.set_player(player);
    true
}

pub fn arrival_text(
    catalog: &Catalog,
    departure: &PortalEndpoint,
    player_name: &str,
    choose: impl FnOnce(usize) -> usize,
) -> String {
    // Render in one pass so authored placeholders in a display name remain literal.
    replace_dialog(
        choose_dialog(&catalog.jump_gate_dialog.arrival, choose),
        &[
            ("{destination}", &departure.destination_name),
            ("{player}", player_name),
        ],
    )
}

pub fn gate_chat<'a>(gate: &'a Portal, text: &'a str) -> ServerControl<'a> {
    ServerControl::Chat {
        channel: 0,
        sender: &gate.object.name,
        sender_role: "friendly",
        text,
        cargo_demand: None,
    }
}

fn choose_dialog(lines: &[String], choose: impl FnOnce(usize) -> usize) -> &str {
    if lines.is_empty() {
        ""
    } else {
        &lines[choose(lines.len())]
    }
}

fn replace_dialog(mut input: &str, replacements: &[(&str, &str)]) -> String {
    let mut result = String::new();
    while let Some((index, pattern, replacement)) = replacements
        .iter()
        .filter_map(|&(pattern, replacement)| {
            input
                .find(pattern)
                .map(|index| (index, pattern, replacement))
        })
        .min_by_key(|&(index, _, _)| index)
    {
        result.push_str(&input[..index]);
        result.push_str(replacement);
        input = &input[index + pattern.len()..];
    }
    result.push_str(input);
    result
}

pub fn eligible_gate_access(world: &World, ship_id: i64, gate_id: i64) -> bool {
    let Some(ship) = ship(world, ship_id) else {
        return false;
    };
    let Some(gate) = portal(world, gate_id) else {
        return false;
    };
    !ship.craft.object.dead
        && ship.craft.docked_to.is_none()
        && gate.gate.as_ref().is_some_and(|rules| {
            ship.craft
                .object
                .position
                .distance_squared(gate.object.position)
                <= rules.approach_radius * rules.approach_radius
        })
}

/// Reply privately, and connect the returned endpoint when the request is granted.
pub fn advance_gate_access(
    world: &mut World,
    access: &mut GateAccess,
    ship_id: i64,
    connected: bool,
    dt: f64,
) -> (GateReplies, Option<PortalEndpoint>) {
    let Some(gate_id) = access.gate_id() else {
        return (GateReplies::default(), None);
    };
    let eligible = connected && eligible_gate_access(world, ship_id, gate_id);
    let delay = portal(world, gate_id)
        .and_then(|portal| portal.gate.as_ref())
        .map_or(0.0, |rules| rules.access_response_delay);
    let reply = access.advance(dt, delay, eligible);
    let granted = if reply.granted {
        let now = world_seconds(world);
        let gate = portal_mut(world, gate_id).expect("access was granted for a live gate");
        gate.request_opening(1.0);
        gate.close_after = now
            + gate
                .gate
                .as_ref()
                .expect("access is restricted to jump gates")
                .opening_duration
                / 1000.0;
        Some(PortalEndpoint::from(&*gate))
    } else {
        None
    };
    (reply, granted)
}

/// Generated entity IDs keep the original sector offset and portal insertion order.
pub fn sector_id_offset(map: &SectorMap, sector: &str, starting_sector: &str) -> Option<i64> {
    let index = map
        .sectors
        .iter()
        .position(|candidate| candidate.id == sector)?;
    Some(if sector == starting_sector {
        0
    } else {
        ((index as i64) + 1) << 40
    })
}

pub struct SectorPortals {
    pub id_offset: i64,
    pub portals: Vec<Portal>,
    pub gate_sites: Vec<SectorConnectionSite>,
}

pub fn build_sector_portals(
    map: &SectorMap,
    sector_id: &str,
    catalog: &Catalog,
) -> Option<SectorPortals> {
    let sector = map.sectors.iter().find(|sector| sector.id == sector_id)?;
    let id_offset = sector_id_offset(map, sector_id, &catalog.starting_sector_id)?;
    let mut portals = Vec::new();
    let mut gate_sites = Vec::new();
    for (wormhole, links) in [(false, &map.links), (true, &map.wormhole_links)] {
        for link in links {
            let Some(end) = link.sectors.iter().position(|id| id == sector_id) else {
                continue;
            };
            let destination_id = &link.sectors[1 - end];
            if !map.enabled.contains(destination_id) {
                continue;
            }
            let destination = map
                .sectors
                .iter()
                .find(|sector| &sector.id == destination_id)?;
            let sites = if wormhole {
                &sector.wormhole_sites
            } else {
                &sector.gate_sites
            };
            let site = sites.get(link.sites[end])?;
            let mut portal = Portal::new(
                PortalOptions {
                    id: id_offset + (1 << 32) + portals.len() as i64,
                    position: site.position,
                    destination_sector: destination.id.clone(),
                    destination_name: destination.name.clone(),
                    wormhole,
                },
                catalog,
            );
            portal.connection_id.clone_from(&link.id);
            if !wormhole {
                gate_sites.push(site.clone());
                portal.target_label = format!(
                    "JUMP GATE\n{}\u{2009}→\u{2009}{}",
                    sector.name, destination.name
                );
                let first = sector.name.chars().next().unwrap_or_default();
                let second = destination.name.chars().next().unwrap_or_default();
                let x = round_ties_up(site.position.x).abs() as i64 % 10;
                let y = round_ties_up(site.position.y).abs() as i64 % 10;
                portal.object.name = format!("{first}{second}-{x}{y}");
                portal.object.rotation = link.rotation;
            }
            portals.push(portal);
        }
    }
    Some(SectorPortals {
        id_offset,
        portals,
        gate_sites,
    })
}

#[cfg(test)]
#[path = "sector_transit_tests.rs"]
mod tests;
