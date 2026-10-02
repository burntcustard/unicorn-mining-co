import assert from 'node:assert/strict';
import * as Vec from '../src/shared/vector';
import {
  BinaryReplicationManager,
  BinarySnapshotBatch,
} from '../src/server/binary-replication';
import { ReplicationManager } from '../src/server/replication';
import { ReplicationView } from '../src/server/replication-common';
import { decodeBinarySnapshot } from '../src/shared/protocol/binary-snapshot';
import type {
  ReplicatedEntity,
  ServerMessage,
} from '../src/shared/protocol/network';
import { createShip } from '../src/shared/craft/create-ship';
import { createStation } from '../src/shared/craft/create-station';
import { createAsteroid } from '../src/shared/simulation/asteroid';
import { GameObject } from '../src/shared/game-object';
import { addEntity, createWorld } from '../src/shared/simulation/world';

type Snapshot = Extract<ServerMessage, { type: 'load' | 'snapshot' }>;

// Model NetworkClient's record merge independently of either wire codec.
const apply = (state: Map<number, ReplicatedEntity>, packet: Snapshot) => {
  if (packet.type === 'load') state.clear();

  for (const record of packet.fullEntities) {
    const full = { ...state.get(record.id), ...record };

    for (const [key, value] of Object.entries(record)) {
      if (value === null) delete (full as Record<string, unknown>)[key];
    }
    state.set(record.id, full);
  }
  const visible = new Set(packet.entityIds ?? state.keys());

  for (const id of state.keys()) if (!visible.has(id)) state.delete(id);
};

const world = createWorld();
const ships = [
  addEntity(world, createShip(world, { playerId: 1 })),
  addEntity(
    world,
    createShip(world, { playerId: 2, position: Vec.create(1800) }),
  ),
];
const rock = addEntity(
  world,
  createAsteroid(world, {
    position: Vec.create(100),
    radius: 64,
    contents: [1, 4],
    shapeOutline: [
      [0, 0],
      [20, 0],
      [0, 20],
    ],
    segments: [
      {
        contents: [1],
        health: 10,
        mass: 20,
        maxHealth: 10,
        shapeOutline: [
          [0, 0],
          [20, 0],
          [0, 20],
        ],
      },
    ],
  }),
);
const marker = addEntity(
  world,
  createStation({
    id: 100,
    position: Vec.create(9000),
  }),
);
let target = addEntity(
  world,
  new GameObject({
    id: 101,
    position: Vec.create(1999),
    label: 'quote " and dollar $& $\' and emoji 🌈',
    health: 12,
  }),
);

ships[0].cargoContents.push(
  new GameObject({
    id: 102,
    position: Vec.create(3, 4),
    label: 'nested',
  }),
);
const reference = ships.map(() => new ReplicationManager());
const binary = ships.map(() => new BinaryReplicationManager());
const expectedStates = ships.map(() => new Map<number, ReplicatedEntity>());
const actualStates = ships.map(() => new Map<number, ReplicatedEntity>());
const batch = new BinarySnapshotBatch();
let iteration = 0;
const compare = (initial = false, skipSecond = false) => {
  const view = new ReplicationView(world);
  const records = new Map();

  batch.begin(view);
  ships.forEach((ship, observer) => {
    if (skipSecond && observer) return;
    const headers = {
      world,
      shipId: ship.id,
      position: ship.position,
      acknowledgedSequence: iteration + observer,
      inputLead: observer ? -2 : 3,
    };
    const expected = JSON.parse(
      JSON.stringify(
        initial
          ? reference[observer].initial({
              ...headers,
              replicationRecords: records,
              replicationView: view,
            })
          : reference[observer].snapshot({
              ...headers,
              replicationRecords: records,
              replicationView: view,
            }),
      ),
    ) as Snapshot;
    const actual = decodeBinarySnapshot(
      initial
        ? binary[observer].initial({
            ...headers,
            replicationView: view,
            binaryBatch: batch,
          })
        : binary[observer].snapshot({
            ...headers,
            replicationView: view,
            binaryBatch: batch,
          }),
    );

    assert.deepEqual(
      actual,
      expected,
      `packet ${iteration}, observer ${observer}`,
    );
    apply(expectedStates[observer], expected);
    apply(actualStates[observer], actual);
    assert.deepEqual(
      actualStates[observer],
      expectedStates[observer],
      `receiver state ${iteration}, observer ${observer}`,
    );
  });
  iteration++;
};

compare(true);
// A change within the same simulation tick needs a fresh preparation batch.
target.label = 'same tick';
compare();
world.tick += 4;
ships[0].position.x += 14;
ships[0].rotation = Number.NaN;
ships[0].segments[0].active = 1;
ships[0].cargoContents[0].label = 'changed nested';
rock.health -= 5;
rock.contents[0] = Infinity;
target.radius = -0;
const asteroidSegments = rock.segments;

if (!asteroidSegments) throw new Error('Expected fixture asteroid segments');
asteroidSegments[0].health -= 3;
compare();
world.tick += 4;
ships[0].rotation = Infinity;
ships[0].decay = 1;
marker.position.x = 10001;
compare(false, true);
world.tick += 4;
ships[0].rotation = 0.375;
ships[0].decay = undefined;
target.label = undefined;
compare();

for (const distance of [2000, 2499, 2501, 1999]) {
  world.tick += 4;
  target.position.x = ships[0].position.x + distance;
  compare();
}
world.entities.delete(target.id);
world.tick += 4;
compare();
target = addEntity(
  world,
  new GameObject({
    id: target.id,
    position: Vec.create(200),
    message: 'replacement',
  }),
);
world.tick += 4;
compare();
world.tick += 4;
ships[0].cargoContents.length = 0;
compare();

// Stationary players need no repeated records: prediction advances their
// existing state until a real change arrives.
const idleWorld = createWorld();
const idleShips = [1, 2].map((playerId) =>
  addEntity(idleWorld, createShip(idleWorld, { playerId })),
);
const idleReplication = new BinaryReplicationManager();

idleReplication.initial({ world: idleWorld, shipId: idleShips[0].id });

for (let tick = 1; tick <= 90; tick++) {
  idleWorld.tick = tick;
  const packet = decodeBinarySnapshot(
    idleReplication.snapshot({ world: idleWorld, shipId: idleShips[0].id }),
  );

  assert.deepEqual(
    packet.fullEntities,
    [],
    'unchanged free players do not need heartbeat records',
  );
}
idleShips[1].dockedTo = 999;
idleWorld.tick++;
idleReplication.snapshot({ world: idleWorld, shipId: idleShips[0].id });
idleWorld.tick++;
assert.deepEqual(
  decodeBinarySnapshot(
    idleReplication.snapshot({ world: idleWorld, shipId: idleShips[0].id }),
  ).fullEntities,
  [],
  'unchanged docked ships do not require heartbeats',
);
