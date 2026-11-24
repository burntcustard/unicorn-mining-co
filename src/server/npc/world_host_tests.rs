use super::*;
use crate::simulation::update_world::WorldStepOptions;

struct Fixture {
    running: RunningWorld,
    regions: StreamingRegions<Entity>,
    players: Vec<NpcPlayer>,
    next_observer_id: i64,
    inputs: HashMap<i64, InputFrame>,
}

impl Fixture {
    fn new(catalog: Arc<Catalog>) -> Self {
        let mut regions = StreamingRegions::new(402, &catalog, None);
        regions.id_offset = 1_i64 << 34;
        Self {
            running: RunningWorld::new(402.0, catalog),
            regions,
            players: Vec::new(),
            next_observer_id: 1,
            inputs: HashMap::new(),
        }
    }

    fn new_player(&mut self, position: Vector) -> i64 {
        let observer_id = self.next_observer_id;
        self.next_observer_id += 1;
        let ship_id = self
            .running
            .world
            .spawn_player_ship(
                observer_id,
                "mustang",
                ObjectProperties {
                    position,
                    ..ObjectProperties::default()
                },
            )
            .unwrap();
        self.players.push(NpcPlayer {
            account: "local-user".to_owned(),
            display_name: "Prospector".to_owned(),
            observer_id,
            ship_id,
            ship_dead: false,
            connected: true,
            encounter_after: 0,
            in_sector: true,
        });
        ship_id
    }

    fn context(&mut self) -> NpcWorld<'_> {
        NpcWorld {
            running: &mut self.running,
            regions: &mut self.regions,
            players: &mut self.players,
            next_observer_id: &mut self.next_observer_id,
            inputs: &mut self.inputs,
        }
    }

    fn ship(&self, id: i64) -> &Ship {
        self.running.world.entity(id).and_then(as_ship).unwrap()
    }

    fn ship_mut(&mut self, id: i64) -> &mut Ship {
        let EntityKind::Ship(ship) = &mut self.running.world.entity_mut(id).unwrap().model else {
            panic!("entity was not a ship")
        };
        ship
    }
}

#[test]
fn pirates_launch_from_generated_stations_and_demand_cargo_privately() {
    let catalog = Arc::new(Catalog::load().unwrap());
    let mut fixture = Fixture::new(Arc::clone(&catalog));
    let home = fixture.regions.nearest_station(Vector::ZERO).unwrap();
    let position = home.position + Vector::new(1000.0, 0.0);
    let victim = fixture.new_player(position);
    let id = fixture.running.world.ids.entity();
    let mut cargo = Item::new(id, "diamond", ObjectProperties::default(), &catalog).unwrap();
    cargo.object.mined = true;
    cargo.object.price = catalog.pirate_spec.cargo_value_threshold + 1.0;
    fixture
        .ship_mut(victim)
        .craft
        .cargo_contents
        .push(CargoObject::Item(Box::new(cargo)));

    let mut npcs = SectorNpcs::new(fixture.running.world.tick, &catalog);
    npcs.dispatch(fixture.context());
    let pirate = npcs.pirates.ship_ids().next().unwrap();
    let observer = fixture.ship(pirate).craft.object.player_number.unwrap();
    assert_eq!(
        fixture
            .running
            .world
            .player(observer)
            .unwrap()
            .observer_range,
        SIGHT_RANGE
    );
    assert_eq!(fixture.ship(pirate).craft.object.position, home.position);
    assert_eq!(
        fixture.ship(pirate).craft.launching,
        catalog.simulation.flight.launch_duration
    );
    assert!(fixture.ship(pirate).craft.object.hostile);
    assert!(
        matches!(fixture.ship(pirate).craft.cargo_contents.as_slice(), [CargoObject::Item(ammo)] if ammo.rounds.is_some())
    );

    let craft = &mut fixture.ship_mut(pirate).craft;
    craft.object.position = position + Vector::new(100.0, 0.0);
    craft.launching = 0.0;
    npcs.update(fixture.context());
    assert_eq!(fixture.ship(pirate).npc_state, "Waiting");
    assert!(fixture.inputs.contains_key(&observer));
    let messages = npcs.drain_messages().collect::<Vec<_>>();
    assert!(
        messages
            .iter()
            .any(|message| message.recipient.is_none() && message.role == "hostile")
    );
    assert!(
        messages
            .iter()
            .any(|message| message.recipient.as_deref() == Some("local-user")
                && message.cargo_demand == Some(pirate))
    );
    fixture.ship_mut(pirate).craft.object.dead = true;
    fixture.running.world.destroy_entity(pirate);
    for ship in fixture.running.world.take_destroyed_ships() {
        npcs.remember_destroyed_ship(&ship);
    }
    npcs.update(fixture.context());
    assert!(fixture.running.world.player(observer).is_none());
    assert!(!fixture.inputs.contains_key(&observer));
    let messages = npcs.drain_messages().collect::<Vec<_>>();
    assert!(
        messages
            .iter()
            .any(|message| catalog.pirate_dialog.destroyed.contains(&message.text))
    );
    assert!(
        messages
            .iter()
            .any(|message| message.recipient.as_deref() == Some("local-user")
                && message.cargo_demand == Some(0))
    );
    assert!(fixture.players[0].encounter_after > fixture.running.world.tick);
}

#[test]
fn collectors_consume_normal_held_launch_controls() {
    let catalog = Arc::new(Catalog::load().unwrap());
    let mut fixture = Fixture::new(Arc::clone(&catalog));
    let home = fixture.regions.nearest_station(Vector::ZERO).unwrap();
    let home_id = fixture.regions.id_offset + i64::from(home.id);
    let target_position = home.position + Vector::new(700.0, 0.0);
    let id = fixture.running.world.ids.entity();
    let item = Item::new(
        id,
        "gold",
        ObjectProperties {
            position: target_position,
            ..ObjectProperties::default()
        },
        &catalog,
    )
    .unwrap();
    let trip = vec![PickupItem::from(&item.object)];
    fixture
        .running
        .world
        .add_entity(EntityKind::Item(Box::new(item)), false);

    let mut npcs = SectorNpcs::new(fixture.running.world.tick, &catalog);
    npcs.collector_dispatch.restore(vec![StationDispatch {
        home: home.clone(),
        home_id,
        check_at: u64::MAX,
        queue: [trip].into(),
        ..StationDispatch::default()
    }]);
    npcs.dispatch(fixture.context());
    npcs.update(fixture.context());
    let collector = &npcs.collectors[0];
    let ship = collector.ship_id;
    let observer = collector.observer_id;
    let inputs = &fixture.inputs;
    assert_eq!(inputs[&observer].input.thrust, 1.0);
    assert!(inputs[&observer].input.cargo_hatch);
    assert_eq!(fixture.ship(ship).npc_state, "Collecting");
    assert!(
        npcs.drain_messages()
            .any(|message| message.role == "friendly")
    );
    fixture.running.update(
        WorldStepOptions {
            inputs: Some(inputs),
            ..WorldStepOptions::default()
        },
        &mut Vec::new(),
    );
    assert!(fixture.ship(ship).craft.module_active("cargoHatch"));
    assert_ne!(fixture.ship(ship).craft.object.position, home.position);
}

#[test]
fn marauders_restore_their_ships_and_take_unique_observer_ids() {
    let catalog = Arc::new(Catalog::load().unwrap());
    let mut fixture = Fixture::new(Arc::clone(&catalog));
    let position = Vector::new(1.2 * catalog.marauder_spec.minimum_distance, 0.0);
    fixture.new_player(position);
    let mut npcs = SectorNpcs::new(0, &catalog);
    let interval =
        (catalog.marauder_spec.check_interval / catalog.simulation.simulation_step) as u64;
    fixture.running.world.tick = interval;
    npcs.dispatch(fixture.context());
    assert_eq!(npcs.marauders.ship_ids().count(), 0);
    fixture.running.world.tick = 2 * interval;
    npcs.dispatch(fixture.context());
    npcs.update(fixture.context());
    let id = npcs.marauders.ship_ids().next().unwrap();
    let ship = fixture.ship(id);
    let old_observer = ship.craft.object.player_number.unwrap();
    assert!(ship.craft.object.hostile);
    assert!(ship.craft.suppress_drops);
    assert_eq!(ship.craft.cargo_contents.len(), 2);
    assert!(fixture.inputs[&old_observer].input.flight_mode);

    let mut saved = SectorState::default();
    npcs.capture(fixture.context(), &mut saved).unwrap();
    assert_eq!(saved.npcs.len(), 1);
    let encoded = serde_json::to_vec(&saved).unwrap();
    let saved = serde_json::from_slice(&encoded).unwrap();

    let mut restored = Fixture::new(Arc::clone(&catalog));
    restored.new_player(position);
    restored.next_observer_id = 120;
    restored.running.world.tick = fixture.running.world.tick;
    let mut npcs = SectorNpcs::new(restored.running.world.tick, &catalog);
    npcs.restore(restored.context(), &saved).unwrap();
    assert_eq!(npcs.marauders.ship_ids().next(), Some(id));
    assert_eq!(restored.next_observer_id, 121);
    let restored_ship = restored.ship(id);
    assert_eq!(restored_ship.craft.object.player_number, Some(120));
    assert_eq!(restored_ship.npc_state, "Pursuing");
    assert_eq!(
        restored_ship.craft.object.position,
        fixture.ship(id).craft.object.position
    );
    assert!(restored_ship.craft.suppress_drops);
    assert!(restored.running.world.ids.next_entity > id);
    npcs.update(restored.context());
    assert!(restored.inputs[&120].input.flight_mode);
}
