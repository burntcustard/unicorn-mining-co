import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { GameServer } from '../src/server/game-server';

const waitUntil = async (condition: () => boolean) => {
  const started = Date.now();

  while (!condition()) {
    assert(Date.now() - started < 5000, 'reconnect timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const server = new GameServer({ port: 0 });
const listener = server.start();

await once(listener, 'listening');
const address = listener.address();

assert(address && typeof address !== 'string');
const stored = new Map<string, string>();

Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  },
  location: { host: `127.0.0.1:${address.port}`, protocol: 'http:' },
});
const { network } = await import('../src/client/network');

await network.ready;
assert(network.connected);
const token = stored.get('playerToken');
const ship = network.shipId;
const socket = Reflect.get(network, 'socket') as WebSocket;

socket.close();
await waitUntil(() => !network.connected);
await waitUntil(
  () => network.connected && Reflect.get(network, 'socket') !== socket,
);
assert.equal(stored.get('playerToken'), token);
assert.equal(network.shipId, ship);

await server.stop();
await waitUntil(() => !network.connected);
const replacement = new GameServer({ port: address.port });
const nextListener = replacement.start();

await once(nextListener, 'listening');
await waitUntil(() => network.connected && stored.get('playerToken') !== token);
assert(network.world.entities.has(network.shipId!));

const takeover = new WebSocket(`ws://127.0.0.1:${address.port}/game-socket`);

await once(takeover, 'open');
takeover.send(
  JSON.stringify({ type: 'hello', playerToken: stored.get('playerToken') }),
);
await waitUntil(() => !network.connected);
const replacedSocket = Reflect.get(network, 'socket');

await new Promise((resolve) => setTimeout(resolve, 700));
assert.equal(Reflect.get(network, 'socket'), replacedSocket);
takeover.close();
await replacement.stop();
console.log('client reconnect, restart, and second-tab takeover passed');
process.exit(0);
