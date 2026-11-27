import '../support/ignore-handshake-timeout.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { runProductionScenario } from '../support/build-plugin';

const executable = resolve('src/server/target/debug/examples/trade_fixture');
const root = process.cwd();

class Socket {
  static OPEN = 1;
  static sockets: Socket[] = [];
  readyState = 1;
  sent: Uint8Array[] = [];

  constructor() {
    Socket.sockets.push(this);
  }

  send(packet: Uint8Array) {
    this.sent.push(packet);
  }
}

Object.assign(globalThis, {
  location: { protocol: 'http:', host: 'localhost' },
  localStorage: { getItem: (): null => null, setItem() {} },
  WebSocket: Socket,
  tradePackets: () => Socket.sockets.at(-1)!.sent.splice(0),
});

const scenario = `
import assert from 'node:assert/strict';
import { NetworkClient } from '${root}/src/client/network/network.ts';
import { applyCraftAction, setCraftActionDispatcher } from '${root}/src/client/network/craft-actions.ts';
import { decodeServerControl } from '${root}/src/client/protocol/binary-control.ts';
import { decodeBinarySnapshot } from '${root}/src/client/protocol/binary-snapshot.ts';
import { emptyPlayerInput } from '${root}/src/client/protocol/input.ts';
import { Module } from '${root}/src/client/objects/modules/module.ts';
import { autogunAmmo } from '${root}/src/specs/items/index.ts';

export default async () => {
const server = Reflect.get(globalThis, 'tradeServer');
const outgoing = Reflect.get(globalThis, 'tradePackets');
const client = new NetworkClient({ url: 'test' });
setCraftActionDispatcher((ship, action) => client.applyCraftAction(ship, action));
const render = () => client.updateFrame({ input: emptyPlayerInput(), now: performance.now() + 1, dt: 0 });
const receive = packets =>
  packets.map(hex => {
    const packet = Uint8Array.from(Buffer.from(hex, 'hex'));
    const message = packet[1] === 0x43 ? decodeServerControl(packet) : decodeBinarySnapshot(packet);
    client.receive({ message });
    render();
    return message;
  });
const flush = async () => receive(await server('receive', outgoing()));
receive(await server('setup', []));
await flush();
const ship = () => client.world.entities.get(client.shipId);
const station = () => client.world.entities.get(ship().dockedTo);
const state = () => [client.player.credits, ship().cargoContents.map(object => object.id), station().cargoContents.map(object => object.id), client.world.nextEntityId];
const act = action => applyCraftAction(ship(), action);
const stationId = ship().dockedTo;
const departed = receive(await server('farStation', outgoing()));
assert(client.stationMarkers.has(stationId), 'distant station keeps its marker');
assert(departed.some(message => message.stationStock?.stationId === 0), 'undocking clears private stock');
receive(await server('nearStation', outgoing()));
assert.equal(client.world.entities.get(stationId).cargoContents.length, 0, 'public station view excludes private stock');
const redocked = receive(await server('redock', outgoing()));
assert(redocked.some(message => message.stationStock?.replace), 'docking restores private stock');

// Hold a stale snapshot and the first purchase reply. While both purchases
// are optimistic, backpressure suppresses the second purchase's direct reply.
const [credits, cargo, stock, nextId] = state();
const [firstId, secondId] = stock;
const stale = await server('tick', outgoing());
assert(act({ action: 'buyAmmo' }));
const firstReply = await server('receive', outgoing());
await server('block', []);
assert(act({ action: 'buyAmmo' }));
await flush();

const expectedInventories = [
  credits - 2 * autogunAmmo.price,
  [...cargo, firstId, secondId],
  stock.slice(2),
];
assert.deepEqual(state(), [...expectedInventories, nextId], 'optimistic purchases transfer stock IDs and update credits');
receive(stale);
const firstPatch = receive(firstReply).find(message => message.stationStock)?.stationStock;
assert.deepEqual(firstPatch?.removedIds, [firstId]);
assert.deepEqual(state().slice(0, 3), expectedInventories, 'a partial acknowledgment preserves the second purchase');
await server('unblock', []);
const catchUp = receive(await server('tick', outgoing()));

assert(catchUp.some(message => message.stationStock?.removedIds.includes(secondId)), 'the ordinary snapshot confirms the suppressed purchase');
receive(stale);
assert.deepEqual(state().slice(0, 3), expectedInventories, 'stale snapshots cannot reverse confirmed purchases');

// Buy back a sold module before any reply, then sell it again. The server's
// global allocation has drifted and none of those temporary references may leak.
const rapidModule = ship().cargoContents.find(object => object instanceof Module);
const rapidModuleId = rapidModule.id;
const rapidBalance = client.player.credits;
await server('drift', []);
assert(act({ action: 'sell', objectIds: [rapidModuleId] }));
assert(station().cargoContents.some(object => object.id === rapidModuleId));
assert(act({ action: 'buyStock', objectIds: [rapidModuleId] }));
assert.equal(client.player.credits, rapidBalance);
assert(act({ action: 'sell', objectIds: [rapidModuleId] }));
assert.equal(client.player.credits, rapidBalance + rapidModule.price);
await flush();
assert(!ship().cargoContents.some(object => object instanceof Module));
const rapidStock = station().cargoContents.find(object => object instanceof Module);
assert(rapidStock && rapidStock.id !== rapidModuleId);
assert.equal(client.player.credits, rapidBalance + rapidModule.price, 'all rapid module trades are accepted using server IDs');

// Another player can consume stock before our intent reaches the server.
// Its rejection must remove the optimistic purchase and restore our balance.
const contested = station().cargoContents[0];
const beforeRejection = state();
await server('takeStock', []);
assert(act({ action: 'buyStock', objectIds: [contested.id] }));
assert(ship().cargoContents.some(object => object.id === contested.id));
assert.equal(client.player.credits, beforeRejection[0] - contested.price);
await flush();
assert(!ship().cargoContents.some(object => object.id === contested.id), 'rejection corrects speculative cargo');
assert.equal(client.player.credits, beforeRejection[0], 'rejection restores the balance');
assert.equal(station().cargoContents.length, beforeRejection[2].length - 1);

const settled = state();
// Losing the connection before a request arrives restores the last known
// server inventory and balance rather than leaving a phantom purchase visible.
assert(act({ action: 'buyAmmo' }));
assert.equal(ship().cargoContents.length, settled[1].length + 1);
client.socket.onclose({ code: 4001 });
assert.deepEqual(state(), settled, 'disconnect removes unconfirmed trades');
};
`;

const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const closed = once(child, 'exit');
const lines = createInterface({ input: child.stdout });
const responses = lines[Symbol.asyncIterator]();

Reflect.set(
  globalThis,
  'tradeServer',
  async (kind: string, packets: Uint8Array[]) => {
    child.stdin.write(
      JSON.stringify({
        Kind: kind,
        Packets: packets.map((packet) => Buffer.from(packet).toString('hex')),
      }) + '\n',
    );

    const response = await responses.next();

    assert(!response.done, 'Server session terminated before replying');
    return JSON.parse(response.value);
  },
);

try {
  const { default: runTrade } = await runProductionScenario({
    name: 'trade-integration',
    source: scenario,
    modules: {
      '/audio/sound-loader.ts':
        'export const unlockAudio = () => {}; export const playSound = () => {}; export const updateThrusterSound = () => {};',
    },
  });

  await runTrade();
} finally {
  child.stdin.end();
  await closed;
  lines.close();
}
