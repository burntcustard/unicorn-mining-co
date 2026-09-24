import { HornDrill } from '../src/shared/modules/horn-drill';
import { CargoHatch } from '../src/shared/modules/cargo-hatch';
import assert from 'node:assert/strict';
import { Ship } from '../src/shared/craft/ship';
import { once } from 'node:events';
import WebSocket from 'ws';
import { GameServer } from '../src/server/game-server';
import { createAsteroid } from '../src/shared/simulation/asteroid';
import { Item } from '../src/shared/items/item';
import { type ServerMessage } from '../src/shared/protocol/network';
import { addEntity } from '../src/shared/simulation/world';
import { Vector } from '../src/shared/vector';
import { rotatePoint } from '../src/shared/geometry';
import { simulationStep } from '../src/shared/simulation/update-tier';

// Integer-millisecond timer delays must not turn 30 Hz into 30.303 Hz.
{
  const original = {
    performance: globalThis.performance,
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    clearTimeout: globalThis.clearTimeout,
    clearInterval: globalThis.clearInterval,
  };
  let now = 0;
  let pending: { callback: () => void; delay: number };
  const schedule = (callback: () => void, delay: number) => {
    pending = { callback, delay: Math.max(1, Math.trunc(delay)) };
    return 1;
  };
  const timed = new GameServer({ port: 0 });

  Object.assign(globalThis, {
    performance: { now: () => now },
    setTimeout: schedule,
    setInterval: schedule,
    clearTimeout() {},
    clearInterval() {},
  });

  try {
    timed.start();

    for (let tick = 1; tick <= 1000; tick++) {
      now += pending!.delay;
      pending!.callback();
      assert(
        Math.abs(now - tick * simulationStep * 1000) <= 1.001,
        'server deadlines must not accumulate timer rounding or processing costs',
      );
      // Include variable simulation/scheduling overhead between callbacks.
      const cost = tick % 3;

      now += cost;
      pending!.delay -= cost;
    }
    now += 1000;
    pending!.callback();
    assert(pending!.delay >= 1, 'a stall must not schedule a catch-up storm');
  } finally {
    await timed.stop();
    Object.assign(globalThis, original);
  }
}

const waitFor = async ({
  messages,
  type,
}: {
  messages: ServerMessage[];
  type: ServerMessage['type'];
}) => {
  const started = Date.now();

  while (Date.now() - started < 2000) {
    const message = messages.find((candidate) => candidate.type === type);

    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw Error(`Timed out waiting for ${type}`);
};

const waitUntil = async ({
  condition,
  timeout = 2000,
}: {
  condition: () => boolean;
  timeout?: number;
}) => {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw Error('Timed out waiting for condition');
};

const collect = ({
  socket,
  messages,
}: {
  socket: WebSocket;
  messages: ServerMessage[];
}) =>
  socket.on('message', (data) => {
    const serialized = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : Buffer.from(
          data instanceof ArrayBuffer ? new Uint8Array(data) : data,
        ).toString('utf8');

    messages.push(JSON.parse(serialized) as ServerMessage);
  });

const server = new GameServer({ port: 0, worldSeed: 8675309 });
const listener = server.start();

await once(listener, 'listening');
const address = listener.address();

assert(address && typeof address !== 'string');
const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
const messages: ServerMessage[] = [];

collect({ messages, socket });
await once(socket, 'open');
socket.send(JSON.stringify({ playerToken: null, type: 'hello' }));

const welcome = await waitFor({ messages, type: 'welcome' });
const load = await waitFor({ messages, type: 'load' });

assert.equal(welcome.type, 'welcome');
assert.equal(welcome.worldSeed, 8675309);
assert.equal(load.type, 'load');
assert(load.fullEntities.some(({ id }) => id === welcome.shipId));
assert(load.fullEntities.some(({ kind }) => kind === 'asteroid'));
assert(load.fullEntities.some(({ kind }) => kind === 'station'));
const startingStation = load.fullEntities
  .filter(({ kind }) => kind === 'station')
  .sort(
    (a, b) =>
      Math.hypot(
        a.position.x - welcome.spawn.x,
        a.position.y - welcome.spawn.y,
      ) -
      Math.hypot(
        b.position.x - welcome.spawn.x,
        b.position.y - welcome.spawn.y,
      ),
  )[0];

assert(startingStation);
assert(
  Math.hypot(
    welcome.spawn.x - startingStation.position.x,
    welcome.spawn.y - startingStation.position.y,
  ) > 600,
);

const playerShip = server.world.entities.get(welcome.shipId);

assert(playerShip instanceof Ship);
server.world.entities.forEach((entity) => {
  if (entity.kind === 'asteroid') server.world.entities.delete(entity.id);
});
await new Promise((resolve) => setTimeout(resolve, 50));
socket.send(
  JSON.stringify({
    input: {
      hornDrill: true,
      cargoHatch: false,
      searchLight: false,
      shieldGenerator: false,
      thrust: 0,
      turn: 0,
    },
    sequence: 1,
    tick: server.world.tick,
    type: 'input',
  }),
);
await waitUntil({
  condition: () =>
    playerShip.segments.some(
      (segment) =>
        segment.module instanceof HornDrill && segment.activationProgress > 0.5,
    ),
});
const asteroid = addEntity(
  server.world,
  createAsteroid(server.world, {
    contents: [0],
    health: 0.5,
    outline: [
      [25, 0],
      [-25, 25],
      [-25, -25],
    ],
    // Touch the deployed horn drill, rather than spawning a rock inside the hull.
    position: playerShip.position.add(
      rotatePoint(Vector(70), playerShip.rotation),
    ),
    rotation: playerShip.rotation,
    radius: 25,
  }),
);

await waitUntil({
  condition: () => !server.world.entities.has(asteroid.id),
  timeout: 5000,
});
const item = [...server.world.entities.values()].find(
  (entity): entity is Item => entity instanceof Item && entity.resource === 0,
);

assert(item);
item.position.set(
  playerShip.position.add(rotatePoint(Vector(3, -13), playerShip.rotation)),
);
item.velocity.set(Vector());
socket.send(
  JSON.stringify({
    input: {
      hornDrill: false,
      cargoHatch: true,
      searchLight: false,
      shieldGenerator: false,
      thrust: 0,
      turn: 0,
    },
    sequence: 2,
    tick: server.world.tick,
    type: 'input',
  }),
);
await waitUntil({
  condition: () => {
    const current = server.world.entities.get(welcome.shipId);

    return (
      current instanceof Ship &&
      current.cargoContents.some((item) => item.resource === 0)
    );
  },
});

socket.send(
  JSON.stringify({
    input: {
      hornDrill: false,
      cargoHatch: false,
      searchLight: false,
      shieldGenerator: false,
      thrust: 1,
      turn: 0,
    },
    sequence: 3,
    tick: server.world.tick,
    type: 'input',
  }),
);

await new Promise((resolve) => setTimeout(resolve, 350));
const snapshots = messages.filter(({ type }) => type === 'snapshot');
const latest = snapshots.at(-1);

assert(latest?.type === 'snapshot');
assert.equal(
  snapshots.filter(
    (snapshot) =>
      snapshot.type === 'snapshot' && snapshot.inputLead !== undefined,
  ).length,
  3,
  'each of the three inputs reports its timing once, not on every snapshot',
);
assert.equal(latest.inputLead, undefined);
const ship = latest.fullEntities.find(({ id }) => id === welcome.shipId);

assert(ship);
assert.notDeepEqual(ship.position, welcome.spawn);
assert(latest.serverTick > welcome.serverTick);

// A resynchronised client can send a newer input for an earlier tick. The
// older future input must not take the controls back when that tick arrives.
socket.send(
  JSON.stringify({
    type: 'input',
    sequence: 4,
    tick: server.world.tick + 6,
    input: {
      hornDrill: false,
      cargoHatch: false,
      searchLight: false,
      shieldGenerator: false,
      thrust: 1,
      turn: 1,
    },
  }),
);
socket.send(
  JSON.stringify({
    type: 'input',
    sequence: 5,
    tick: server.world.tick,
    input: {
      hornDrill: false,
      cargoHatch: false,
      searchLight: false,
      shieldGenerator: false,
      thrust: 0,
      turn: 0,
    },
  }),
);
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(
  playerShip.thrust,
  0,
  'newer input supersedes a previously queued future input',
);
assert.equal(playerShip.turn, 0);

const tapTick = server.world.tick + 3;

for (const { sequence, offset, thrust } of [
  { sequence: 6, offset: 0.005, thrust: 1 },
  { sequence: 7, offset: 0.015, thrust: 0 },
]) {
  socket.send(
    JSON.stringify({
      type: 'input',
      tick: tapTick,
      sequence,
      offset,
      input: {
        hornDrill: false,
        cargoHatch: false,
        searchLight: false,
        shieldGenerator: false,
        launch: false,
        thrust,
        turn: 0,
      },
    }),
  );
}
await waitUntil({
  condition: () =>
    messages.some(
      (message) =>
        message.type === 'snapshot' && message.acknowledgedSequence === 7,
    ),
});
assert.equal(playerShip.thrust, 0, 'a within-tick release stops thrust');
assert(
  playerShip.velocity.length() > 0.1,
  'the preceding short press was not overwritten',
);

const stationEntity = startingStation;

assert(stationEntity);
const authoritativeShip = server.world.entities.get(welcome.shipId);

assert(authoritativeShip instanceof Ship);
authoritativeShip.position.set(
  server.world.entities.get(stationEntity.id)!.position,
);
authoritativeShip.dockedTo = stationEntity.id;

// Selling a cargo module and item must change the authoritative ship once.
// Repeating a sale cannot mint credits after the object has left cargo.
const hatchMount = authoritativeShip.mounts.findIndex(
  ({ module }) => module instanceof CargoHatch,
);

assert(hatchMount >= 0);
const hatchModule = authoritativeShip.mounts[hatchMount].module;

assert(hatchModule instanceof CargoHatch);
const hatchId = hatchModule.id;
const startingCredits = authoritativeShip.credits;

assert(
  load.fullEntities
    .find(({ id }) => id === welcome.shipId)
    ?.modules?.some(({ id }) => id === hatchId),
  'mounted module IDs reach the client before they can be sold',
);
socket.send(
  JSON.stringify({ type: 'dock', action: 'remove', mount: hatchMount }),
);
await waitUntil({
  condition: () =>
    authoritativeShip.cargoContents.some(({ id }) => id === hatchId),
});
socket.send(
  JSON.stringify({ type: 'dock', action: 'sell', objectIds: [hatchId] }),
);
await waitUntil({
  condition: () =>
    authoritativeShip.credits === startingCredits + CargoHatch.price,
});
assert(!authoritativeShip.cargoContents.some(({ id }) => id === hatchId));
socket.send(
  JSON.stringify({ type: 'dock', action: 'sell', objectIds: [hatchId] }),
);
await new Promise((resolve) => setTimeout(resolve, 70));
assert.equal(
  authoritativeShip.credits,
  startingCredits + CargoHatch.price,
  'duplicate sale does not pay twice',
);
const soldItem = authoritativeShip.cargoContents.find(
  (object): object is Item => object instanceof Item && object.resource === 0,
);

assert(soldItem);
socket.send(
  JSON.stringify({
    type: 'dock',
    action: 'sell',
    objectIds: [soldItem.id, 999999],
  }),
);
await new Promise((resolve) => setTimeout(resolve, 70));
assert(authoritativeShip.cargoContents.includes(soldItem));
assert.equal(authoritativeShip.credits, startingCredits + CargoHatch.price);
socket.send(
  JSON.stringify({ type: 'dock', action: 'sell', objectIds: [soldItem.id] }),
);
await waitUntil({
  condition: () =>
    authoritativeShip.credits ===
    startingCredits + CargoHatch.price + soldItem.price,
});
assert(!authoritativeShip.cargoContents.some(({ id }) => id === soldItem.id));
await waitUntil({
  condition: () =>
    messages.some(
      (message) =>
        message.type === 'snapshot' &&
        message.fullEntities.some(
          (entity) =>
            entity.id === welcome.shipId &&
            entity.credits === authoritativeShip.credits,
        ),
    ),
});

socket.send(
  JSON.stringify({
    input: {
      hornDrill: false,
      cargoHatch: false,
      launch: true,
      searchLight: false,
      shieldGenerator: false,
      thrust: 0,
      turn: 0,
    },
    sequence: 8,
    tick: server.world.tick,
    type: 'input',
  }),
);
await waitUntil({
  condition: () =>
    messages.some(
      (message) =>
        message.type === 'snapshot' &&
        message.fullEntities.some(
          ({ id, dockedTo }) => id === welcome.shipId && dockedTo === undefined,
        ),
    ),
});

let secondSocket = new WebSocket(`ws://127.0.0.1:${address.port}`);
const secondMessages: ServerMessage[] = [];

collect({ messages: secondMessages, socket: secondSocket });
await once(secondSocket, 'open');
secondSocket.send(JSON.stringify({ playerToken: null, type: 'hello' }));
const secondWelcome = await waitFor({
  messages: secondMessages,
  type: 'welcome',
});

assert.equal(secondWelcome.type, 'welcome');
await waitUntil({
  condition: () =>
    messages.some(
      (message) =>
        message.type === 'snapshot' &&
        message.fullEntities.some(
          ({ playerId }) => playerId === secondWelcome.playerId,
        ),
    ),
});
secondSocket.send(
  JSON.stringify({
    input: {
      hornDrill: true,
      cargoHatch: false,
      searchLight: true,
      shieldGenerator: false,
      thrust: 1,
      turn: 1,
    },
    sequence: 1,
    tick: server.world.tick,
    type: 'input',
  }),
);
await waitUntil({
  condition: () =>
    messages.some(
      (message) =>
        message.type === 'snapshot' &&
        message.fullEntities.some(
          (entity) =>
            entity.playerId === secondWelcome.playerId &&
            entity.modules?.some(
              ({ type, segments }) =>
                type === 6 && segments.some((segment) => segment.active),
            ) &&
            entity.modules?.some(
              ({ type, segments }) =>
                type === 5 && segments.some((segment) => segment.active),
            ) &&
            entity.thrust === 1 &&
            entity.turn === 1,
        ),
    ),
});
assert.equal(
  messages.some(({ type }) => (type as string) === 'remoteInput'),
  false,
);

// Both a reconnect after disconnecting and a live connection takeover start
// a new input sequence, while keeping the same player and ship.
for (const disconnectFirst of [true, false]) {
  const previousSocket = secondSocket;
  const previousClosed = once(previousSocket, 'close');

  if (disconnectFirst) {
    previousSocket.close();
    await previousClosed;
  }

  secondSocket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const reconnectMessages: ServerMessage[] = [];

  collect({ messages: reconnectMessages, socket: secondSocket });
  await once(secondSocket, 'open');
  secondSocket.send(
    JSON.stringify({ playerToken: secondWelcome.playerToken, type: 'hello' }),
  );
  const reconnectWelcome = await waitFor({
    messages: reconnectMessages,
    type: 'welcome',
  });
  const reconnectLoad = await waitFor({
    messages: reconnectMessages,
    type: 'load',
  });

  await previousClosed;
  assert.equal(reconnectWelcome.type, 'welcome');
  assert.equal(reconnectWelcome.playerId, secondWelcome.playerId);
  assert.equal(reconnectWelcome.shipId, secondWelcome.shipId);
  assert.equal(reconnectLoad.type, 'load');
  assert.equal(reconnectLoad.acknowledgedSequence, 0);
  secondSocket.send(
    JSON.stringify({
      type: 'input',
      sequence: 1,
      tick: server.world.tick,
      input: {
        thrust: 1,
        turn: -1,
        cargoHatch: true,
        searchLight: true,
        hornDrill: false,
        shieldGenerator: false,
      },
    }),
  );
  await waitUntil({
    condition: () =>
      reconnectMessages.some(
        (message) =>
          message.type === 'snapshot' &&
          message.acknowledgedSequence === 1 &&
          message.fullEntities.some(
            (entity) =>
              entity.id === secondWelcome.shipId &&
              entity.thrust === 1 &&
              entity.turn === -1 &&
              entity.modules?.some(
                ({ type, segments }) =>
                  type === 5 && segments.some((segment) => segment.active),
              ) &&
              entity.modules?.some(
                ({ type, segments }) =>
                  type === 4 && segments.some((segment) => segment.active),
              ),
          ),
      ),
  });
}

const closed = Promise.all([
  once(socket, 'close'),
  once(secondSocket, 'close'),
]);

socket.close();
secondSocket.close();
await closed;
await server.stop();
console.log('server integration test passed');
