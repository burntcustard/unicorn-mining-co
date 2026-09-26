import * as Vec from '../src/shared/vector';
import { HornDrill } from '../src/shared/modules/horn-drill';
import { CargoHatch } from '../src/shared/modules/cargo-hatch';
import assert from 'node:assert/strict';
import { Ship } from '../src/shared/craft/ship';
import { Station } from '../src/shared/craft/station';
import { once } from 'node:events';
import WebSocket from 'ws';
import { GameServer } from '../src/server/game-server';
import { parseClientMessage } from '../src/server/parse-client-message';
import { createAsteroid } from '../src/shared/simulation/asteroid';
import { Item } from '../src/shared/items/item';
import {
  type ReplicatedEntity,
  type ServerMessage,
} from '../src/shared/protocol/network';
import {
  type PlayerInput,
  packPlayerInput,
  unpackPlayerInput,
} from '../src/shared/protocol/input';
import { addEntity } from '../src/shared/simulation/world';
import { rotatePoint } from '../src/shared/geometry';
import { simulationStep } from '../src/shared/settings';
import { moduleTypes } from '../src/shared/modules';
import { colors, paintColors } from '../src/shared/colors';

const inputPacket = ({
  tick,
  sequence,
  input,
  offset,
}: {
  type: 'input';
  tick: number;
  sequence: number;
  input: number;
  offset?: number;
}) =>
  JSON.stringify(
    offset === undefined
      ? [tick, sequence, input]
      : [tick, sequence, input, offset],
  );

// Every valid control combination must survive its packed wire representation.
for (let code = 0; code < 192; code++) {
  assert.equal(packPlayerInput(unpackPlayerInput(code)), code);
}

for (const code of [-1, 192, 256, 1.5, '1', null]) {
  assert.equal(
    parseClientMessage(Buffer.from(JSON.stringify([1, 1, code]))),
    undefined,
  );
}

for (const message of [
  [-1, 1, 0],
  [1, -1, 0],
  [1, 1.5, 0],
  [1, 1, 0, -0.1],
  [1, 1, 0, simulationStep],
  { type: 'hello', playerToken: 'not-a-token' },
  { type: 'dock', action: 'sell', objectIds: ['bad'] },
  { type: 'dock', action: 'buy', module: 1, moduleId: null },
]) {
  assert.equal(
    parseClientMessage(Buffer.from(JSON.stringify(message))),
    undefined,
  );
}

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
    setInterval: () => 2,
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
}) => {
  const records = new Map<number, ReplicatedEntity>();

  return socket.on('message', (data) => {
    const serialized = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : Buffer.from(
          data instanceof ArrayBuffer ? new Uint8Array(data) : data,
        ).toString('utf8');
    const message = JSON.parse(serialized) as ServerMessage;

    if (message.type === 'load') records.clear();

    if (message.type === 'load' || message.type === 'snapshot') {
      message.fullEntities = message.fullEntities.map((record) => {
        const full = { ...records.get(record.id), ...record };

        Object.entries(record).forEach(([key, value]) => {
          if (value === null) delete (full as Record<string, unknown>)[key];
        });
        records.set(record.id, full);
        return full;
      });
      message.entityIds ??= [...records.keys()];
      records.forEach((_, id) => {
        if (!message.entityIds!.includes(id)) records.delete(id);
      });
    }
    messages.push(message);
  });
};

const server = new GameServer({ port: 0, worldSeed: 8675309 });
const listener = server.start();

await once(listener, 'listening');
const address = listener.address();

assert(address && typeof address !== 'string');
const socket = new WebSocket(`ws://127.0.0.1:${address.port}/game-socket`);
const messages: ServerMessage[] = [];

collect({ messages, socket });
await once(socket, 'open');

for (const payload of ['{', 'null']) {
  const invalidSocket: WebSocket = new WebSocket(
    `ws://127.0.0.1:${address.port}/game-socket`,
  );

  await once(invalidSocket, 'open');
  invalidSocket.send(payload);
  const code = await new Promise<number>((resolve) =>
    invalidSocket.once('close', (closeCode) => resolve(closeCode)),
  );

  assert.equal(code, 1007);
}

const wrongOrigin = new WebSocket(
  `ws://127.0.0.1:${address.port}/game-socket`,
  { origin: 'https://elsewhere.example' },
);

await assert.rejects(once(wrongOrigin, 'open'));
const oversized = new WebSocket(`ws://127.0.0.1:${address.port}/game-socket`);

await once(oversized, 'open');
oversized.send('x'.repeat(33000));
const [limitCode] = await once(oversized, 'close');

assert.equal(limitCode, 1009);

socket.send(JSON.stringify({ playerToken: null, type: 'hello' }));

const welcome = await waitFor({ messages, type: 'welcome' });
const load = await waitFor({ messages, type: 'load' });

assert.equal(welcome.type, 'welcome');
assert.equal(welcome.worldSeed, 8675309);
assert(Number.isInteger(welcome.spawn.x));
assert(Number.isInteger(welcome.spawn.y));
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
const invalidControlSocket = new WebSocket(
  `ws://127.0.0.1:${address.port}/game-socket`,
);
const invalidControlMessages: ServerMessage[] = [];

collect({ messages: invalidControlMessages, socket: invalidControlSocket });
await once(invalidControlSocket, 'open');
invalidControlSocket.send(JSON.stringify({ playerToken: null, type: 'hello' }));
const invalidControlWelcome = await waitFor({
  messages: invalidControlMessages,
  type: 'welcome',
});

assert.equal(invalidControlWelcome.type, 'welcome');
const invalidControlShip = server.world.entities.get(
  invalidControlWelcome.shipId,
);

assert(invalidControlShip instanceof Ship);
const invalidInputTick = server.world.tick + 3;
const invalidControlClose = new Promise<number>((resolve) =>
  invalidControlSocket.once('close', (code) => resolve(code)),
);

invalidControlSocket.send(
  inputPacket({
    type: 'input',
    sequence: 1,
    tick: invalidInputTick,
    input: 256,
  }),
);
assert.equal(await invalidControlClose, 1007);
await waitUntil({ condition: () => server.world.tick > invalidInputTick });
assert(
  [
    invalidControlShip.position.x,
    invalidControlShip.position.y,
    invalidControlShip.velocity.x,
    invalidControlShip.velocity.y,
  ].every(Number.isFinite),
  'invalid controls cannot introduce non-finite ship state',
);

socket.send(
  inputPacket({
    input: packPlayerInput({
      hornDrill: true,
      cargoHatch: false,
      searchLight: false,
      shieldGenerator: false,
      launch: false,
      thrust: 0,
      turn: 0,
    }),
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
    shapeOutline: [
      [25, 0],
      [-25, 25],
      [-25, -25],
    ],
    // Touch the deployed horn drill, rather than spawning a rock inside the hull.
    position: Vec.add(
      playerShip.position,
      rotatePoint(Vec.create(70), playerShip.rotation),
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
socket.send(
  inputPacket({
    input: packPlayerInput({
      hornDrill: false,
      cargoHatch: true,
      searchLight: false,
      shieldGenerator: false,
      launch: false,
      thrust: 0,
      turn: 0,
    }),
    sequence: 2,
    tick: server.world.tick,
    type: 'input',
  }),
);
await waitUntil({
  condition: () =>
    playerShip
      .hitbox()
      .some((collider) => collider.role === 'cargoHatch' && collider.collides),
});
const activeMouth = playerShip
  .hitbox()
  .find((collider) => collider.role === 'cargoHatch' && collider.collides);

assert(activeMouth);
Vec.set(item.position, activeMouth.position);
Vec.set(item.velocity, playerShip.velocity);
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
  inputPacket({
    input: packPlayerInput({
      hornDrill: false,
      cargoHatch: false,
      searchLight: false,
      shieldGenerator: false,
      launch: false,
      thrust: 1,
      turn: 0,
    }),
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
  inputPacket({
    type: 'input',
    sequence: 4,
    tick: server.world.tick + 6,
    input: packPlayerInput({
      hornDrill: false,
      cargoHatch: false,
      searchLight: false,
      shieldGenerator: false,
      launch: false,
      thrust: 1,
      turn: 1,
    }),
  }),
);
socket.send(
  inputPacket({
    type: 'input',
    sequence: 5,
    tick: server.world.tick,
    input: packPlayerInput({
      hornDrill: false,
      cargoHatch: false,
      searchLight: false,
      shieldGenerator: false,
      launch: false,
      thrust: 0,
      turn: 0,
    }),
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
    inputPacket({
      type: 'input',
      tick: tapTick,
      sequence,
      offset,
      input: packPlayerInput({
        hornDrill: false,
        cargoHatch: false,
        searchLight: false,
        shieldGenerator: false,
        launch: false,
        thrust,
        turn: 0,
      }),
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
  Vec.length(playerShip.velocity) > 0.1,
  'the preceding short press was not overwritten',
);

const stationEntity = startingStation;

assert(stationEntity);
const authoritativeShip = server.world.entities.get(welcome.shipId);

assert(authoritativeShip instanceof Ship);
Vec.set(
  authoritativeShip.position,
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

// Buy, equip, and paint actions use the same ship rules as the docked menu.
const purchasedId = 999998;
const creditsBeforePurchase = authoritativeShip.credits;

socket.send(
  JSON.stringify({
    type: 'dock',
    action: 'buy',
    module: moduleTypes.indexOf(CargoHatch),
    moduleId: purchasedId,
  }),
);
await waitUntil({
  condition: () =>
    authoritativeShip.cargoContents.some(({ id }) => id === purchasedId),
});
assert.equal(
  authoritativeShip.credits,
  creditsBeforePurchase - CargoHatch.price,
);
socket.send(
  JSON.stringify({
    type: 'dock',
    action: 'equip',
    moduleId: purchasedId,
    mount: hatchMount,
  }),
);
await waitUntil({
  condition: () => {
    const fitted = authoritativeShip.mounts[hatchMount].module;

    return fitted instanceof CargoHatch && fitted.id === purchasedId;
  },
});
socket.send(
  JSON.stringify({
    type: 'dock',
    action: 'paint',
    moduleId: purchasedId,
    mount: hatchMount,
    paint: paintColors.indexOf(colors.orange),
  }),
);
await waitUntil({
  condition: () => {
    const fitted = authoritativeShip.mounts[hatchMount].module;

    return fitted instanceof CargoHatch && fitted.shades === colors.orange;
  },
});
socket.send(
  JSON.stringify({
    type: 'dock',
    action: 'paint',
    paint: paintColors.indexOf(colors.red),
  }),
);
await waitUntil({
  condition: () => authoritativeShip.shades === colors.red,
});

// Repairs must reach the authoritative ship, charge once, and appear in its
// next snapshot. A stale module ID cannot repair a different fitted module.
const repairMountIndex = authoritativeShip.mounts.findIndex(
  ({ module }) => module,
);

assert(repairMountIndex >= 0);
const repairMount = authoritativeShip.mounts[repairMountIndex];
const repairModule = repairMount.module;

assert(repairModule);
repairMount.health = repairModule.health - 1.11111;
const moduleRepairCost = repairModule.health - (repairMount.health | 0);
const beforeModuleRepair = authoritativeShip.credits;

socket.send(
  JSON.stringify({
    type: 'dock',
    action: 'repair',
    moduleId: 999999,
    mount: repairMountIndex,
  }),
);
await new Promise((resolve) => setTimeout(resolve, 70));
assert.equal(repairMount.health, repairModule.health - 1.11111);
assert.equal(authoritativeShip.credits, beforeModuleRepair);
socket.send(
  JSON.stringify({
    type: 'dock',
    action: 'repair',
    moduleId: repairModule.id,
    mount: repairMountIndex,
  }),
);
await waitUntil({
  condition: () =>
    repairMount.health === repairModule.health &&
    authoritativeShip.credits === beforeModuleRepair - moduleRepairCost,
});
await waitUntil({
  condition: () =>
    messages.some(
      (message) =>
        message.type === 'snapshot' &&
        message.fullEntities.some(
          (entity) =>
            entity.id === welcome.shipId &&
            entity.credits === authoritativeShip.credits &&
            entity.modules?.some(
              ({ mount, health }) =>
                mount === repairMountIndex && health === repairModule.health,
            ),
        ),
    ),
});
socket.send(
  JSON.stringify({
    type: 'dock',
    action: 'repair',
    moduleId: repairModule.id,
    mount: repairMountIndex,
  }),
);
await new Promise((resolve) => setTimeout(resolve, 70));
assert.equal(authoritativeShip.credits, beforeModuleRepair - moduleRepairCost);

const damagedHull = authoritativeShip.segments.find(
  ({ hull, health }) => hull && health > 2,
);

assert(damagedHull);
damagedHull.health -= 1.11111;
const hullHealth = authoritativeShip.segments
  .filter(({ hull }) => hull)
  .reduce((total, segment) => total + segment.health, 0);
const hullMaxHealth = authoritativeShip.hullSegments.reduce(
  (total, segment) => total + (segment.health ?? 0),
  0,
);
const hullRepairCost = hullMaxHealth - (hullHealth | 0);
const beforeHullRepair = authoritativeShip.credits;

socket.send(JSON.stringify({ type: 'dock', action: 'repair' }));
await waitUntil({
  condition: () =>
    damagedHull.health === damagedHull.module.health &&
    authoritativeShip.credits === beforeHullRepair - hullRepairCost,
});
await waitUntil({
  condition: () =>
    messages.some(
      (message) =>
        message.type === 'snapshot' &&
        message.fullEntities.some(
          (entity) =>
            entity.id === welcome.shipId &&
            entity.credits === authoritativeShip.credits &&
            entity.hullHealth?.every(
              (health, index) => health === authoritativeShip.hullHealth[index],
            ),
        ),
    ),
});
socket.send(JSON.stringify({ type: 'dock', action: 'repair' }));
await new Promise((resolve) => setTimeout(resolve, 70));
assert.equal(authoritativeShip.credits, beforeHullRepair - hullRepairCost);

socket.send(
  inputPacket({
    input: packPlayerInput({
      hornDrill: false,
      cargoHatch: false,
      launch: true,
      searchLight: false,
      shieldGenerator: false,
      thrust: 0,
      turn: 0,
    }),
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

let secondSocket = new WebSocket(`ws://127.0.0.1:${address.port}/game-socket`);
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
  inputPacket({
    input: packPlayerInput({
      hornDrill: true,
      cargoHatch: false,
      searchLight: true,
      shieldGenerator: false,
      launch: false,
      thrust: 1,
      turn: 1,
    }),
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
    const disconnectSnapshotStart = messages.length;

    previousSocket.close();
    await previousClosed;
    assert.equal(
      server.world.entities.has(secondWelcome.shipId),
      false,
      'a disconnected ship is removed immediately',
    );
    assert.equal(server.world.players.has(secondWelcome.playerId), false);
    await waitUntil({
      condition: () =>
        messages
          .slice(disconnectSnapshotStart)
          .some(
            (message) =>
              message.type === 'snapshot' &&
              !!message.entityIds &&
              !message.entityIds.includes(secondWelcome.shipId),
          ),
    });
  }

  secondSocket = new WebSocket(`ws://127.0.0.1:${address.port}/game-socket`);
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
  assert(Number.isInteger(reconnectWelcome.spawn.x));
  assert(Number.isInteger(reconnectWelcome.spawn.y));
  assert.equal(reconnectLoad.type, 'load');
  assert.equal(reconnectLoad.acknowledgedSequence, 0);
  assert(server.world.entities.has(secondWelcome.shipId));
  assert(server.world.players.has(secondWelcome.playerId));
  secondSocket.send(
    inputPacket({
      type: 'input',
      sequence: 1,
      tick: server.world.tick,
      input: packPlayerInput({
        launch: false,
        thrust: 1,
        turn: -1,
        cargoHatch: true,
        searchLight: true,
        hornDrill: false,
        shieldGenerator: false,
      }),
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

// A socket with no input for five minutes is closed and its ship disappears.
const idleSocket = new WebSocket(`ws://127.0.0.1:${address.port}/game-socket`);
const idleMessages: ServerMessage[] = [];

collect({ messages: idleMessages, socket: idleSocket });
await once(idleSocket, 'open');
idleSocket.send(JSON.stringify({ playerToken: null, type: 'hello' }));
const idleWelcome = await waitFor({ messages: idleMessages, type: 'welcome' });

assert.equal(idleWelcome.type, 'welcome');
const session = Reflect.get(server, 'session');
const playerRecords = Reflect.get(session, 'players') as Map<
  string,
  { lastInputAt: number; lastInput: PlayerInput }
>;
const idleRecord = playerRecords.get(idleWelcome.playerToken);

assert(idleRecord);
// Unchanged held movement must not be mistaken for five minutes of inactivity.

for (const movement of ['thrust', 'turn'] as const) {
  idleRecord.lastInput[movement] = 1;
  idleRecord.lastInputAt = Date.now() - 5 * 60 * 1000 - 1000;
  server.world.tick = Math.ceil(server.world.tick / 30) * 30;
  session.tick();
  assert.equal(idleSocket.readyState, WebSocket.OPEN);
  assert(idleRecord.lastInputAt > Date.now() - 1000);
  idleRecord.lastInput[movement] = 0;
}
// Latched module switches must not keep an unattended player connected.
idleRecord.lastInput.searchLight = true;
idleRecord.lastInputAt = Date.now() - 5 * 60 * 1000 - 1000;
const [idleCloseCode] = await once(idleSocket, 'close');

assert.equal(idleCloseCode, 4002);
assert.equal(server.world.entities.has(idleWelcome.shipId), false);
assert.equal(server.world.players.has(idleWelcome.playerId), false);

// A lost ship keeps receiving world updates until its pilot requests a new one.
const deathPosition = Vec.add(playerShip.position, Vec.create());
const nearestStation = [...server.world.entities.values()]
  .filter((entity): entity is Station => entity instanceof Station)
  .sort(
    (a, b) =>
      Vec.distance(a.position, deathPosition) -
      Vec.distance(b.position, deathPosition),
  )[0];
const deathMessageStart = messages.length;

assert(nearestStation);
playerShip.remove();
await waitUntil({
  condition: () =>
    messages
      .slice(deathMessageStart)
      .some(
        (message) =>
          message.type === 'snapshot' &&
          !message.entityIds!.includes(welcome.shipId) &&
          message.entityIds!.includes(nearestStation.id),
      ),
});
const deathSnapshot = messages
  .slice(deathMessageStart)
  .find(
    (message) =>
      message.type === 'snapshot' &&
      !message.entityIds!.includes(welcome.shipId),
  );

assert(deathSnapshot?.type === 'snapshot');
await waitUntil({
  condition: () =>
    messages
      .slice(deathMessageStart)
      .some(
        (message) =>
          message.type === 'snapshot' &&
          message.serverTick > deathSnapshot.serverTick,
      ),
});
socket.send(JSON.stringify({ type: 'respawn' }));
await waitUntil({
  condition: () =>
    messages.slice(deathMessageStart).some(({ type }) => type === 'respawn'),
});
const respawnMessage = messages
  .slice(deathMessageStart)
  .find((message) => message.type === 'respawn');

assert(respawnMessage?.type === 'respawn');
assert.notEqual(respawnMessage.shipId, welcome.shipId);
await waitUntil({
  condition: () =>
    messages
      .slice(deathMessageStart)
      .some(
        (message) =>
          message.type === 'load' &&
          message.entityIds!.includes(respawnMessage.shipId),
      ),
});
const respawned = server.world.entities.get(respawnMessage.shipId);

assert(respawned instanceof Ship);
assert.equal(server.world.players.get(welcome.playerId)?.shipId, respawned.id);
assert.equal(respawned.dockedTo, nearestStation.id);
assert.equal(respawned.credits, 500);
assert(Vec.distance(respawned.position, nearestStation.position) < 1);

const closed = Promise.all([
  once(socket, 'close'),
  once(secondSocket, 'close'),
]);

socket.close();
secondSocket.close();
await closed;
await server.stop();
console.log('server integration test passed');
