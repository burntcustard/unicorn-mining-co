use std::collections::HashMap;

use super::*;
use crate::npc::flight::FlightContext;

struct Host<'a> {
    tick: u64,
    catalog: &'a Catalog,
    player: Player,
    pirate: Option<ShipView>,
    speech: Vec<(u64, String)>,
    demands: Vec<(String, bool)>,
    input: Input,
}

impl PirateEnvironment for Host<'_> {
    fn tick(&self) -> u64 {
        self.tick
    }
    fn players(&self) -> impl Iterator<Item = Player> {
        std::iter::once(self.player.clone())
    }
    fn player(&self, account: &str) -> Option<Player> {
        (self.player.account == account).then(|| self.player.clone())
    }
    fn all_player_identities(&self) -> impl Iterator<Item = (String, i64)> {
        std::iter::once((self.player.account.clone(), self.player.observer_id))
    }
    fn observer_ship(&self, observer: i64) -> Option<ShipView> {
        if self.player.observer_id == observer {
            Some(self.player.ship.clone())
        } else {
            self.pirate
                .as_ref()
                .filter(|pirate| pirate.observer_id == observer)
                .cloned()
        }
    }
    fn ship(&self, id: i64) -> Option<ShipView> {
        if self.player.ship.id == id {
            Some(self.player.ship.clone())
        } else {
            self.pirate
                .as_ref()
                .filter(|pirate| pirate.id == id)
                .cloned()
        }
    }
    fn loot(&self, _id: i64) -> Option<LootView> {
        None
    }
    fn can_see(&self, ship: i64, target: i64) -> bool {
        let (Some(a), Some(b)) = (self.ship(ship), self.ship(target)) else {
            return false;
        };
        a.id != b.id
            && b.available()
            && a.motion.position.distance_squared(b.motion.position) <= 1500.0 * 1500.0
    }
    fn nearest_station(&mut self, _position: Vector) -> Option<StationDescription> {
        Some(StationDescription {
            definition_id: "corral-5".into(),
            ..StationDescription::default()
        })
    }
    fn set_cooldown(&mut self, _account: &str, tick: u64) {
        self.player.encounter_after = tick;
    }
    fn spawn(&mut self, _request: SpawnRequest<'_>) -> Option<SpawnedPirate> {
        self.pirate = Some(ship(2, -2, Vector::new(-250.0, 0.0), 0.0));
        Some(SpawnedPirate {
            ship_id: 2,
            observer_id: -2,
            home_id: 3,
            ammunition_id: 4,
        })
    }
    fn remove(&mut self, _ship: i64, _observer: i64) {
        self.pirate = None;
    }
    fn set_input(&mut self, _observer: i64, input: Input) {
        self.input = input;
    }
    fn set_state(&mut self, _ship: i64, _activity: Activity) {}
    fn cargo_demand(&mut self, _ship: i64, victim: &str, active: bool) {
        self.demands.push((victim.to_owned(), active));
    }
    fn release_cargo(&mut self, _ship: i64) -> bool {
        false
    }
    fn sell_cargo(&mut self, _ship: i64, _credits: &mut f64, _exclude: Option<i64>) {}
    fn say(&mut self, _ship: i64, lines: &[String], replacements: &[(&str, &str)]) {
        if let Some(line) = lines.first() {
            let line = replacements
                .iter()
                .fold(line.clone(), |text, (pattern, replacement)| {
                    text.replace(pattern, replacement)
                });
            self.speech.push((self.tick, line));
        }
    }
    fn steer(&mut self, ship: i64, pilot: &mut Pilot, movement: &Movement) -> (f64, f64) {
        pilot.steer(
            self.context(
                ship,
                self.ship(movement.target_id).map(|target| target.target()),
            ),
            movement,
        )
    }
    fn search(&mut self, ship: i64, pilot: &mut Pilot, search: &mut Search) -> (f64, f64) {
        let context = self.context(ship, None);
        let movement = search.movement(context);
        pilot.steer(context, &movement)
    }
    fn attack(
        &mut self,
        ship: i64,
        pilot: &mut Pilot,
        target: FlightTarget,
        options: AttackOptions,
    ) -> (f64, f64, bool) {
        pilot.attack(self.context(ship, Some(target)), target, options)
    }
    fn return_movement(
        &mut self,
        _ship: i64,
        home: &StationDescription,
        home_id: i64,
        _guide: &mut DockingGuide,
    ) -> Movement {
        Movement {
            position: home.position,
            target_id: home_id,
            ..Movement::default()
        }
    }
}

impl Host<'_> {
    fn context(&self, ship: i64, target: Option<FlightTarget>) -> FlightContext<'_> {
        FlightContext {
            ship: self.ship(ship).unwrap().motion,
            rules: self.catalog.npc_movement,
            tick: self.tick,
            simulation_step: self.catalog.simulation.simulation_step,
            launching: false,
            obstacles: &[],
            target,
        }
    }
}

fn ship(id: i64, observer: i64, position: Vector, mined_cargo_value: f64) -> ShipView {
    ShipView {
        id,
        name: "Test ship".into(),
        observer_id: observer,
        motion: ShipMotion {
            position,
            radius: 40.0,
            model_radius: 60.0,
            angular_acceleration: 4.0,
            maximum_turn_rate: 2.0,
            acceleration: 340.0,
            maximum_speed: 300.0,
            drag: 0.5,
            max_speed_drag: 0.8,
            minimum_speed_squared: 1.0,
            visible_substep: 1.0 / 90.0,
            ..ShipMotion::default()
        },
        dead: false,
        resident: true,
        docked: false,
        launching: false,
        in_transit: false,
        stranded: false,
        has_hatch: true,
        has_cannon: true,
        releasing_cargo: false,
        mined_cargo_value,
        cargo_space: 4,
        cargo: Vec::new(),
    }
}

fn host(catalog: &Catalog) -> Host<'_> {
    let mut ship = ship(
        1,
        1,
        Vector::ZERO,
        catalog.pirate_spec.cargo_value_threshold + 1.0,
    );
    ship.cargo.push(Cargo {
        id: 99,
        item: true,
        rounds: false,
        price: 1.0,
    });
    Host {
        tick: 0,
        catalog,
        player: Player {
            account: "account".into(),
            display_name: "Player".into(),
            observer_id: 1,
            connected: true,
            encounter_after: 0,
            ship,
        },
        pirate: None,
        speech: Vec::new(),
        demands: Vec::new(),
        input: Input::default(),
    }
}

#[test]
fn countdown_and_attack_pause_keep_go_tick_boundaries() {
    let catalog = Catalog::load().unwrap();
    let dialog = &catalog.pirate_dialog;
    let mut host = host(&catalog);
    let mut manager = Manager::default();
    manager.dispatch(&catalog, &mut host);
    let mut fought = None;
    for tick in 0..=690 {
        host.tick = tick;
        manager.update(&catalog, &mut host);
        if tick < 690 {
            assert!(!host.input.fire);
        }
        if manager.pirates[0].state.activity == Activity::Fighting && fought.is_none() {
            fought = Some(tick);
        }
    }
    let expected: Vec<_> = std::iter::once(dialog.cargo_demand[0].clone())
        .chain(
            (1..=5)
                .rev()
                .map(|seconds| dialog.countdown[0].replace("{seconds}", &seconds.to_string())),
        )
        .chain([dialog.countdown_end[0].clone(), dialog.attack[0].clone()])
        .collect();
    let categories: HashMap<&str, usize> = expected
        .iter()
        .enumerate()
        .map(|(index, text)| (text.as_str(), index))
        .collect();
    let observed: Vec<_> = host
        .speech
        .iter()
        .filter_map(|(tick, text)| categories.get(text.as_str()).map(|&index| (*tick, index)))
        .collect();
    assert_eq!(
        observed,
        [0, 10, 11, 12, 13, 14, 17, 20]
            .into_iter()
            .enumerate()
            .map(|(index, second)| (second * 30, index))
            .collect::<Vec<_>>()
    );
    assert_eq!(fought, Some(690));
    assert!(host.input.fire);
}

#[test]
fn surrender_during_countdown_pauses_before_collection() {
    let catalog = Catalog::load().unwrap();
    for second in [16, 19, 22] {
        let mut host = host(&catalog);
        let mut manager = Manager::default();
        manager.dispatch(&catalog, &mut host);
        for tick in 0..=second * 30 {
            host.tick = tick;
            host.player.ship.releasing_cargo = tick == second * 30;
            manager.update(&catalog, &mut host);
        }
        let pirate = &manager.pirates[0];
        assert_eq!(pirate.state.activity, Activity::Waiting);
        assert!(pirate.state.cargo_accepted);
        assert!(pirate.state.collect_after > second as f64);
        assert!(pirate.aggressors.is_empty());
        assert!(!host.input.fire);
        assert_eq!(host.demands.last(), Some(&("account".into(), false)));
    }
}
