# Player and world persistence

The Rust server runs the simulation in memory. SQLite keeps the durable state
in WAL mode with `synchronous=FULL`. The simulation captures immutable records
and a background writer encodes and commits them.

## Accounts and records

The player ID (`playerId`) is the private account UUID stored in `players.id`.
The browser stores it under the existing `playerToken` localStorage key and
sends it on reconnect. Clearing browser storage loses access to that account.
The server allocates a player number (`playerNumber`) at runtime for the
simulation and game messages. The number can change after a server restart.

Dormant accounts stay in SQLite. Login loads the account and its ships on
demand, and identity preview reads the saved profile directly. A missing account
returns HTTP 404 and a storage read error returns 503. After disconnect, the
server releases the account and ships from memory once the hull is hidden and
the pending save commits. An active pirate encounter can retain the account.

- `players` stores the UUID, display name, role, ban status, sector, join and
  last-seen times, whole playtime seconds and credits, paint unlocks, docking
  history, and ship JSON.
- `world` stores the seed, generation digest, tick, RNG state, ID counters,
  and per-sector JSON with NPC controller state and dispatch queues.
- `entities` stores the entity ID, sector, generated flag, and CBOR mechanics
  or a deletion tombstone.

SQLite indexes display names directly using the game's Unicode simple case
folding. A name can belong to only one account, including while its owner is
offline or banned. New accounts can stay unnamed until they choose a name.
Owner lookup has a partial index. The ship record stores the active and stored
hulls, positions, condition, fitted modules, and cargo. A player who sells their
last ship retains a `no_ship` berth record for their station and camera position.
Ships rebuild defaults from specs and resume stationary. World entity records
retain movement. Player and world records share a transaction with the ID
counters, so a cargo transfer and removal of its source commit together.

## Changes to content and saves

A missing or empty database gets the current tables and indexes. On first
open, older saves gain the unique display name index. If names conflict, the
server preserves the save and keeps maintenance available. Resolve the
duplicate names in the old database or explicitly reset the world.

Ship, module, and player cargo records reference catalog definition IDs. Add a
purchasable weapon to the station module catalog or a new hull to station ship
offers, and existing worlds can sell them using the same save format. Keep
existing definition IDs, hull layouts, and mount compatibility stable. Ship
restore fails on unknown definitions or invalid equipment. Saved stations use
current offers and restore their finite stock from SQLite. Starting stock
applies when a station is created.

The server checks the saved seed against `WORLD_SEED` and compares a digest of
sector generation settings and names, region generation settings, region size,
and ordered item IDs. A new item fits the existing tables. Appending its ID
changes the digest and requires a fresh world, including when the item is new
ammunition. To bury the item in asteroids, also update the loot generator.
Saved asteroids restore their contents from numeric resource IDs. Reset after
generator changes that alter what the same seed produces, even if the hashed
settings are unchanged.

## Save timing and recovery

Gameplay changes mark records dirty and appear in snapshots before commit.
Account creation, initial naming, and moderation request immediate commits
with snapshot barriers. Ordinary saves become eligible after 30 seconds, or
earlier with 256 pending world records. The scheduler checks after each full
simulation tick and prefers ticks that used less than half their time budget.
It attempts a save by 60 seconds even when ticks remain busy.

Every three minutes the server starts a movement and damage checkpoint, copying
up to eight world entities per tick. A region unload also saves its objects.
Untouched regions generate from the seed. Deleted generated entities leave
tombstones so they stay deleted. Projectiles and entities actively decaying
are temporary. Detached asteroid segments and item-bearing debris remain
durable.

The bounded writer queue coalesces pending batches using the latest record for
each player and entity. Failed writes retry. A storage failure pauses world
updates, rejects new gameplay commands, and makes `/healthz` return 503.

An unexpected exit can lose changes since the last successful commit. The
checkpoint interval, save deadline, and writer delay can put movement or
damage roughly four minutes behind, and a backlog can extend that interval.
A normal disconnect marks the ship for saving. Graceful shutdown flushes
permanent active mechanics within the server's eight-second deadline
(Fly allows ten seconds).

NPC ships use world entity records, while controller state and deadlines use
per-sector metadata. They save atomically with the related player, station,
and cargo changes. Offline time counts toward neither simulation deadlines nor
player playtime.

## Local development and Fly deployment

`npm run dev:server` and `npm run start:server` default to
`.data/world.sqlite`. Set `DATABASE_PATH` to use another file. Production
requires an explicit path. Each database has an exclusive game server lock.

Keep one game Machine in `lhr` and preserve the attached volume when replacing
it. Volumes are local to individual Machines. Check `fly status` and
`fly volumes list` before deploying. If `game_data` does not exist, create it
with `fly volumes create game_data --region lhr --size 1`.

`fly.toml` mounts `game_data` at `/data` and sets
`DATABASE_PATH=/data/world.sqlite` and `BACKUP_DIRECTORY=/data/backups`.
The scratch image sets the volume ownership and runs the game as uid/gid 65532. See the [Fly deployment skill](../.agents/skills/fly-deployment/SKILL.md).

## Reset a world

**A reset clears world changes and player progress.** Both reset commands move
the database and its `-wal` and `-shm` sidecars together into a
`world.sqlite.reset-*` archive beside the database. Periodic backups remain
available.

Stop the local game server, then run the local reset. It honors
`DATABASE_PATH` and takes the database lock. Start the server normally to
generate a fresh world.

```sh
npm run reset-world:local
```

For Fly, use the installed Fly CLI with your existing login or `FLY_API_TOKEN`.
The command selects one running Machine with the `/data` mount. The app name
is optional.

```sh
npm run reset-world:live
npm run reset-world:live -- my-app
```

Live reset disconnects players, stops gameplay, flushes saves, archives the
old database, and starts a fresh world on the same Machine and volume. It
waits for the command response and configured health checks. Old browser
tokens can reconnect and receive new identities. The mode-0600
`DATABASE_PATH.control.sock` stays available to the server user during reset
and serializes maintenance commands. Do not deploy during a reset.

### Recover a failed reset or startup

If the database cannot load, the server logs the error, preserves the database,
and keeps the maintenance socket available. An explicit reset can archive an
incompatible save. A failed flush blocks archiving. If archiving or startup
fails during a reset, correct the underlying error and resume:

```sh
npm run reset-world:live -- --resume
```

Resume reopens the original database if archiving failed. If the archive
succeeded, resume starts the fresh world. A timeout can occur after the server
accepts a reset. Check health and logs before taking further action.

### Edit saved player data

Stop the game server cleanly and back up the database before editing it with
SQLite tools. The server lock only coordinates game processes. Credits and
playtime can be edited with stock SQLite. Writes that affect the display name
index require the game's `player_name` collation on the SQLite connection.

On Fly, use a maintenance image with SQLite tools and preserve the existing
volume. Keep the game process stopped during edits. Fly SSH needs a running
Machine.

## Backups and restore

A separate reader takes a consistent SQLite backup every six hours and keeps
the newest twelve completed backups in `BACKUP_DIRECTORY`. Keep copies away
from the game volume or use Fly volume snapshots to recover from volume loss.
Keep database files and backups out of source control.

List completed periodic backups, reset archives, and disk usage on Fly:

```sh
npm run backups:live
```

Delete a full path from the listing, or delete all completed backups and reset
archives with `--all`. Both scripts accept `--app my-app` and run while the
game is live.

```sh
npm run backups:delete:live -- /data/backups/world-<timestamp>.sqlite
npm run backups:delete:live -- --all
```

Test restoration separately before replacing production data. Stop the game
server and move the current database and its sidecars aside together. Place a
completed backup at `DATABASE_PATH`. To restore a reset archive, move its
database and sidecars back together. On Fly, restore uid/gid 65532 ownership.
Restart with the backup's seed and compatible generation settings. Use the
online backup for a running database, since its WAL can contain committed
transactions.
