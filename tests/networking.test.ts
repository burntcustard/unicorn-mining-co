import assert from 'node:assert/strict';
import type WebSocket from 'ws';
import * as Vec from '../src/shared/vector';
import { GameSession } from '../src/server/game-session';
import {
  ReplicationManager,
  ReplicationView,
  SnapshotEncoder,
} from '../src/server/replication';
import { GameObject } from '../src/shared/game-object';
import { createStation } from '../src/shared/craft/create-station';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import type { ServerMessage } from '../src/shared/protocol/network';
import { addEntity, createWorld } from '../src/shared/simulation/world';

// An independent full scan is the oracle for indexed snapshots, including wire
// order, each observer's history, and snapshots skipped by slow receivers.
{
  const world = createWorld();
  const ships = Array.from({ length: 8 }, (_, i) =>
    addEntity(
      world,
      new GameObject({
        id: i + 1,
        position: Vec.create(i * 8000 - 24000, -2500),
      }),
    ),
  );

  for (let i = 0; i < 1600; i++) {
    addEntity(
      world,
      new GameObject({
        id: 100 + i,
        position: Vec.create(
          (i % 40) * 2000 - 40000,
          Math.floor(i / 40) * 2000 - 40000,
        ),
        radius: 20,
      }),
    );
  }
  const edge = addEntity(
    world,
    new GameObject({ id: 2000, position: Vec.create(-22000, -2500) }),
  );
  const marker = addEntity(
    world,
    createStation({ id: 2001, position: Vec.create(-14000, -2500) }),
  );
  const indexed = ships.map(() => new ReplicationManager());
  const scanned = ships.map(() => new ReplicationManager());
  const compare = (skip = false) => {
    const replicationView = new ReplicationView(world);
    const replicationRecords = new Map();

    const packetEncoder = new SnapshotEncoder();
    const actual = ships.map((ship, index) => {
      if (skip && index % 2) return;
      const snapshot = indexed[index].snapshot({
        world,
        shipId: ship.id,
        position: ship.position,
        replicationView,
        replicationRecords,
        packetEncoder,
      });
      const encoded = packetEncoder.encodeSnapshot(snapshot);

      assert.equal(
        encoded,
        JSON.stringify(snapshot),
        'shared fragments retain exact JSON',
      );
      return encoded;
    });

    ships.forEach((ship, index) => {
      if (skip && index % 2) return;
      const expected = JSON.stringify(
        scanned[index].snapshot({
          world,
          shipId: ship.id,
          position: ship.position,
        }),
      );

      assert.equal(
        actual[index],
        expected,
        `view ${index}, tick ${world.tick}`,
      );
    });
  };

  edge.label = `quotes " and \u0000, dollar $& $' and emoji 🌈`;
  compare();
  // Inclusive entry/exit radii, hysteresis, and positive/negative cell edges.

  for (const distance of [
    2000, 2000.001, 2499.999, 2500, 2500.001, 2001, 2000,
  ]) {
    edge.position.x = ships[0].position.x + distance;
    marker.position.x = ships[0].position.x + distance + 8000;
    world.tick += 4;
    compare();
  }

  for (let tick = 0; tick < 90; tick++) {
    world.tick += (tick % 3) + 1;
    world.entities.forEach((entity) => {
      if (entity instanceof GameObject && entity.id % 7 === tick % 7) {
        entity.position.x += 127;
        entity.rotation += 0.02;
        entity.label = tick % 2 ? 'changed' : undefined;
      }
    });
    compare(tick % 5 !== 0);
  }
  // A new batch observes immediate mutations even without a new world tick.
  world.entities.delete(edge.id);
  compare();
  addEntity(
    world,
    new GameObject({
      id: edge.id,
      position: Vec.clone(ships[0].position),
      health: 12,
    }),
  );
  compare();
  Vec.setXY(ships[1].position, -2500, 2500);
  compare();
  world.entities.delete(ships[2].id);
  compare();

  for (const x of [NaN, Infinity, 1e100]) {
    ships[0].position.x = x;
    compare();
  }
}

// Identical baselines reuse a delta object, while skipped sends retain their own.
{
  const world = createWorld();
  const ship = addEntity(world, new GameObject({ id: 1 }));
  const other = addEntity(
    world,
    new GameObject({ id: 2, position: Vec.create(10) }),
  );
  const a = new ReplicationManager(),
    b = new ReplicationManager();
  const initial = { world, shipId: ship.id };

  const initialEncoder = new SnapshotEncoder();
  const initialRecords = new Map();

  other.label = 'old field';
  const firstLoad = a.initial({
    ...initial,
    packetEncoder: initialEncoder,
    replicationRecords: initialRecords,
  });
  const secondLoad = b.initial({
    ...initial,
    packetEncoder: initialEncoder,
    replicationRecords: initialRecords,
    acknowledgedSequence: 9,
  });

  assert(firstLoad.type === 'load' && secondLoad.type === 'load');
  firstLoad.snapshotSequence = 1;
  secondLoad.snapshotSequence = 7;
  assert.equal(
    firstLoad.fullEntities[1],
    secondLoad.fullEntities[1],
    'fresh full records share within the batch',
  );
  assert.equal(
    initialEncoder.encodeSnapshot(firstLoad),
    JSON.stringify(firstLoad),
  );
  assert.equal(
    initialEncoder.encodeSnapshot(secondLoad),
    JSON.stringify(secondLoad),
  );
  assert.notEqual(
    initialEncoder.encodeSnapshot(firstLoad),
    initialEncoder.encodeSnapshot(secondLoad),
    'receiver acknowledgements stay private',
  );
  other.position.x++;
  world.tick++;
  const packetEncoder = new SnapshotEncoder();
  const replicationRecords = new Map();
  const options = { ...initial, packetEncoder, replicationRecords };
  const first = a.snapshot(options),
    second = b.snapshot(options);

  assert.equal(
    first.fullEntities[0],
    second.fullEntities[0],
    'same prior revision shares a delta',
  );
  assert.equal(packetEncoder.encodeSnapshot(first), JSON.stringify(first));
  assert.equal(packetEncoder.encodeSnapshot(second), JSON.stringify(second));

  addEntity(
    world,
    new GameObject({ id: other.id, position: Vec.clone(other.position) }),
  );
  const replacementEncoder = new SnapshotEncoder();
  const replacementOptions = {
    ...initial,
    packetEncoder: replacementEncoder,
    replicationRecords: new Map(),
  };
  const replacements = [
    a.snapshot(replacementOptions),
    b.snapshot(replacementOptions),
  ];

  for (const snapshot of replacements) {
    assert.equal(
      snapshot.fullEntities.find((entity) => entity.id === other.id)?.label,
      null,
      'replaced IDs clear the old record',
    );
    assert.equal(
      replacementEncoder.encodeSnapshot(snapshot),
      JSON.stringify(snapshot),
    );
  }
}

// Dense cells must not exceed the argument limit when gathering candidates.
{
  const world = createWorld();

  for (let id = 0; id < 150000; id++) {
    // The index only reads identity, class and position; share a position here.
    world.entities.set(id, { id, position: Vec.create() } as GameObject);
  }
  assert.equal(
    [...new ReplicationView(world).query(Vec.create())].length,
    world.entities.size,
  );
}

// Socket indexes must forget replaced connections before close callbacks, and
// late traffic from an old connection must not control the resumed player.
{
  const session = new GameSession({ worldSeed: 25 });
  const makeSocket = () => {
    const messages: ServerMessage[] = [];
    const socket = {
      readyState: 1,
      bufferedAmount: 0,
      send(packet: string) {
        messages.push(JSON.parse(packet));
      },
      close() {},
      terminate() {},
    } as unknown as WebSocket;

    return { socket, messages };
  };
  const first = makeSocket();

  session.receive({
    socket: first.socket,
    message: { type: 'hello', playerToken: null },
  });
  const welcome = first.messages.find((message) => message.type === 'welcome')!;

  assert(welcome.type === 'welcome');
  const second = makeSocket();

  first.socket.close = () => session.disconnect({ socket: first.socket });

  session.receive({
    socket: second.socket,
    message: { type: 'hello', playerToken: welcome.playerToken },
  });
  session.disconnect({ socket: first.socket });
  session.receive({
    socket: first.socket,
    message: {
      type: 'input',
      tick: 0,
      sequence: 999,
      input: { ...emptyPlayerInput(), thrust: 1 },
    },
  });
  session.receive({
    socket: second.socket,
    message: {
      type: 'input',
      tick: 0,
      sequence: 1,
      input: { ...emptyPlayerInput(), turn: 1 },
    },
  });
  session.tick();
  const snapshot = second.messages.find(
    (message) => message.type === 'snapshot',
  )!;

  assert(snapshot.type === 'snapshot');
  assert.equal(snapshot.acknowledgedSequence, 1);
  assert(session.world.players.has(welcome.playerId));
  session.disconnect({ socket: second.socket });
  session.disconnect({ socket: second.socket });
  assert.equal(session.world.players.size, 0);
  assert.equal(session['playersBySocket'].size, 0);
}
console.log('Networking visibility and connection lifecycle tests passed');
