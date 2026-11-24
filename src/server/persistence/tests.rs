use std::fs;

use super::*;

#[derive(Debug, Deserialize, Serialize)]
struct BodyState {
    id: i64,
    spin: f64,
}

impl EntityState for BodyState {
    fn id(&self) -> i64 {
        self.id
    }
}

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("unicorn-rust-save-{}-{id}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn batch(sequence: u64) -> SaveBatch<String, BodyState> {
    SaveBatch {
        sequence,
        world: WorldState {
            seed: 25.0,
            tick: sequence,
            random_state: 25.0,
            ..WorldState::default()
        },
        players: Vec::new(),
        entities: Vec::new(),
    }
}

fn player() -> SavedPlayer<String> {
    SavedPlayer {
        player_id: "a".to_owned(),
        display_name: "Ace".to_owned(),
        role: PlayerRole::Owner,
        banned: false,
        first_joined_at: 30,
        last_seen_at: 31,
        played_for: 13.6,
        credits: 11.6,
        unlocked_paints: DEFAULT_PAINTS,
        visited: vec![1, 1, 2],
        ship: "mustang".to_owned(),
        sector_id: "sector".to_owned(),
    }
}

fn entity(id: i64, generated: bool, state: Option<f64>) -> SavedEntity<BodyState> {
    SavedEntity {
        id,
        sector_id: "sector".to_owned(),
        generated,
        state: state.map(|spin| BodyState { id, spin }),
    }
}

#[test]
fn saves_one_transaction_and_preserves_generated_tombstones() {
    let directory = TestDirectory::new();
    let path = directory.0.join("world.sqlite");
    let mut store = Store::open(&path).unwrap();
    assert!(Store::open(&path).is_err());
    assert!(reset(&path).is_err());
    assert!(store.load::<String, BodyState>(25.0).unwrap().is_none());

    let mut first = batch(1);
    first.players.push(player());
    first.entities.extend([
        entity(1, true, Some(1.0)),
        entity(2, false, Some(2.0)),
        entity(3, false, Some(f64::NAN)),
    ]);
    store.save(&first).unwrap();

    let mut second = batch(2);
    let mut changed = player();
    changed.credits = -1.0;
    second.players.push(changed);
    second
        .entities
        .extend([entity(1, true, None), entity(2, false, None)]);
    assert!(store.save(&second).is_err());
    let world = store.load::<String, BodyState>(25.0).unwrap().unwrap();
    assert_eq!(world.world.tick, 1);
    assert_eq!(world.entities.len(), 3);

    second.players[0].credits = 9.5;
    second.players[0].first_joined_at = 99;
    store.save(&second).unwrap();
    let world = store.load::<String, BodyState>(25.0).unwrap().unwrap();
    assert_eq!(world.world.tick, 2);
    assert_eq!(world.players[0].first_joined_at, 30);
    assert_eq!(world.players[0].credits, 10.0);
    assert_eq!(world.players[0].played_for, 14.0);
    assert_eq!(world.players[0].role, PlayerRole::Owner);
    assert_eq!(world.players[0].visited, [1, 1, 2]);
    assert_eq!(world.entities.len(), 2);
    assert_eq!(world.entities[0].id, 1);
    assert!(world.entities[0].state.is_none());
    assert!(world.entities[1].state.as_ref().unwrap().spin.is_nan());
    assert!(store.load::<String, BodyState>(52.0).is_err());
}

#[test]
fn initializes_an_empty_file_and_keeps_profile_indexes_current() {
    let directory = TestDirectory::new();
    let path = directory.0.join("world.sqlite");
    fs::File::create(&path).unwrap();
    let mut store = Store::open(&path).unwrap();
    let mut initial = batch(1);
    for (id, name, role) in [
        ("a", "BurntCuſtard", PlayerRole::Owner),
        ("b", "Straße", PlayerRole::User),
        ("c", "", PlayerRole::User),
        ("d", "", PlayerRole::User),
    ] {
        let mut account = player();
        account.player_id = id.to_owned();
        account.display_name = name.to_owned();
        account.role = role;
        initial.players.push(account);
    }
    store.save(&initial).unwrap();

    let reader = store.account_reader().unwrap();
    assert_eq!(
        reader.player::<String>("a").unwrap().unwrap().ship,
        "mustang"
    );
    assert!(reader.has_owner().unwrap());
    assert_eq!(
        reader.matching_profile("BuRnTcUsTaRd", |_| true).unwrap(),
        Some(("a".to_owned(), PlayerRole::Owner))
    );
    assert!(reader.name_taken("burntcustard").unwrap());
    assert!(reader.name_taken("STRAẞE").unwrap());
    assert!(!reader.name_taken("STRASSE").unwrap());
    assert!(!reader.name_taken("").unwrap());

    let mut duplicate = batch(2);
    let mut account = player();
    account.player_id = "e".to_owned();
    account.display_name = "BURNTCUSTARD".to_owned();
    duplicate.players.push(account);
    assert!(store.save(&duplicate).is_err());
    assert!(reader.player::<String>("e").unwrap().is_none());
    assert_eq!(store.load_world(25.0).unwrap().unwrap().tick, 1);

    for (query, values, expected_index) in [
        (
            PROFILE_LOOKUP,
            &["burntcustard"][..],
            "players_display_name",
        ),
        (OWNER_LOOKUP, &[][..], "players_owner"),
    ] {
        let details: Vec<String> = reader
            .connection
            .prepare(&format!("EXPLAIN QUERY PLAN {query}"))
            .unwrap()
            .query_map(rusqlite::params_from_iter(values), |row| row.get(3))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(details.iter().any(|line| line.contains(expected_index)));
    }

    let mut renamed = batch(2);
    let mut account = player();
    account.display_name = "burntcustard".to_owned();
    account.role = PlayerRole::User;
    renamed.players.push(account);
    store.save(&renamed).unwrap();
    assert_eq!(
        reader
            .matching_profile("BURNTCUſTARD", |id| id == "a")
            .unwrap(),
        Some(("a".to_owned(), PlayerRole::User))
    );
    assert!(!reader.has_owner().unwrap());
    renamed.players[0].display_name = "AceΩ".to_owned();
    store.save(&renamed).unwrap();
    assert!(
        reader
            .matching_profile("burntcustard", |id| id == "a")
            .unwrap()
            .is_none()
    );
    assert_eq!(
        reader.matching_profile("ACEω", |_| true).unwrap(),
        Some(("a".to_owned(), PlayerRole::User))
    );
    drop(reader);
    drop(store);

    let maintenance = Connection::open(&path).unwrap();
    maintenance
        .execute("UPDATE players SET credits=5 WHERE id='b'", [])
        .unwrap();
    drop(maintenance);
    let store = Store::open(&path).unwrap();
    let reader = store.account_reader().unwrap();
    assert_eq!(reader.player::<String>("b").unwrap().unwrap().credits, 5.0);
    assert_eq!(
        reader.matching_profile("STRAẞE", |_| true).unwrap(),
        Some(("b".to_owned(), PlayerRole::User))
    );
    assert!(
        reader
            .matching_profile("STRASSE", |_| true)
            .unwrap()
            .is_none()
    );
}

#[test]
fn upgrades_legacy_players_after_duplicate_names_are_resolved() {
    for version in [0, 1] {
        let directory = TestDirectory::new();
        let path = directory.0.join("world.sqlite");
        let legacy = Connection::open(&path).unwrap();
        legacy.execute_batch(CREATE_SCHEMA).unwrap();
        legacy.pragma_update(None, "user_version", version).unwrap();
        if version == 0 {
            legacy
                .execute_batch(
                    "ALTER TABLE players ADD COLUMN display_name_key TEXT;
                     CREATE INDEX players_display_name_key ON players(display_name_key);
                     CREATE TRIGGER players_invalidate_name_key AFTER UPDATE OF display_name ON players
                     BEGIN
                         UPDATE players SET display_name_key=NULL WHERE id=NEW.id;
                     END;",
                )
                .unwrap();
        }
        legacy
            .execute_batch(
                "INSERT INTO players(id,display_name,role,banned,first_joined_at,last_seen_at,played_for,credits,unlocked_paints,visited,ship,sector)
                 VALUES ('a','AceΩ','owner',0,1,2,3,7,0,'[]','\"mustang\"',''),
                        ('b','ACEω','user',0,1,2,3,7,0,'[]','\"mustang\"','');",
            )
            .unwrap();

        let error = Store::open(&path).err().unwrap();
        assert!(error.to_string().contains("duplicate player display names"));
        assert_eq!(
            legacy
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            version
        );
        legacy
            .execute("UPDATE players SET display_name='Bob' WHERE id='b'", [])
            .unwrap();
        drop(legacy);

        let store = Store::open(&path).unwrap();
        let reader = store.account_reader().unwrap();
        assert_eq!(
            reader.matching_profile("ACEω", |_| true).unwrap(),
            Some(("a".to_owned(), PlayerRole::Owner))
        );
        assert_eq!(reader.player::<String>("b").unwrap().unwrap().credits, 7.0);
        assert!(reader.name_taken("bob").unwrap());
        assert!(
            store
                .connection
                .prepare("SELECT display_name_key FROM players")
                .is_err()
        );
    }
}

#[test]
fn writer_drains_and_online_backup_survives_reset() {
    let directory = TestDirectory::new();
    let path = directory.0.join("world.sqlite");
    let backups = directory.0.join("backups");
    let store = Store::open(&path).unwrap();
    let writer = store.start(backups.clone()).unwrap();
    let mut first = batch(1);
    first.players.push(player());
    assert!(writer.try_submit(first));
    assert!(writer.try_submit(batch(2)));
    writer
        .close(Instant::now() + Duration::from_secs(5))
        .unwrap();

    let original = Store::open(&path).unwrap();
    let backup = create_backup(&path, &backups).unwrap();
    let backup_store = Store::open(&backup).unwrap();
    let saved = backup_store
        .load::<String, BodyState>(25.0)
        .unwrap()
        .unwrap();
    assert_eq!(saved.world.tick, 2);
    assert_eq!(saved.players[0].display_name, "Ace");
    drop(backup_store);
    drop(original);

    let archive = reset(&path).unwrap();
    assert!(archive.join("world.sqlite").is_file());
    assert!(backup.is_file());
    let mut output = Vec::new();
    manage_backups(&path, &backups, BackupAction::List, &mut output).unwrap();
    assert!(
        String::from_utf8(output)
            .unwrap()
            .contains("Backups: 2 (1 periodic, 1 reset archives)")
    );
    fs::write(archive.join("keep.txt"), "keep").unwrap();
    assert!(manage_backups(&path, &backups, BackupAction::DeleteAll, &mut Vec::new()).is_err());
    assert!(backup.is_file());
    manage_backups(
        &path,
        &backups,
        BackupAction::Delete(&backup),
        &mut Vec::new(),
    )
    .unwrap();
    assert!(!backup.exists());
    assert!(archive.join("keep.txt").is_file());
}

#[test]
fn coalescing_keeps_last_update_per_record() {
    let (sender, mut receiver) = inbox::channel(QUEUE_CAPACITY);
    let mut first = batch(1);
    first.players.push(player());
    first.entities.push(entity(1, false, Some(1.0)));
    first.entities.push(entity(2, false, Some(2.0)));
    let mut second = batch(2);
    second.entities.push(entity(2, false, None));
    sender.try_send(second).unwrap();
    let merged = coalesce(first, &mut receiver);
    assert_eq!(merged.sequence, 2);
    assert_eq!(merged.world.tick, 2);
    assert_eq!(merged.players.len(), 1);
    assert_eq!(merged.entities.len(), 2);
    assert!(
        merged
            .entities
            .iter()
            .find(|entity| entity.id == 2)
            .unwrap()
            .state
            .is_none()
    );
}
