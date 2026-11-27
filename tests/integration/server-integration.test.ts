import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { on, once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import { rolldown } from 'rolldown';
import { buildPrePlugin } from '../../plugins/build-plugins.ts';
import { testBuildPlugin } from '../support/build-plugin';

const entry = resolve('src/__wire_integration.ts');

const bundle = await rolldown({
  input: entry,
  plugins: [
    {
      name: 'wire-fixture',
      resolveId: (id) => (id === entry ? entry : undefined),
      load: (id) =>
        id === entry
          ? `
        import { encodeClientMessage, decodeServerControl } from './client/protocol/binary-control.ts';
        import { decodeBinarySnapshot, snapshotDeltaQuery } from './client/protocol/binary-snapshot.ts';
        import { emptyPlayerInput } from './client/protocol/input.ts';

        export const deltaQuery = snapshotDeltaQuery;
        export const hello = () => encodeClientMessage({ type: 'hello', playerId: null });
        export const sendHatchInput = tick => encodeClientMessage({
          type: 'input', tick, sequence: 1, input: { ...emptyPlayerInput(), cargoHatch: true },
        });
        export const map = () => encodeClientMessage({ type: 'sectorMap', position: { x: 0, y: 0 } });
        export const ack = sequence => encodeClientMessage({ type: 'snapshotAck', sequence });

        export const welcome = packet => {
          const message = decodeServerControl(packet);
          if (message.type === 'welcome') return [message.playerNumber, message.shipId, message.playerId, message.credits];
        };
        export const mapShips = packet => {
          const message = decodeServerControl(packet);
          if (message.type === 'sectorMap') {
            return message.mapMarkers.filter(marker => marker.kind === 'ship').map(marker => marker.id);
          }
        };
        export const soundSources = packet => {
          const message = decodeServerControl(packet);
          if (message.type === 'sounds') {
            return message.sounds.filter(sound => sound.effect === 0).map(sound => [sound.id, sound.by]);
          }
        };
        export const snapshot = packet => {
          const message = decodeBinarySnapshot(packet);
          const load = message.type === 'load';
          return [load, message.snapshotSequence, message.acknowledgedSequence, message.serverTick, load ? message.fullEntities.map(entity => entity.id) : []];
        };
        `
          : undefined,
    },
    buildPrePlugin(),
    testBuildPlugin(),
  ],
});

const { output } = await bundle.generate({ format: 'esm' });

await bundle.close();

type Bytes = Uint8Array;

const codec: {
  deltaQuery: string;
  hello(): Bytes;
  sendHatchInput(tick: number): Bytes;
  map(): Bytes;
  ack(sequence: number): Bytes;
  welcome(packet: Bytes): [number, number, string, number] | undefined;
  mapShips(packet: Bytes): number[] | undefined;
  soundSources(packet: Bytes): [number, number][] | undefined;
  snapshot(
    packet: Bytes,
  ): [boolean, number | undefined, number, number, number[]];
} = await import(
  `data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`
);

const directory = mkdtempSync(resolve(tmpdir(), 'unicorn-integration-'));

const databasePath = resolve(directory, 'world.sqlite');
let server: ReturnType<typeof spawn> | undefined;

async function start() {
  const child = spawn(resolve('bin/server'), [], {
    env: {
      ...process.env,
      PORT: '0',
      ASSET_DIR: resolve('dist'),
      APP_ENV: 'production',
      DATABASE_PATH: databasePath,
      MOVEMENT_BIND_ADDRESS: '127.0.0.1:0',
      MOVEMENT_PUBLIC_ADDRESS: '127.0.0.1:0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  server = child;

  return new Promise<string>((resolveAddress, reject) => {
    let log = '';

    child.once('error', reject);
    child.once('exit', (code) =>
      reject(new Error(`Server exited before startup: ${code}\n${log}`)),
    );

    child.stderr.on('data', (data) => {
      log += data;
      const match = log.match(/listening on .*:(\d+)/);

      if (match) resolveAddress(`http://127.0.0.1:${match[1]}`);
    });
  });
}

async function stop(signal: 'SIGTERM' | 'SIGKILL') {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const stopped = once(server, 'exit');

  server.kill(signal);
  await stopped;
}

const sockets: WebSocket[] = [];

const timeout = setTimeout(() => {
  sockets.forEach((socket) => socket.terminate());
  server?.kill('SIGKILL');
}, 30000);

type Peer = { socket: WebSocket; messages: ReturnType<typeof on> };

async function receive<T>(
  { socket, messages }: Peer,
  packetName: string,
  select: (
    packet: Bytes,
    snapshot?: ReturnType<typeof codec.snapshot>,
  ) => T | undefined,
) {
  for (;;) {
    const { done, value } = await messages.next();

    if (done) break;
    const [packet, binary] = value as [Buffer, boolean];

    assert(binary);
    const snapshot = packet[1] === 0x43 ? undefined : codec.snapshot(packet);
    const sequence = snapshot?.[1];

    if (sequence !== undefined) socket.send(codec.ack(sequence));
    const selected = select(packet, snapshot);

    if (selected !== undefined) return selected;
  }

  throw new Error(`Socket closed before ${packetName}`);
}

try {
  const address = await start();
  const health = await fetch(`${address}/healthz`);

  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');
  const index = await fetch(address);

  assert.equal(index.headers.get('cache-control'), 'no-cache');
  const html = await index.text();
  const script = html.match(/src="([^"]+\.js)"/);

  assert(script, 'production index references a JavaScript chunk');
  const asset = await fetch(new URL(script[1], address));

  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control')!, /immutable/);
  assert.equal((await fetch(`${address}/missing`)).status, 404);

  async function join(query = '') {
    const url = new URL('/game-socket' + query, address);

    url.protocol = 'ws:';

    const socket = new WebSocket(url, {
      origin: address.replace('http:', 'https:'),
    });

    sockets.push(socket);
    await once(socket, 'open');

    const peer = {
      socket,
      messages: on(socket, 'message', { close: ['close'] }),
    };

    let pilot: ReturnType<typeof codec.welcome>;

    const ready = receive(
      peer,
      'the welcome and initial load',
      (packet, snapshot) => {
        if (!snapshot) {
          pilot ??= codec.welcome(packet);
          return;
        }

        const [load, , , tick, loadedIds] = snapshot;

        if (load && pilot) {
          assert(
            loadedIds.includes(pilot[1]),
            'the initial load includes the owned ship',
          );
          return { ...peer, pilot, tick, loadBytes: packet.length };
        }
      },
    );

    socket.send(codec.hello());
    return ready;
  }

  const actor = await join(`?${codec.deltaQuery}`);
  const observer = await join();
  const [playerNumber, shipId, playerId, credits] = actor.pilot;
  const mapped = receive(actor, 'the sector map', (packet) =>
    packet[1] === 0x43 ? codec.mapShips(packet) : undefined,
  );

  actor.socket.send(codec.map());
  const shipIds = await mapped;

  assert(shipIds.includes(shipId), 'map includes the requesting player');
  assert(shipIds.includes(observer.pilot[1]), 'map includes another player');

  const heard = receive(observer, 'the cargo hatch sound', (packet) =>
    packet[1] === 0x43 &&
    codec
      .soundSources(packet)
      ?.some(([ship, player]) => ship === shipId && player === playerNumber)
      ? true
      : undefined,
  );

  const acknowledged = receive(
    actor,
    'input acknowledgment',
    (packet, snapshot) => {
      if (snapshot && !snapshot[0] && snapshot[2] === 1) return packet.length;
    },
  );

  actor.socket.send(codec.sendHatchInput(Math.max(actor.tick, observer.tick)));
  const [snapshotBytes] = await Promise.all([acknowledged, heard]);

  console.log(
    `Production codec load ${actor.loadBytes} B, snapshot ${snapshotBytes} B`,
  );

  // Reuse the wire session's actual accounts to exercise crash recovery.
  await stop('SIGKILL');
  const database = new DatabaseSync(databasePath);

  try {
    const saved = database
      .prepare('SELECT ship FROM players WHERE id = ?')
      .get(playerId);

    assert(typeof saved?.ship === 'string');
    assert.equal(JSON.parse(saved.ship).id, shipId);
    const corrupt = database
      .prepare('UPDATE players SET ship = ? WHERE id = ?')
      .run('{', observer.pilot[2]);

    assert.equal(corrupt.changes, 1);
  } finally {
    database.close();
  }

  const identity = new URL('/api/identity', await start());
  const saved = await fetch(identity, { method: 'POST', body: playerId });

  assert.equal(saved.status, 200);
  const [, savedCredits, savedShip] = await saved.json();

  assert.equal(savedCredits, credits);
  assert(
    Array.isArray(savedShip[3]) && savedShip[3].length > 0,
    'the dormant ship retains its installed modules',
  );

  const unavailable = await fetch(identity, {
    method: 'POST',
    body: observer.pilot[2],
  });

  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');
} finally {
  clearTimeout(timeout);
  sockets.forEach((socket) => socket.terminate());
  await stop('SIGTERM');
  rmSync(directory, { recursive: true, force: true });
}
