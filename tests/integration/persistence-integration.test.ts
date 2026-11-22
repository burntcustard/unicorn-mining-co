import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { on, once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import {
  decodeServerControl,
  encodeClientMessage,
} from '../../src/client/protocol/binary-control';
import { decodeBinarySnapshot } from '../../src/client/protocol/binary-snapshot';
import type { ClientMessage } from '../../src/client/protocol/network';

const directory = mkdtempSync(resolve(tmpdir(), 'unicorn-recovery-'));

const env = {
  ...process.env,
  DATABASE_PATH: resolve(directory, 'world.sqlite'),
  BACKUP_DIRECTORY: resolve(directory, 'backups'),
  WORLD_SEED: '25',
  APP_ENV: 'production',
  PORT: '0',
  ASSET_DIR: resolve('dist'),
  MOVEMENT_BIND_ADDRESS: '127.0.0.1:0',
  MOVEMENT_PUBLIC_ADDRESS: '127.0.0.1:0',
};

const executable = resolve('bin/server');
let server: ReturnType<typeof spawn> | undefined;
const sockets: WebSocket[] = [];

async function start(appEnv = 'production') {
  const child = spawn(executable, [], {
    env: { ...env, APP_ENV: appEnv, NODE_ENV: appEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  server = child;

  return new Promise<string>((resolveAddress, reject) => {
    let log = '';

    child.once('error', reject);
    child.once('exit', (code) =>
      reject(new Error(`Startup failed (${code}): ${log}`)),
    );

    child.stderr.on('data', (data) => {
      log += data;
      const match = log.match(/listening on .*:(\d+)/);

      if (match) resolveAddress(`ws://127.0.0.1:${match[1]}/game-socket`);
    });
  });
}

async function stop(signal: 'SIGTERM' | 'SIGKILL') {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const stopped = once(server, 'exit');

  server.kill(signal);
  await stopped;
}

function connect(address: string) {
  const socket = new WebSocket(address, {
    origin: `https://${new URL(address).host}`,
  });

  sockets.push(socket);
  return socket;
}

async function join(address: string, token: string | null) {
  const socket = connect(address);

  return new Promise<{
    token: string;
    playerId: number;
    shipId: number;
    credits: number;
    paints: number;
  }>((resolvePlayer, reject) => {
    let welcome: ReturnType<typeof decodeServerControl> | undefined;

    socket.once('error', reject);
    socket.once('close', () =>
      reject(new Error('Connection closed before load')),
    );
    socket.once('open', () =>
      socket.send(encodeClientMessage({ type: 'hello', playerToken: token })),
    );

    socket.on('message', (data) => {
      try {
        const packet = new Uint8Array(data as Buffer);

        if (packet[1] === 0x43) {
          const control = decodeServerControl(packet);

          if (control.type === 'welcome') welcome = control;
          return;
        }

        const state = decodeBinarySnapshot(packet);

        if (state.snapshotSequence !== undefined) {
          socket.send(
            encodeClientMessage({
              type: 'snapshotAck',
              sequence: state.snapshotSequence,
            }),
          );
        }

        if (!welcome || welcome.type !== 'welcome') return;
        const loadedWelcome = welcome;
        const ship = state.fullEntities.find(
          (entity) => entity.id === loadedWelcome.shipId,
        );

        if (!ship || welcome.credits === undefined) return;

        resolvePlayer({
          token: welcome.playerToken,
          playerId: welcome.playerId,
          shipId: welcome.shipId,
          credits: welcome.credits,
          paints: welcome.unlockedPaints!,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function requestControl(
  socket: WebSocket,
  request: Extract<ClientMessage, { type: 'chat' | 'profile' }>,
) {
  const messages = on(socket, 'message', {
    close: ['close'],
    signal: AbortSignal.timeout(2000),
  });

  socket.send(encodeClientMessage(request));

  for await (const [data] of messages) {
    const packet = new Uint8Array(data as Buffer);

    if (packet[1] !== 0x43) continue;
    const control = decodeServerControl(packet);

    if (control.type === request.type) return control;
  }

  throw new Error(`Connection closed before ${request.type} reply`);
}

async function expectGreetingRejection({
  address,
  token,
  code,
}: {
  address: string;
  token: string;
  code: number;
}) {
  const socket = connect(`${address}?snapshotDeltas=1&movement=1`);
  const signals: string[] = [];

  socket.on('message', (data, binary) => {
    if (!binary) signals.push(String(data));
  });

  await once(socket, 'open');
  const closed = once(socket, 'close');

  socket.send(encodeClientMessage({ type: 'hello', playerToken: token }));
  socket.send('movement\ninvalid offer');

  assert.equal((await closed)[0], code);
  assert.deepEqual(signals, []);
}

const timeout = setTimeout(() => {
  sockets.forEach((socket) => socket.terminate());
  server?.kill('SIGKILL');
}, 20000);

try {
  let address = await start();
  const first = await join(address, null);

  assert.equal(first.paints, 511);
  assert.equal(first.credits, 2000);
  const firstClosed = once(sockets[0], 'close');

  sockets[0].terminate();
  await firstClosed;
  const refresh = await join(address, first.token);

  assert.deepEqual(refresh, first);
  await stop('SIGTERM');
  address = await start();
  const resumed = await join(address, first.token);

  assert.equal(resumed.playerId, first.playerId);
  assert.equal(resumed.shipId, first.shipId);
  assert.equal(resumed.credits, first.credits);
  assert.equal(resumed.paints, first.paints);
  // A welcome is released only after its player record is durably committed.
  // Kill without a disconnect or shutdown flush and reconnect to the same ID.
  await stop('SIGKILL');
  address = await start();
  const recovered = await join(address, first.token);

  assert.deepEqual(recovered, resumed);
  await stop('SIGTERM');
  address = await start('development');
  const developer = await join(address, null);

  assert.equal(developer.credits, 99999);
  const existing = await join(address, first.token);

  assert.equal(existing.credits, first.credits);
  await stop('SIGTERM');
  address = await start();
  const savedDeveloper = await join(address, developer.token);

  const owner = await requestControl(sockets.at(-1)!, {
    type: 'profile',
    displayName: 'burntcustard',
  });

  assert(owner.type === 'profile');
  assert.equal(owner.displayName, 'burntcustard');
  assert.equal(savedDeveloper.credits, developer.credits);
  const newProductionPlayer = await join(address, null);

  const pilot = await requestControl(sockets.at(-1)!, {
    type: 'profile',
    displayName: 'Dormant Pilot',
  });

  assert(pilot.type === 'profile');
  assert.equal(pilot.displayName, 'Dormant Pilot');
  assert.equal(newProductionPlayer.credits, 2000);
  await stop('SIGTERM');

  address = await start();
  await join(address, savedDeveloper.token);

  const ban = await requestControl(sockets.at(-1)!, {
    type: 'chat',
    channel: 0,
    text: '/ban Dormant Pilot',
  });

  assert(ban.type === 'chat');
  assert.equal(ban.text, 'Dormant Pilot has been banned.');
  await stop('SIGTERM');

  address = await start();

  await expectGreetingRejection({
    address,
    token: newProductionPlayer.token,
    code: 4003,
  });

  await join(address, savedDeveloper.token);

  const pardon = await requestControl(sockets.at(-1)!, {
    type: 'chat',
    channel: 0,
    text: '/pardon Dormant Pilot',
  });

  assert(pardon.type === 'chat');
  assert.equal(pardon.text, 'Dormant Pilot has been pardoned.');
  const returned = await join(address, newProductionPlayer.token);

  assert.equal(returned.token, newProductionPlayer.token);
  assert.equal(returned.shipId, newProductionPlayer.shipId);
  assert.equal(returned.credits, newProductionPlayer.credits);
  assert.equal(returned.paints, newProductionPlayer.paints);
  await stop('SIGTERM');

  const database = new DatabaseSync(env.DATABASE_PATH);

  try {
    const result = database
      .prepare('UPDATE players SET ship = ? WHERE id = ?')
      .run('{', returned.token);

    assert.equal(result.changes, 1);
  } finally {
    database.close();
  }

  address = await start();
  const identity = new URL('/api/identity', address);

  identity.protocol = 'http:';

  const unavailable = await fetch(identity, {
    method: 'POST',
    body: returned.token,
  });

  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');
  assert.equal(await unavailable.text(), 'Server unavailable\n');

  const unknown = await fetch(identity, {
    method: 'POST',
    body: '00000000-0000-4000-8000-000000000001',
  });

  assert.equal(unknown.status, 404);
  assert.equal(await unknown.text(), 'Unknown ID\n');
  await expectGreetingRejection({ address, token: returned.token, code: 1013 });
  await stop('SIGTERM');
  console.log(
    'SQLite refresh, restarts, starting credits, offline moderation, and identity errors passed',
  );
} finally {
  clearTimeout(timeout);
  sockets.forEach((socket) => socket.terminate());
  await stop('SIGKILL');
  rmSync(directory, { recursive: true, force: true });
}
