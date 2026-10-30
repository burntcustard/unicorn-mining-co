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
| `role`            | Saved `user`, `admin`, or `owner` permissions.                                   |
| `banned`          | Whether the account is barred from connecting.                                   |
| `sector`          | The sector containing the player's ship.                                         |
| `first_joined_at` | UTC Unix seconds for the original join.                                          |
| `last_seen_at`    | UTC Unix seconds for the latest connected save/disconnect.                       |
| `played_for`      | Rounded whole connected seconds. Fractional time accumulates in memory.          |
| `credits`         | Rounded whole balance, directly editable during maintenance.                     |
| `unlocked_paints` | Compact nine-bit mask.                                                           |
| `visited`         | JSON list of every docked-to craft ID in chronological order, including repeats. |
| `ship`            | Small JSON record of the ship's type, position, condition, equipment and cargo.  |

Docking history comes from each docking event's `dockedTo` craft ID. Docking-bay
contact handling belongs to `Craft`, so the history is not restricted to stations.

The players table uses `WITHOUT ROWID`, so its UUID key is also its storage key.
Dates, playtime and credits are integers. The ship record contains its object ID,
spec ID, integer `[x,y]` position, heading, optional paint/docking/death
state, hull health values, fuel, fitted modules, and cargo. Modules contain an ID, type,
mount, health, optional paint and firing cooldown, and active/activation-progress
pairs. Cargo contains its identity, type and condition, plus message contents or
remaining ammunition rounds where needed. Saves use the current item and module
IDs and mount layout; renamed IDs and retired layouts are not translated.
Credits are stored only in their SQL column. Shapes, physics constants, velocity,
spin, movement parents, flight inputs and RNG state are not saved for player
ships. Specs rebuild those defaults, and ships resume stationary. Partial
health and module activation retain their precision. Rounding affects saved
copies, never the running physics. A default ship occupies 512 bytes of JSON,
compared with 2,306 bytes as a general world-object Gob record.
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

The current database format is schema version 7. Startup validates the schema
version. An incompatible database requires a fresh `DATABASE_PATH`.

Gameplay creation/removal, cargo transfers, docking, purchases, equipment,
credits, unlocks, and disconnects mark their affected records dirty. Their
in-memory results and snapshots do not wait for a periodic database commit.
Related player and world records are captured together, so cargo and its source
entity removal still commit atomically. Account creation, initial naming, and
moderation changes request immediate commits; their existing snapshot barriers
remain, including automatic owner-role assignment. The current rollout/validation status is recorded in the
[SQLite CPU investigation](investigations/2026-10-28-server-sqlite-cpu.md).

Ordinary saves become eligible after 30 seconds. The scheduler runs after the
complete global simulation update and prefers a tick that used less than half
its normal step budget. It submits by 60 seconds even if ticks remain busy.
At least 256 pending world records make a save eligible earlier to limit
accumulation; this is an early-save trigger, not a strict batch-size limit.
This uses measured tick time, not an operating-system CPU-idle poll. Immutable
copies stay on the simulation owner; encoding and SQLite commits already run
asynchronously in the writer. Moving reads of mutable live objects to that
worker would be unsafe.

Failed transactions retry; persistent storage failure pauses world updates,
rejects new gameplay commands and makes `/healthz` return 503. Queued writes are
bounded and are retained when the writer falls behind. The owner skips copying
when the queue is full. The writer combines an existing backlog into one atomic
transaction using the latest record for each affected player and entity, without
waiting to collect more work. Only the craft that fractures is saved alongside
its fragments; unrelated players and stations are not copied for every floating
item creation or removal.

Every three minutes the server starts a movement/damage checkpoint. It copies at
most eight world entities and one player per tick, spreading CPU work across
ticks. Only active objects need periodic checkpoints; an object is also saved
when its region unloads. Identical entity records skip SQLite updates. Changes
to sleeping objects are retained in memory and loaded from SQLite on restart.
Untouched areas continue to generate from the saved seed. Generated entity
deletions have durable tombstones; deleted runtime objects can be removed from
the database because their IDs are never reused. A runtime object created and
removed before any save was submitted needs no SQL deletion. Submitted records
remain tracked before commit, so a later deletion cannot be lost behind an
in-flight creation.

World projectiles and objects with positive `Decay` are temporary and are not
saved. This includes fading asteroid pieces and craft wreckage. They continue
to simulate normally while the server runs; their damage to permanent objects
still follows the ordinary save rules. Permanent items, ships, stations,
asteroids, player state, and cargo contents remain saved. Old temporary world
rows are discarded on restore and queued for removal from SQLite. If an object
was saved before becoming temporary, its old record is deleted; generated
objects retain deletion tombstones so procedural generation cannot recreate them.

Unexpected process failure can rewind ordinary gameplay, including credits,
cargo, purchases, equipment, movement, and damage, to its last committed state.
The three-minute checkpoint, up-to-minute save deadline, incremental copying,
and writer completion can make that roughly four minutes or longer. The timer is not an
absolute rollback bound when storage is unavailable or a large checkpoint is
still draining. This relaxed durability was explicitly authorized for the
current performance work. A committed batch remains durable under SQLite's
unchanged `synchronous=FULL` policy. Normal disconnects park the player's ship
and mark it for the deferred save. Graceful shutdown force-flushes permanent
active mechanics within the server's eight-second
shutdown deadline; Fly allows ten seconds. Resume parks disconnected player
ships rather than applying offline movement. World simulation also pauses while
the server is down. Offline time does not count as playtime.

## NPC recovery

Pirates and collectors use ordinary world-entity records for their full ship
mechanics, equipment, fuel, and cargo. Controller metadata lives in the world's
per-sector JSON: behavior, pickup lists, inspections, encounter timers, and
station dispatch queues. Pirate references to human players use persistent
account UUIDs; NPC aggressors use stable ship IDs because numeric observer IDs
are reassigned at startup. Navigation caches are
rebuilt when movement resumes.

Each save captures NPC ships and controller metadata with the related item,
station, and player changes. Pickups, sales, and NPC removals therefore commit
atomically without duplicating cargo or reviving a finished trip. The existing
background save interval also captures idle station timers when no player or
entity record is dirty. Simulation ticks and deadlines resume from the saved
state, so shutdown time consumes no grace, launch, inspection, pickup, or
encounter interval. Restored NPCs immediately become world observers again;
collectors keep loading their surroundings, collecting, and returning to stations
even when no players are connected.

## Local development

`npm run dev:server` and `npm run start:server` default to
`.data/world.sqlite`, which is excluded from Git and Docker builds. Override
`DATABASE_PATH` to use another file. Production requires an explicit path.
The database has one owner: another game server using the same
file fails with a lock error rather than overwriting live state.

The seed and a digest of generation rules are checked on startup. Appending
new items to the catalog accepts saves from any earlier prefix of that catalog;
existing resource IDs must keep their current names and order. Weapon definitions
can also be added without resetting the world. Older restored ships and cargo keep
their saved contents; newly defined items or weapons are available through their
normal gameplay creation or purchase paths. The next world save records the
current digest while preserving player and entity records. Changing
`WORLD_SEED` or generation rules requires a fresh world database; an incompatible
database never silently creates a fresh world.

New stations start with 300 autogun ammo packs. Saved stations restore their
inventory as saved, including partial or empty ammo supplies.

## Fly deployment

Keep exactly **one game Machine** in `lhr`. SQLite volumes are local to a Machine;
additional Machines would create independent worlds. Check `fly status` and
`fly volumes list` before deploying. For the first persistence deployment,
create a 1 GB volume if `game_data` does not already exist:

```sh
fly volumes create game_data --region lhr --size 1
GOOS=linux GOARCH=amd64 npm run build
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

### Reset a world

Resetting clears all world changes **and player progress**. Stop the local game
server, then run:

```sh
npm run reset-world:local
```

This always targets this checkout's `.data/world.sqlite`. It takes the server's
exclusive lock and refuses to run if the database is in use. The database and
its `-wal`/`-shm` sidecars are moved together into a `world.sqlite.reset-*`
directory beside the database. Periodic backups and unrelated `.data` files are
retained. Start the server normally to generate a fresh world. Browser player
tokens can remain; players receive fresh profiles when they reconnect.

After deploying a version with the `--reset-world-live` command, reset Fly with:

```sh
npm run reset-world:live
# Or select another Fly app explicitly:
npm run reset-world:live -- my-app
```

The script uses the installed Fly CLI with your existing login or
`FLY_API_TOKEN`. It requires exactly one running Machine mounting `/data` and executes
`/app/server --reset-world-live`, which contacts the running server through
`DATABASE_PATH.control.sock`. This Unix socket is mode `0600`, accessible only
to the game user; there is no public reset HTTP endpoint.

The main process and Fly Machine stay running throughout the operation. The
server disconnects players, stops its simulation and HTTP listener, flushes
pending saves, closes SQLite and its database lock, and archives the database
and sidecars together. It releases the old world from memory, creates a fresh
world, and reopens the same HTTP port. The private maintenance socket stays
available throughout. The script waits for the command's successful response
and configured health checks. It never updates the Machine configuration or
changes its attached volume during a normal reset. Archives stay on `/data`.
Players can reconnect normally; old tokens receive new tokens and fresh profiles.

The private socket serializes the game's maintenance operations. Do not deploy
concurrently with a reset.

If an existing world cannot load (for example after generation rules change),
the server keeps its main process and private maintenance socket running while
the game remains unavailable. It logs the startup error and preserves the
database. An explicit live reset can then archive that incompatible database
and start the new world without reallocating the Machine. A failed resume never
silently clears incompatible progress.

A failed flush prevents archiving. A failed archive or restart leaves the game
stopped inside the still-running Machine, with the private maintenance socket
available. Fix the underlying error, then resume without another reset:

```sh
npm run reset-world:live -- unicorn-mining-co --resume
```

Resume never archives another world. It refuses to silently create an empty
database if an unsuccessful archive left the original database missing. A
successful reset followed by a failed startup can resume its fresh database
while retaining the archived world. Concurrent maintenance commands are refused
rather than queued. A client timeout may occur after the server accepted a
reset, so the script does not retry resets automatically. Inspect health and
logs or resume instead of repeating a reset after an ambiguous failure.

An HTTP 409 reporting `insufficient memory available ... on the current host`
means Fly could not reserve host RAM for a Machine update. It does not indicate
that the data volume is full, and deleting backups does not fix that host-memory
allocation error. The new live reset avoids the Machine stop/update cycle that
triggered this failure. The obsolete `--restore` Machine-configuration workflow
has been removed; these scripts never change Machine settings or attached volumes.

The offline reset command is also available directly as
`DATABASE_PATH=/path/to/world.sqlite ./bin/server --reset-world`.
To undo a reset, stop the server, preserve the new database and its sidecars,
then move all archived database files back together to their original paths.
Keep the archived WAL with its database, and restore uid/gid 65532 ownership on Fly.

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

After deploying the server with backup maintenance commands, inspect the live
volume with:

```sh
npm run backups:live
# Optional app override, supported by both scripts:
npm run backups:live -- --app my-app
```

The listing includes completed periodic files in `BACKUP_DIRECTORY` and
`world.sqlite.reset-*` archives beside `DATABASE_PATH`, with full paths,
modification times in UTC, and allocated disk space for each entry. It reports
the number of backups, total backup space, and available/used/total space on the
database volume. Disk totals also include the live database and other files.
Incomplete `.tmp` backups are excluded from the backup count and deletion.

Copy a full path from the listing to delete one backup, or use `--all` to delete
all completed periodic backups and reset archives:

```sh
npm run backups:delete:live -- /data/backups/world-20261012T120000.000000000.sqlite
npm run backups:delete:live -- /data/world.sqlite.reset-123456789
npm run backups:delete:live -- --all
```

Deletion immediately removes the selected local copies and reports backup
counts, backup space and volume space before and after. It preserves the live
database, its sidecars and lock, incomplete backups and unrelated files. Reset
archives with unexpected content are refused. Normal six-hour backups continue
after deletion. These commands do not list or delete Fly's volume snapshots.

Both scripts use the installed Fly CLI, select exactly one running Machine
mounting `/data`, and execute the server's maintenance command. No shell or
maintenance image is required, and the game can stay running.

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
NPC behavior and ship recovery, idle station timers, queued collector departures,
inspection recovery, NPC cargo transfers and despawns,
write failure/retry, bounded queue coalescing, rounding without
mutating live mechanics, UUID identity, minimal ship records, future/corrupt schemas and backup
restoration. WebSocket integration tests also restart the real executable and
kill it without a shutdown flush. Local benchmarks measure capture and SQLite
transaction costs; Fly CPU quota and disk latency require checking after rollout.
