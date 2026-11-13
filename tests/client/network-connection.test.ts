import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins';
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

  constructor() {
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
               export default () => new NetworkClient({url: 'test'});
               export const inspectModule = client => {
                 const module = client.entityRecords.get(7).modules[0];
                 return [module.shades, module.segments[0].active];
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
