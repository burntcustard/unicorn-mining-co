use std::io;
use std::sync::Arc;

use crate::objects::saved_ship::SavedShip;
use crate::objects::ship::Ship;
use crate::objects::station::Station;
use crate::protocol::{Input, ProtocolError, ServerControl, Snapshot};
use crate::replication::snapshot_writer::SnapshotBatch;
use crate::simulation::game_object::ObjectProperties;
use crate::simulation::streaming::StreamingWorld;
use crate::simulation::world::{Entity, EntityKind, Player, World};
use crate::specs::Catalog;
use crate::utilities::vector::Vector;
use crate::websocket::WebSocket;

use super::{Account, AuthoritativeSession, send_control};

#[derive(Default)]
pub(super) struct Hangar {
    pub(super) no_ship: bool,
    stored: Vec<Entity>,
    pub(super) response: Option<&'static str>,
}

impl Hangar {
    pub(super) fn reconnect(&mut self) {
        self.response = (self.no_ship || !self.stored.is_empty()).then_some("");
    }

    pub(super) fn restore(
        &mut self,
        saved: &mut SavedShip,
        player: i64,
        world: &mut World,
    ) -> io::Result<()> {
        self.no_ship = saved.no_ship;
        self.stored.clear();
        for ship in saved.stored_ships.drain(..) {
            let ship = ship
                .restore(player, &world.catalog)
                .map_err(io::Error::other)?;
            world.ids.record_entity(ship.craft.object.id);
            self.stored
                .push(world.make_entity(EntityKind::Ship(Box::new(ship)), false));
        }
        self.reconnect();
        Ok(())
    }

    pub(super) fn capture(&self, ship: &Ship, catalog: &Catalog) -> SavedShip {
        let mut saved = SavedShip::capture(ship, catalog);
        saved.no_ship = self.no_ship;
        saved.stored_ships = self
            .stored
            .iter()
            .filter_map(ship_ref)
            .map(|ship| SavedShip::capture(ship, catalog))
            .collect();
        saved
    }

    fn owned<'a>(&'a self, current: &'a Entity) -> impl Iterator<Item = &'a Entity> {
        (!self.no_ship)
            .then_some(current)
            .into_iter()
            .chain(&self.stored)
    }
}

impl AuthoritativeSession {
    pub(super) fn update_stored_ships(&mut self, tick: u64, duration: f64) {
        for account in self.accounts.values_mut() {
            if account.socket.is_none()
                && account
                    .hidden
                    .as_ref()
                    .is_some_and(|entity| !entity.model.object().dead)
            {
                continue;
            }
            if !account.hangar.no_ship
                && let Some(entity) = &mut account.hidden
            {
                update_docked_ship(entity, tick, duration);
            }
            for entity in &mut account.hangar.stored {
                update_docked_ship(entity, tick, duration);
            }
        }
    }

    pub(super) fn hangar_action(&mut self, id: i64, command: &str, ship_id: i64, value: &str) {
        let Some(account) = self.accounts.get_mut(&id) else {
            return;
        };
        let sector = account.sector;
        self.sectors.update_ids(sector);
        let previous = account.ship_id;
        let outcome = apply(
            account,
            &mut self.sectors[sector].running.world,
            command,
            ship_id,
            value,
        );
        self.sectors.commit_ids(sector);
        account.hangar.response = Some(outcome.err().unwrap_or_default());
        if outcome.is_ok() && command != "LIST" {
            if account.ship_id != previous || account.hangar.no_ship {
                self.inputs.remove(&id);
            }
            account.delivery.require_load();
            self.mark_dirty(id, false);
        }
        self.send_snapshot(id);
    }
}

fn update_docked_ship(entity: &mut Entity, tick: u64, duration: f64) {
    if let Some(ship) = ship_mut(entity)
        && !ship.craft.object.dead
        && ship.craft.docked()
    {
        ship.update_power(duration);
        ship.update_boosters(duration);
        ship.craft
            .update_modules(duration, ship.systems_power, Some(tick));
    }
}

pub(super) fn apply(
    account: &mut Account,
    world: &mut World,
    command: &str,
    ship_id: i64,
    value: &str,
) -> Result<(), &'static str> {
    let current = world
        .entity(account.ship_id)
        .ok_or("Dock at a station to use the hangar.")?;
    let ship = ship_ref(current).ok_or("Dock at a station to use the hangar.")?;
    let station_id = ship
        .craft
        .docked_to
        .filter(|&id| id != 0 && ship.craft.launching == 0.0)
        .ok_or("Dock at a station to use the hangar.")?;
    let station = world
        .entity(station_id)
        .and_then(station_ref)
        .ok_or("Station unavailable.")?;
    if command == "LIST" {
        return Ok(());
    }
    if matches!(command, "BUY" | "SPECIAL") {
        let special = command == "SPECIAL";
        let assets = if special {
            account
                .hangar
                .owned(current)
                .filter_map(ship_ref)
                .map(|ship| ship.sale_price(&world.catalog))
                .sum()
        } else {
            0.0
        };
        let offer = station.hangar_purchase(value, special, account.credits, assets)?;
        let new_id = world.ids.entity();
        let ship = Ship::new_player(
            new_id,
            value,
            ObjectProperties {
                player_id: Some(account.id),
                ..Default::default()
            },
            &world.catalog,
            || world.ids.object(),
        )
        .ok_or("This station does not sell that ship.")?;
        let new = world.make_entity(EntityKind::Ship(Box::new(ship)), false);
        if offer.replace_owned_ships {
            account.hangar.stored.clear();
            account.hangar.no_ship = true;
        }
        account.credits -= offer.price;
        pilot(account, world, new);
        return Ok(());
    }

    let active = !account.hangar.no_ship && current.model.object().id == ship_id;
    let stored = account
        .hangar
        .stored
        .iter()
        .position(|entity| entity.model.object().id == ship_id);
    if !active && stored.is_none() {
        return Err("You do not own that ship.");
    }

    if command == "PILOT" {
        if let Some(index) = stored {
            let next = account.hangar.stored.remove(index);
            pilot(account, world, next);
        }
        return Ok(());
    }
    if command == "SELL" {
        if let Some(index) = stored {
            let sold = account.hangar.stored.remove(index);
            account.credits += ship_ref(&sold)
                .expect("stored ship")
                .sale_price(&world.catalog);
        } else {
            account.credits += ship.sale_price(&world.catalog);
            account.hangar.no_ship = true;
            if account.hangar.stored.is_empty() {
                let active = world
                    .entity_mut(ship_id)
                    .and_then(ship_mut)
                    .expect("active ship");
                for index in 0..active.craft.mounts.len() {
                    if active.craft.mounts[index].module.is_some() {
                        active.fit(index, None);
                    }
                }
                active.craft.cargo_contents.clear();
                active.fly(0.0, 0.0);
                clear_inputs(account);
            } else {
                let next = account.hangar.stored.remove(0);
                pilot(account, world, next);
            }
        }
        return Ok(());
    }

    let catalog = Arc::clone(&world.catalog);
    let (ship, station) = if let Some(index) = stored {
        (
            ship_mut(&mut account.hangar.stored[index]).expect("stored ship"),
            world
                .entity_mut(station_id)
                .and_then(station_mut)
                .expect("docked station"),
        )
    } else {
        let (ship, station) = world
            .entities
            .get_pair_mut(&ship_id, &station_id)
            .expect("active ship and station");
        (
            ship_mut(ship).expect("active ship"),
            station_mut(station).expect("docked station"),
        )
    };
    ship.craft.docked_to = Some(station_id);
    match command {
        "RENAME" => ship.rename_in_hangar(value),
        "REPAIR" => ship.repair_in_hangar(&mut account.credits, &catalog),
        "REFUEL" => ship.refuel_in_hangar(&mut account.credits, station, &catalog),
        "PAINT" => ship.paint_in_hangar(
            value,
            account.unlocked_paints,
            &mut account.credits,
            &catalog,
        ),
        _ => Err("Unknown hangar action."),
    }
}

fn pilot(account: &mut Account, world: &mut World, mut next: Entity) {
    let mut previous = world.remove_entity(account.ship_id).expect("active ship");
    let old = ship_mut(&mut previous).expect("active ship");
    let ship = ship_mut(&mut next).expect("replacement ship");
    old.craft.object.target_label.clear();
    ship.craft.object.target_label.clone_from(&account.name);
    ship.craft.object.position = old.craft.object.position;
    ship.craft.object.rotation = old.craft.object.rotation;
    ship.craft.object.velocity = Vector::ZERO;
    ship.craft.object.spin = 0.0;
    ship.craft.docked_to = old.craft.docked_to;
    ship.craft.launching = 0.0;
    ship.fly(0.0, 0.0);
    account.ship_id = ship.craft.object.id;
    account
        .definition
        .clone_from(&ship.craft.object.definition_id);
    account.position = ship.craft.object.position;
    if !account.hangar.no_ship {
        account.hangar.stored.push(previous);
    }
    account.hangar.no_ship = false;
    next.replication = None;
    world.wake(next);
    world.set_player(Player {
        id: account.id,
        ship_id: account.ship_id,
        observer_range: 0.0,
    });
    clear_inputs(account);
    account.respawn_pending = true;
    account.delivery.require_load();
}

fn clear_inputs(account: &mut Account) {
    account.inputs.discard_pending(Input::default());
    account.inputs.clear_input_lead();
}

pub(super) fn send(
    account: &Account,
    world: &World,
    socket: &WebSocket,
    error: &str,
) -> Result<(), ProtocolError> {
    let Some(current) = world.entity(account.ship_id).or(account.hidden.as_ref()) else {
        return Ok(());
    };
    let catalog = &world.catalog;
    let mut batch = SnapshotBatch::default();
    batch.begin();
    let mut ranges = Vec::new();
    for entity in account.hangar.owned(current) {
        let mut record = entity.model.prepare_full_record(catalog, &batch)?;
        if let Some(range) = batch.fragment(&mut record, None, &catalog.protocol)? {
            ranges.push(range);
        }
    }
    let fragments = ranges
        .into_iter()
        .map(|range| batch.bytes(range))
        .collect::<Vec<_>>();
    let offers = ship_ref(current)
        .filter(|ship| ship.craft.launching == 0.0)
        .and_then(|ship| ship.craft.docked_to)
        .and_then(|id| world.entity(id))
        .and_then(station_ref)
        .map_or(&[][..], |station| station.ships_for_sale.as_slice());
    send_control(
        socket,
        ServerControl::Hangar {
            ship_id: account.ship_id as u64,
            credits: account.credits,
            hangar_error: error,
            ships_for_sale: offers,
            hangar_ships: Snapshot {
                fragments: Some(&fragments),
                tick: world.tick,
                load: true,
                next_entity_id: world.ids.next_entity as u64,
                ..Default::default()
            },
        },
        catalog,
    );
    Ok(())
}

fn ship_ref(entity: &Entity) -> Option<&Ship> {
    match &entity.model {
        EntityKind::Ship(ship) => Some(ship),
        _ => None,
    }
}

fn ship_mut(entity: &mut Entity) -> Option<&mut Ship> {
    match &mut entity.model {
        EntityKind::Ship(ship) => Some(ship),
        _ => None,
    }
}

fn station_ref(entity: &Entity) -> Option<&Station> {
    match &entity.model {
        EntityKind::Station(station) => Some(station),
        _ => None,
    }
}

fn station_mut(entity: &mut Entity) -> Option<&mut Station> {
    match &mut entity.model {
        EntityKind::Station(station) => Some(station),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use crate::specs::ShipOffer;

    use super::*;

    #[cfg(feature = "test-fixtures")]
    #[test]
    fn docked_ships_recharge_until_the_disconnected_pilot_is_hidden() {
        use crate::game_server::{Client, ClientId, Session};
        use crate::protocol::Control;
        use crate::websocket::FixtureSocket;

        let catalog = Arc::new(Catalog::load().unwrap());
        let mut session = AuthoritativeSession::new(25.0, catalog).unwrap();
        let socket = FixtureSocket::new();
        let client = Client {
            id: ClientId(1),
            socket: socket.socket(),
        };
        session.receive(&client, Control::Prepare { player_token: None });
        let id = session.sockets[&client.id];
        let sector = session.sectors.start;
        let near = session.sectors[sector]
            .regions
            .nearest_station(Vector::ZERO)
            .unwrap();
        let station = session.sectors[sector].regions.id_offset + i64::from(near.id);
        session.sync_regions(sector, Some(near.position));
        let stored = session
            .spawn_ship(sector, id, "mustang", near.position, 0.0, Some(station))
            .unwrap();
        let mut stored = session.sectors[sector]
            .running
            .world
            .remove_entity(stored)
            .unwrap();
        ship_mut(&mut stored).unwrap().stored_power = 0.0;
        let account = session.accounts.get_mut(&id).unwrap();
        let ship = account.hidden.as_mut().and_then(ship_mut).unwrap();
        ship.craft.object.position = near.position;
        ship.craft.docked_to = Some(station);
        ship.stored_power = 0.0;
        account.hangar.stored.push(stored);
        let stored_power = |session: &AuthoritativeSession| {
            ship_ref(&session.accounts.get(&id).unwrap().hangar.stored[0])
                .unwrap()
                .stored_power
        };
        session.tick(1);
        let account = session.accounts.get(&id).unwrap();
        assert!(
            account
                .hidden
                .as_ref()
                .and_then(ship_ref)
                .unwrap()
                .stored_power
                > 0.0
        );
        let prepared_power = stored_power(&session);
        assert!(prepared_power > 0.0);

        session.receive(&client, Control::Play);
        session.disconnect(&client);
        session.tick(1);
        assert!(session.accounts.get(&id).unwrap().hidden.is_none());
        let grace_power = stored_power(&session);
        assert!(grace_power > prepared_power);

        let cooldown =
            std::time::Duration::from_secs_f64(session.catalog.simulation.flight.launch_duration);
        session.accounts.get_mut(&id).unwrap().disconnected_at = Some(Instant::now() - cooldown);
        session.tick(1);
        let account = session.accounts.get(&id).unwrap();
        let active_power = account
            .hidden
            .as_ref()
            .and_then(ship_ref)
            .unwrap()
            .stored_power;
        let hidden_power = stored_power(&session);
        assert!(hidden_power > grace_power);
        session.tick(1);
        let account = session.accounts.get(&id).unwrap();
        assert_eq!(
            account
                .hidden
                .as_ref()
                .and_then(ship_ref)
                .unwrap()
                .stored_power,
            active_power
        );
        assert_eq!(stored_power(&session), hidden_power);
    }

    #[test]
    fn stored_and_empty_hangars_keep_the_docked_berth_through_save() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let mut world = World::new(25.0, Arc::clone(&catalog));
        let station = Station::new(
            1,
            "corral-5",
            Default::default(),
            Some(vec![]),
            &catalog,
            || 0,
        );
        let mut station = station.unwrap();
        station.ships_for_sale = vec![ShipOffer {
            ship: "mustang".into(),
            price: 5.0,
        }];
        world.add_entity(EntityKind::Station(Box::new(station)), true);
        let starter = world
            .spawn_player_ship(7, "mustang", Default::default())
            .unwrap();
        world
            .entity_mut(starter)
            .and_then(ship_mut)
            .unwrap()
            .craft
            .docked_to = Some(1);
        let entity = world.remove_entity(starter).unwrap();
        let mut account = Account::new(7, 0, "token".into(), entity, Instant::now(), &catalog);
        world.wake(account.hidden.take().unwrap());
        account.credits = 20.0;

        apply(&mut account, &mut world, "BUY", 0, "mustang").unwrap();
        let purchased = account.ship_id;
        assert_ne!(purchased, starter);
        assert_eq!(account.credits, 15.0);
        apply(&mut account, &mut world, "RENAME", starter, "🦄 Finch").unwrap();
        account.credits = 10_000.0;
        let stored = account
            .hangar
            .stored
            .first_mut()
            .and_then(ship_mut)
            .unwrap();
        stored.fuel -= 20.0;
        let hull = stored
            .craft
            .hulls
            .iter_mut()
            .find(|hull| hull.plan.health.is_some())
            .unwrap();
        hull.health -= 12.0;
        let service_cost = stored.refuel_cost() + stored.repair_cost(None);
        apply(&mut account, &mut world, "REFUEL", starter, "").unwrap();
        apply(&mut account, &mut world, "REPAIR", starter, "").unwrap();
        apply(&mut account, &mut world, "PAINT", starter, "2").unwrap();
        assert_eq!(account.credits, 10_000.0 - service_cost);
        apply(&mut account, &mut world, "PILOT", starter, "").unwrap();
        assert_eq!(account.ship_id, starter);
        let active = world.entity(starter).and_then(ship_ref).unwrap();
        assert_eq!(active.fuel, active.fuel_capacity);
        assert_eq!(active.repair_cost(None), 0.0);
        assert_eq!(
            active.craft.object.shades.as_ref(),
            Some(&catalog.paint_colors[2])
        );
        assert_eq!(
            world.entity(starter).unwrap().model.object().name,
            "🦄 Finch"
        );
        assert_eq!(world.player(7).unwrap().ship_id, starter);
        let mut saved = account
            .hangar
            .capture(world.entity(starter).and_then(ship_ref).unwrap(), &catalog);
        let mut restored = Hangar::default();
        restored.restore(&mut saved, 7, &mut world).unwrap();
        assert_eq!(restored.stored.len(), 1);
        assert_eq!(restored.stored[0].model.object().id, purchased);

        apply(&mut account, &mut world, "SELL", starter, "").unwrap();
        assert_eq!(account.ship_id, purchased);
        apply(&mut account, &mut world, "SELL", purchased, "").unwrap();
        let berth = world.entity(purchased).and_then(ship_ref).unwrap();
        assert_eq!(berth.craft.docked_to, Some(1));
        assert!(
            berth
                .craft
                .mounts
                .iter()
                .all(|mount| mount.module.is_none())
        );
        assert!(account.hangar.no_ship);
        let mut saved = account.hangar.capture(berth, &catalog);
        restored.restore(&mut saved, 7, &mut world).unwrap();
        assert!(restored.no_ship);
        apply(&mut account, &mut world, "BUY", 0, "mustang").unwrap();
        assert!(!account.hangar.no_ship);
        assert_ne!(account.ship_id, purchased);
    }
}
