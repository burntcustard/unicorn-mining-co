import { Horn } from '../src/shared/modules/horn';
import assert from 'node:assert/strict';
import { Ship } from '../src/shared/craft/ship';
import { once } from 'node:events';
import WebSocket from 'ws';
import { GameServer } from '../src/server/game-server';
import { createAsteroid } from '../src/shared/simulation/asteroid';
import { Item } from '../src/shared/items/item';
import { type ServerMessage } from '../src/shared/protocol/network';
import { protocolVersion } from '../src/shared/protocol/network';
import { addEntity } from '../src/shared/simulation/world';
import { Vector } from '../src/shared/vector';

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
socket.send(
  JSON.stringify({ playerToken: null, protocolVersion, type: 'hello' }),
);

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

assert(playerShip?.kind === 'ship');
server.world.entities.forEach((entity) => {
  if (entity.kind === 'asteroid') server.world.entities.delete(entity.id);
});
await new Promise((resolve) => setTimeout(resolve, 50));
socket.send(
  JSON.stringify({
    input: {
      drill: true,
      hatch: false,
      light: false,
      shield: false,
      thrust: 0,
      turn: 0,
    },
    sequence: 1,
    tick: server.world.tick,
    type: 'input',
  }),
);
await waitUntil({
  condition: () => playerShip.moduleActive({ module: Horn }),
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
    position: playerShip.position.add(Vector(55)),
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
item.position.set(playerShip.position.add(Vector(3, -13)));
item.velocity.set(Vector());
socket.send(
  JSON.stringify({
    input: {
      drill: false,
      hatch: true,
      light: false,
      shield: false,
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
      drill: false,
      hatch: false,
      light: false,
      shield: false,
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
      drill: false,
      hatch: false,
      light: false,
      shield: false,
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
      drill: false,
      hatch: false,
      light: false,
      shield: false,
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

const stationEntity = startingStation;

assert(stationEntity);
const authoritativeShip = server.world.entities.get(welcome.shipId);

assert(authoritativeShip?.kind === 'ship');
authoritativeShip.position.set(
  server.world.entities.get(stationEntity.id)!.position,
);
authoritativeShip.dockedTo = stationEntity.id;
socket.send(
  JSON.stringify({
    input: {
      drill: false,
      hatch: false,
      launch: true,
      light: false,
      shield: false,
      thrust: 0,
      turn: 0,
    },
    sequence: 6,
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

const secondSocket = new WebSocket(`ws://127.0.0.1:${address.port}`);
const secondMessages: ServerMessage[] = [];

collect({ messages: secondMessages, socket: secondSocket });
await once(secondSocket, 'open');
secondSocket.send(
  JSON.stringify({ playerToken: null, protocolVersion, type: 'hello' }),
);
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
      drill: true,
      hatch: false,
      light: true,
      shield: false,
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
              ({ type, parts }) =>
                type === 6 && parts.some((part) => part.active),
            ) &&
            entity.modules?.some(
              ({ type, parts }) =>
                type === 5 && parts.some((part) => part.active),
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

const closed = Promise.all([
  once(socket, 'close'),
  once(secondSocket, 'close'),
]);

socket.close();
secondSocket.close();
await closed;
await server.stop();
console.log('server integration test passed');
