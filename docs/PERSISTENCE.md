# Player and world persistence

The authoritative Go simulation runs in memory. SQLite keeps the durable copy
using WAL and `synchronous=FULL`; its single background writer encodes immutable
records and commits transactions. The database schema and saved mechanics are
versioned independently of the network protocol.

The server generates private player UUIDs with `uuid.NewString()`. The browser
keeps its UUID in `localStorage` under `playerToken`.
That UUID is the database player's `id` and primary key. It also identifies
the browser when it reconnects, so it is sent only to its own client. Numeric
player IDs are allocated for live game messages on each server run; they are not
stored and are not login credentials. Clearing browser storage loses access to
that anonymous identity. Display names are stored as player metadata.

## Player columns

| Column            | Stored value and purpose                                                         |
| ----------------- | -------------------------------------------------------------------------------- |
| `id`              | Browser UUID, the primary key.                                                   |
| `display_name`    | Optional name, empty until set.                                                  |
| `first_joined_at` | UTC Unix seconds for the original join.                                          |
| `last_seen_at`    | UTC Unix seconds for the latest connected save/disconnect.                       |
| `played_for`      | Rounded whole connected seconds. Fractional time accumulates in memory.          |
| `credits`         | Rounded whole balance, directly editable during maintenance.                     |
| `unlocked_paints` | Compact seven-bit mask.                                                          |
| `visited`         | JSON list of every docked-to craft ID in chronological order, including repeats. |
| `ship`            | Small JSON record of the ship's type, position, condition, equipment and cargo.  |

Docking history comes from each docking event's `dockedTo` craft ID. Docking-bay
contact handling belongs to `Craft`, so the history is not restricted to stations.

The players table uses `WITHOUT ROWID`, so its UUID key is also its storage key.
Dates, playtime and credits are integers. The ship record contains its object ID,
spec ID, integer `[x,y]` position, heading, optional paint/docking/death
state, hull health values, fitted modules, and cargo. Modules contain an ID, type,
mount, health, optional paint and firing cooldown, and active/activation-progress
pairs. Cargo contains its identity, type and condition, plus message contents or
remaining ammunition rounds where needed. Both ship and world saves restore
legacy `shieldGenerator` and `thrusterSingle` IDs as the small shield generator
and medium single thruster specs.
Credits are stored only in their SQL column. Shapes, physics constants, velocity,
spin, movement parents, flight inputs and RNG state are not saved for player
ships. Specs rebuild those defaults, and ships resume stationary. Partial
health and module activation retain their precision. Rounding affects saved
copies, never the running physics. A default ship occupies 403 bytes of JSON,
compared with 2,142 bytes in the original general world-object Gob format.
World entities keep their fuller mechanics records, including movement, since
floating objects and damaged asteroids need those mechanics to resume correctly.

World metadata is stored as ordinary columns in the single-row `world` table:
`seed`, `generation_digest`, `tick`, `random_state`, `next_entity_id` and
`next_object_id`. The seed and RNG state retain their floating-point precision;
ticks and ID counters are integers. Both counters belong to the world and are
saved atomically with player/entity changes, then restored once before objects
are reconstructed. New entities count upward; modules and other objects use a
negative counter. Restoring an explicit ID consumes no new ID. Standalone objects
without a world must supply an explicit ID. The generation digest detects changed
procedural rules; the SQLite schema version covers the saved-data format.

The current database format is schema version 4. Startup validates the schema
version. An incompatible database requires a fresh `DATABASE_PATH`.

Gameplay creation/removal, cargo transfers, docking, purchases, equipment,
credits and unlock changes enqueue prompt transactions. Cargo and its source
entity removal commit together. Player welcomes and snapshots that confirm those
changes wait for the background commit, without waiting for disk in the simulation
loop. Failed transactions retry; persistent storage failure pauses world updates,
rejects new gameplay commands and makes `/healthz` return 503. Queued writes are
bounded and are retained when the writer falls behind. The owner skips copying
when the queue is full. The writer combines an existing backlog into one atomic
transaction using the latest record for each affected player and entity, without
waiting to collect more work. Only the craft that fractures is saved alongside
its fragments; unrelated players and stations are not copied for every floating
item creation or removal.

Every 30 seconds the server starts a movement/damage checkpoint. It copies at
most eight world entities and one player per tick, spreading CPU work across
ticks. Only active objects need periodic checkpoints; an object is also saved
when its region unloads. Identical entity records skip SQLite updates. Changes
to sleeping objects are retained in memory and loaded from SQLite on restart.
Untouched areas continue to generate from the saved seed. Generated entity
deletions have durable tombstones; deleted runtime objects can be removed from
the database because their IDs are never reused.

Unexpected process failure can rewind movement and partial damage to the latest
checkpoint (roughly 30 seconds plus the bounded copying/commit time under normal
load). Prompt transactions are durable once committed; an action whose commit
was still pending can roll back. Normal disconnects park and save the player's
ship. Graceful shutdown flushes active mechanics within the server's eight-second
shutdown deadline; Fly allows ten seconds. Resume parks disconnected player
ships rather than applying offline movement. World simulation also pauses while
the server is down. Offline time does not count as playtime.

## Local development

`npm run dev:server` and `npm run start:server` default to
`.data/world.sqlite`, which is excluded from Git and Docker builds. Override
`DATABASE_PATH` to use another file. Production requires an explicit path.
The database has one owner: another game server using the same
file fails with a lock error rather than overwriting live state.

The seed and a digest of generation rules are checked on startup. The catalog
upgrade that appended autocannon ammunition accepts the previous five-item
digest because procedural resource indices did not change. The next world save
records the current digest while preserving player and entity records. Changing
`WORLD_SEED` or generation rules requires a fresh world database; an incompatible
database never silently creates a fresh world.

## Fly deployment

Keep exactly **one game Machine** in `lhr`. SQLite volumes are local to a Machine;
additional Machines would create independent worlds. Check `fly status` and
`fly volumes list` before deploying. For the first persistence deployment,
create a 1 GB volume if `game_data` does not already exist:

```sh
fly volumes create game_data --region lhr --size 1
fly deploy --ha=false
```

`fly.toml` mounts `game_data` at `/data` and sets
`DATABASE_PATH=/data/world.sqlite` and `BACKUP_DIRECTORY=/data/backups`.
The scratch-container server initializes the volume's ownership, then drops to
uid/gid 65532. Immediate deployments stop the old simulation before starting the
new one. Do not delete the volume when replacing a Machine.

The first rollout cannot recover progress from servers that already restarted
before persistence existed. Database credentials and contents do not belong in
source control; pushes to `main` deploy code, not player balances.

## Maintenance

For occasional player-data edits, stop the game server cleanly, back up the database, and open `DATABASE_PATH` with
SQLite tools. Credits, display names and playtime are ordinary table columns.
Restart the game after editing; its in-memory records would otherwise overwrite
manual changes. The server's exclusive lock prevents competing game servers,
but external SQLite tools do not honor that lock.

On Fly the file is `/data/world.sqlite` on the `game_data` volume. The current
scratch image has no shell or SQLite CLI, so direct editing requires a maintenance
image with those tools. Keep the game process stopped while editing and preserve
the existing volume. Fly SSH requires a running Machine; stopping the entire
Machine also removes SSH access. Routine database edits do not require changes
in source control.

## Backups and restore

Every six hours a separate paced reader creates a consistent backup using SQLite's online
backup API under `BACKUP_DIRECTORY`, keeping the newest twelve completed files.
Temporary/incomplete backups are never presented as completed files. These local copies protect against accidental
edits; they **do not protect against losing the volume itself**. Copy completed
backups to separate storage, and keep Fly volume snapshots enabled. Off-server
storage/upload credentials are not provisioned by this code change.

To restore, stop the server, preserve the current database and its `-wal`/`-shm`
files elsewhere, put a completed backup at `DATABASE_PATH`, remove stale sidecar
files at that path, ensure the restored file belongs to uid/gid 65532 on Fly,
and restart with the backup's seed. Validate restoration on a
separate database before replacing production data. Fly snapshots can also
restore an entire volume. Do not copy only the main database file while it is
running in WAL mode.

## Verification

Recovery tests cover encoded mechanics, module/cargo state, disconnects, long
offline sessions, procedural deletion, region unloading, atomic cargo transfer,
write failure/retry, bounded queue coalescing, rounding without
mutating live mechanics, UUID identity, minimal ship records, future/corrupt schemas and backup
restoration. WebSocket integration tests also restart the real executable and
kill it without a shutdown flush. Local benchmarks measure capture and SQLite
transaction costs; Fly CPU quota and disk latency require checking after rollout.
