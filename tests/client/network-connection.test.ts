import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins';
import { snapshotDeltaQuery } from '../../src/client/protocol/binary-snapshot';
import { testBuildPlugin } from '../support/build-plugin.ts';

const status = { hidden: true, textContent: '' };
const sockets: TestWebSocket[] = [];

class TestWebSocket {
  static OPEN = 1;
  readyState = 1;
  onclose?: (event: { code: number; reason: string }) => void;
  onopen?: () => void;
  onmessage?: (event: { data: Uint8Array }) => void;
  closed: number[] = [];
  sent: Uint8Array[] = [];

  constructor(readonly url: string) {
    sockets.push(this);
  }

  send(data: Uint8Array) {
    this.sent.push(data);
  }

  close(code = 1006) {
    this.closed.push(code);
    this.onclose?.({ code, reason: '' });
  }
}

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const timers = new Map<number, () => void>();
let nextTimer = 0;

Object.assign(globalThis, {
  setTimeout: (callback: () => void) => {
    const id = ++nextTimer;

    timers.set(id, callback);
    return id;
  },
  clearTimeout: (id: number) => timers.delete(id),
});

Object.assign(globalThis, {
  document: {
    fonts: { check: () => false },
    getElementById: (id: string) =>
      id === 'connection-status' ? status : null,
  },
  location: { protocol: 'http:', host: 'localhost' },
  WebSocket: TestWebSocket,
  localStorage: {
    getItem: (): string | null => null,
    removeItem: () => {},
    setItem: () => {},
  },
  Path2D: class {
    addPath() {}
  },
});

const entry = resolve('src/__connection_test.ts');
const bannedMessage =
  'Sorry, you have been banned. Contact john@burnt.io if you think this was a mistake';

for (const production of [false, true]) {
  const bundle = await rolldown({
    input: entry,
    plugins: [
      {
        name: 'connection-test',
        resolveId: (id) => (id === entry ? entry : undefined),
        load: (id) =>
          id === entry
            ? `import {NetworkClient} from '${resolve('src/client/network/network.ts')}';
               import {emptyPlayerInput} from '${resolve('src/client/protocol/input.ts')}';
               export default (url = 'test') => new NetworkClient({url});
               export const inspectSnapshot = client => [
                 [...client.entityRecords.keys()],
                 [...client.pendingEntities.keys()],
                 client.asteroidPositions.map(position => position.x),
               ];
               export const inspectModule = client => {
                 const module = client.entityRecords.get(7).modules[0];
                 return [module.shades, module.segments[0].active];
               };
               export const receiveStationStock = client => {
                 const stationId = 7;
                 const receive = (serverTick, fullEntities, stationStock, type = 'snapshot') => {
                   client.receive({message: {type, serverTick, fullEntities, stationStock, entityIds: [stationId], nextEntityId: 104}});
                 };
                 const read = () => {
                   client.updateFrame({input: emptyPlayerInput(), now: performance.now() + 1, dt: 0});
                   const station = client.world.entities.get(stationId);
                   return [Math.round(station.position.x), station.rotation.toFixed(3), station.cargoContents.map(item => item.id)];
                 };

                 receive(1, [{id: stationId, kind: 'station', position: {x: 100, y: 0}, velocity: {x: 30, y: 0}, radius: 100, spin: 1, rotation: 0}],
                   {stationId, replace: true, removedIds: [], entries: [{id: 100, resource: 0}, {id: 101, resource: 0}]}, 'load');
                 client.connected = true;
                 receive(3, [], {stationId, replace: false, removedIds: [100], entries: [{id: 102, resource: 0}]});
                 const patched = read();

                 receive(4, [{id: stationId, position: {x: 200, y: 0}, rotation: 0.5}],
                   {stationId, replace: false, removedIds: [], entries: [{id: 103, resource: 0}]});
                 receive(6, [], {stationId, replace: false, removedIds: [101], entries: []});
                 const batched = read();

                 receive(8, [], {stationId: 0, replace: false, removedIds: [], entries: []});
                 return [patched, batched, read()];
               };
               export const switchDockedShip = client => {
                 client.connected = true;
                 client.playerId = 1;
                 client.shipId = 7;
                 client.world.players.set(1, {shipId: 7});
                 client.world.entities.set(7, {id: 7, dockedTo: 100, dead: false});
                 client.receive({message: {type: 'respawn', shipId: 8}});
                 const during = client.shipDestroyed;
                 client.world.entities.delete(7);
                 client.applySnapshot({message: {type: 'load', fullEntities: [], entityIds: [], nextEntityId: 1, serverTick: 1}});
                 return [during, client.shipDestroyed];
               };`
            : undefined,
      },
      ...(production ? [buildPrePlugin(), testBuildPlugin()] : []),
    ],
  });

  const { output } = await bundle.generate({ format: 'esm' });

  await bundle.close();
  const built = await import(
    `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
  );
  const connect = built.default;

  assert.deepEqual(
    built.switchDockedShip(connect()),
    [false, true],
    'a docked ship switch stays available until the replacement snapshot is applied',
  );

  assert.deepEqual(
    built.receiveStationStock(connect()),
    [
      [102, '0.067', [101, 102]],
      [202, '0.567', [102, 103]],
      [204, '0.633', []],
    ],
    'stock updates and clearing preserve station pose ticks across applied and batched snapshots',
  );

  for (const [code, reason, expected] of [
    [4003, bannedMessage, bannedMessage],
    [4001, 'Session opened elsewhere', 'GAME OPEN IN ANOTHER TAB'],
    [4002, 'Idle timeout', 'AWAY TOO LONG - RELOAD TO PLAY'],
    [1006, '', 'CONNECTION LOST - RETRYING...'],
  ] as const) {
    connect();
    let retries = 0;
    const setTimeout = globalThis.setTimeout;

    Object.assign(globalThis, {
      setTimeout: () => {
        retries++;
        return 0;
      },
    });

    try {
      sockets.at(-1)!.onclose!({ code, reason });
      assert.equal(status.hidden, false);
      assert.equal(status.textContent, expected);
      assert.equal(retries, code === 1006 ? 1 : 0);
    } finally {
      globalThis.setTimeout = setTimeout;
    }
  }

  const socketUrl = 'ws://localhost/game-socket';
  const extended = connect(socketUrl);
  const extendedSocket = sockets.at(-1)!;

  assert.equal(extendedSocket.url, `${socketUrl}?${snapshotDeltaQuery}`);
  extendedSocket.onopen!();

  const point = (x: number) => {
    const bytes = Buffer.alloc(16);

    bytes.writeDoubleLE(x);
    return [...bytes];
  };

  extendedSocket.onmessage!({
    data: Uint8Array.from([
      0x55,
      0x4d,
      1,
      64,
      1,
      10,
      3,
      ...point(0),
      ...point(1),
      ...point(2),
      2,
      7,
      0,
      8,
      0,
    ]),
  });

  extendedSocket.onmessage!({
    data: Uint8Array.from([
      0x55,
      0x4d,
      1,
      128,
      3,
      2,
      10,
      1,
      1,
      1,
      ...point(9),
      1,
      7,
      1,
      9,
      0,
    ]),
  });

  assert.deepEqual(built.inspectSnapshot(extended), [
    [8, 9],
    [8, 9],
    [0, 9, 2],
  ]);

  connect(socketUrl);
  const rejectedSocket = sockets.at(-1)!;

  assert.equal(rejectedSocket.url, `${socketUrl}?${snapshotDeltaQuery}`);
  rejectedSocket.close();
  assert.equal(sockets.at(-1)!.url, socketUrl);
  assert.notEqual(sockets.at(-1), rejectedSocket);

  // Received deltas must be merged before a later render can coalesce them.
  const stream = connect();
  const socket = sockets.at(-1)!;

  socket.onopen!();
  const packet = (tick: number, modules: number[]) =>
    Uint8Array.from([0x55, 0x4d, 1, 0, tick, 2, 1, 7, 1, 34, ...modules]);

  // A full red module, a repaint to orange, then an animation and an
  // unchanged module update all arrive before the game renders.
  socket.onmessage!({ data: packet(1, [2, 5, 8, 0, 2, 0, 0]) });
  socket.onmessage!({ data: packet(2, [2, 5, 8, 0, 2, 1, 0]) });
  socket.onmessage!({ data: packet(3, [3, 1, 129, 8, 0, 2, 1, 1]) });
  socket.onmessage!({ data: packet(4, [3, 0]) });
  assert.deepEqual(socket.closed, []);

  assert.deepEqual(built.inspectModule(stream), [
    ['#c61', '#e82', '#fa3', '#930', '#f80'],
    1,
  ]);

  // Partial updates cannot be applied to a module that was never received.
  const previousError = console.error;

  try {
    console.error = () => {};

    socket.onmessage!({
      data: Uint8Array.from([0x55, 0x4d, 1, 0, 5, 2, 1, 8, 1, 34, 3, 0]),
    });
  } finally {
    console.error = previousError;
  }

  assert.deepEqual(socket.closed, [1007]);

  connect();
  const timeout = timers.get(nextTimer)!;

  timeout();
  assert.equal(status.textContent, 'CONNECTION LOST - RETRYING...');
}

Object.assign(globalThis, {
  setTimeout: originalSetTimeout,
  clearTimeout: originalClearTimeout,
});
