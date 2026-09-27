import assert from 'node:assert/strict';
import type WebSocket from 'ws';
import * as Vec from '../src/shared/vector';
import { RemoteMotion } from '../src/client/remote-motion';
import { GameSession } from '../src/server/game-session';
import { parseClientMessage } from '../src/server/parse-client-message';
import { ReplicationManager } from '../src/server/replication';
import { GameObject } from '../src/shared/game-object';
import { createStation } from '../src/shared/craft/create-station';
import { createShip } from '../src/shared/craft/create-ship';
import {
  addEntity,
  addPlayer,
  createWorld,
} from '../src/shared/simulation/world';
import { updateWorld } from '../src/shared/simulation/update-world';
import { emptyPlayerInput } from '../src/shared/protocol/input';
import { simulationStep, maxPredictionTicks } from '../src/shared/settings';
import { type InputFrame } from '../src/shared/protocol/input-frame';

// Batched movement preserves short input edges, including edges in later ticks.
const runInputs = (batched: boolean) => {
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));

  addPlayer(world, { id: 1, shipId: ship.id });
  const off = emptyPlayerInput(),
    on = { ...off, thrust: 1, turn: 1 };
  const changes = [
    { input: on, offset: simulationStep + 0.007 },
    { input: off, offset: 2 * simulationStep + 0.013 },
  ];

  if (batched) {
    updateWorld({
      world,
      inputs: new Map([[1, { input: off, changes }]]),
      dt: 0.1,
      ticks: 3,
    });
  } else {
    for (let tick = 0; tick < 3; tick++) {
      const frame: InputFrame = {
        input: tick === 2 ? on : off,
        changes: changes
          .filter((c) => Math.floor(c.offset / simulationStep) === tick)
          .map((c) => ({ ...c, offset: c.offset - tick * simulationStep })),
      };

      updateWorld({ world, inputs: new Map([[1, frame]]) });
    }
  }
  return { ship, world };
};
const batched = runInputs(true),
  regular = runInputs(false);

assert.equal(batched.world.tick, 3);
assert(Vec.distance(batched.ship.position, regular.ship.position) < 1e-5);
assert(Vec.distance(batched.ship.velocity, regular.ship.velocity) < 1e-5);
assert.equal(batched.ship.thrust, 0);
assert.equal(batched.ship.turn, 0);

// Crossing distant replication deadlines must work even when tick IDs skip them.
{
  const world = createWorld();
  const ship = addEntity(world, createShip(world, { playerId: 1 }));
  const item = addEntity(
    world,
    createStation({ id: 900, position: Vec.create(2500), spin: 1 }),
  );
  const replication = new ReplicationManager();

  world.tick = 1;
  replication.initial({ world, shipId: ship.id });

  for (const tick of [5, 9, 13]) {
    world.tick = tick;
    item.rotation += 0.1;
    assert(
      replication
        .snapshot({ world, shipId: ship.id })
        .fullEntities.some((entity) => entity.id === item.id),
      'skipped modulo deadlines still replicate distant entities',
    );
  }
}
// Continuous collision detection must sweep the whole overdue movement span.
{
  const world = createWorld();
  const moving = addEntity(
    world,
    new GameObject({
      id: 1,
      position: Vec.create(-40),
      velocity: Vec.create(500),
      radius: 5,
      drag: 0,
      maxSpeed: 10000,
    }),
  );

  addEntity(
    world,
    new GameObject({
      id: 2,
      radius: 101,
      mass: 1e9,
      shapeOutline: [
        [-1, -100],
        [1, -100],
        [1, 100],
        [-1, 100],
      ],
    }),
  );
  updateWorld({ world, inputs: new Map(), dt: 0.1, ticks: 3 });
  assert(
    moving.position.x < 0,
    '100ms sweep cannot tunnel through a thin wall',
  );
}

// A stationary pilot need not occur in a delta packet: remote cadence still adapts.
{
  const motion = new RemoteMotion();
  const entity = {
    id: 2,
    kind: 'object' as const,
    position: Vec.create(),
    radius: 10,
    rotation: 0,
    spin: 0,
  };

  motion.receive({
    entities: [entity],
    entityIds: [2],
    shipId: 1,
    tick: 1,
    now: 0,
  });
  motion.receive({
    entities: [{ ...entity, position: Vec.create(10) }],
    entityIds: [2],
    shipId: 1,
    tick: 4,
    now: 100,
  });
  assert(
    Math.abs(motion.sample({ now: 150 }).get(2)!.position.x - 5) < 1e-9,
    'remote movement spans the whole 100ms packet interval without a local ship delta',
  );
}

// A batch must consume each queued tick and retain later input transitions.
{
  const queued = new GameSession({ worldSeed: 25 });

  Reflect.get(queued, 'regions').sync = () => {};
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send() {},
    close() {},
    terminate() {},
  } as unknown as WebSocket;

  queued.receive({ socket, message: { type: 'hello', playerToken: null } });
  const player = [...Reflect.get(queued, 'players').values()][0];

  for (const [tick, sequence, thrust] of [
    [1, 1, 1],
    [2, 2, 0],
    [4, 3, 1],
  ]) {
    queued.receive({
      socket,
      message: {
        type: 'input',
        tick,
        sequence,
        input: { ...emptyPlayerInput(), thrust },
        offset: 0.007,
      },
    });
  }
  queued.tick({ ticks: 3 });
  assert.equal(player.lastSequence, 2);
  assert.equal(player.ship.thrust, 0);
  assert(player.inputs.has(4), 'future transitions survive a catch-up batch');
  queued.tick({ ticks: 2 });
  assert.equal(player.lastSequence, 3);
  assert.equal(player.ship.thrust, 1);
}

let now = 0;
let session: GameSession;
const originalPerformance = globalThis.performance;

class Socket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  onopen?: () => void;
  onmessage?: ({ data }: { data: string }) => void;
  onclose?: ({ code }: { code: number }) => void;
  peer = {
    readyState: 1,
    bufferedAmount: 0,
    send: (data: string) => this.onmessage?.({ data }),
    close() {},
    terminate() {},
  };
  send(data: string) {
    const message = parseClientMessage(Buffer.from(data));

    assert(message);
    session.receive({ message, socket: this.peer as unknown as WebSocket });
  }
  close() {}
}
Object.assign(globalThis, {
  performance: { now: () => now },
  WebSocket: Socket,
  localStorage: { getItem: () => null, setItem() {} },
  location: { protocol: 'http:', host: 'test' },
});

try {
  const { NetworkClient } = await import('../src/client/network');

  for (const [interval, frameStep] of [
    [2, 1],
    [6, 1],
    [12, 1],
    [6, 6],
  ]) {
    now = 0;
    session = new GameSession({ worldSeed: 25 });
    // Isolate the real session/protocol/prediction clocks from random contacts.
    Reflect.get(session, 'regions').sync = () => {};
    const clients = Array.from(
      { length: 3 },
      () => new NetworkClient({ url: 'ws://test' }),
    );

    clients.forEach((client) =>
      (Reflect.get(client, 'socket') as Socket).onopen?.(),
    );
    await Promise.all(clients.map((client) => client.ready));
    const players = [...Reflect.get(session, 'players').values()];

    players.forEach((player, index) => {
      Vec.setXY(player.ship.position, index * 500, 0);
      Vec.setXY(player.ship.velocity, 100, 0);
      player.ship.drag = 0;
      player.socket.send(
        JSON.stringify(
          player.replication.initial({
            world: session.world,
            shipId: player.shipId,
          }),
        ),
      );
      // drag is a model property, not replicated; set it on both test worlds.
      clients[index].world.entities.forEach((entity) => {
        entity.drag = 0;
      });
    });
    const start = clients.map(
      (client) =>
        client.predictFrame({ now }).entities.get(client.shipId!)!.position.x,
    );
    const previous = [...start];
    let pausedFrames = 0,
      largestAdvance = 0,
      pausedRemoteFrames = 0;
    let previousRemote = 0;

    for (let frame = frameStep; frame <= 1800; frame += frameStep) {
      now = (frame * 1000) / 60;

      if (frame % interval === 0) session.tick({ ticks: interval / 2 });
      clients.forEach((client, index) => {
        client.updateFrame({
          input: emptyPlayerInput(),
          dt: frameStep / 60,
          now,
        });
        const x = client.predictFrame({ now }).entities.get(client.shipId!)!
          .position.x;

        if (frame > 60 && x - previous[index] < 0.01) pausedFrames++;

        if (frame > 60) {
          largestAdvance = Math.max(largestAdvance, x - previous[index]);
        }
        previous[index] = x;
      });
      const remote = clients[0].remoteMotion
        .sample({ now })
        .get(clients[1].shipId!)?.position.x;

      if (remote !== undefined) {
        if (frame > 60 && remote - previousRemote < 0.01) pausedRemoteFrames++;
        previousRemote = remote;
      }
    }
    assert.equal(
      session.world.tick,
      900,
      'server accounts for all elapsed time',
    );
    players.forEach((player) =>
      assert(
        Math.abs(
          player.ship.position.x - (players.indexOf(player) * 500 + 3000),
        ) < 0.01,
      ),
    );
    clients.forEach((client, index) =>
      assert(
        Math.abs(previous[index] - start[index] - 3000) < 10,
        'prediction advances at real-time speed',
      ),
    );
    assert(
      pausedFrames < 12,
      `clients must keep moving between ${interval / 60}s snapshots: ${pausedFrames} paused frames`,
    );
    assert(
      pausedRemoteFrames < 4,
      'remote ships interpolate continuously at the slower cadence',
    );
    console.log(
      JSON.stringify({
        pausedRemoteFrames,
        snapshotMs: (interval * 1000) / 60,
        clientFrameMs: (frameStep * 1000) / 60,
        serverTick: session.world.tick,
        pausedFrames,
        largestAdvance,
        clientTravel: previous.map((x, i) => x - start[i]),
      }),
    );
    // A lost connection still bounds prediction; pending releases still get sent.
    const client = clients[0];

    for (let i = 0; i < 120; i++) {
      now += 1000 / 60;
      client.updateFrame({ input: emptyPlayerInput(), dt: 1 / 60, now });
    }
    assert(client.world.tick <= client.serverTick + maxPredictionTicks);
  }
} finally {
  Object.assign(globalThis, { performance: originalPerformance });
}
console.log(
  'Elapsed-time movement, input edges, replication and 3-client stalled-server prediction passed',
);
