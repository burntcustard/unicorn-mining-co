import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import {
  decodeServerControl,
  encodeClientMessage,
} from '../../src/client/protocol/binary-control';
import { decodeBinarySnapshot } from '../../src/client/protocol/binary-snapshot';

const directory = mkdtempSync(resolve(tmpdir(), 'unicorn-recovery-'));

const env = {
  ...process.env,
  DATABASE_PATH: resolve(directory, 'world.sqlite'),
  BACKUP_DIRECTORY: resolve(directory, 'backups'),
  WORLD_SEED: '25',
  APP_ENV: 'production',
  PORT: '0',
  ASSET_DIR: resolve('dist'),
};

const executable = resolve('bin/server');
let server: ReturnType<typeof spawn> | undefined;
const sockets: WebSocket[] = [];

async function start() {
  const child = spawn(executable, [], {
    env,
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

async function join(address: string, token: string | null) {
  const socket = new WebSocket(address, {
    origin: address.replace('ws:', 'https:').replace('/game-socket', ''),
  });

  sockets.push(socket);

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

        if (ship?.credits === undefined) return;

        resolvePlayer({
          token: welcome.playerToken,
          playerId: welcome.playerId,
          shipId: welcome.shipId,
          credits: ship.credits,
          paints: welcome.unlockedPaints!,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

const timeout = setTimeout(() => {
  sockets.forEach((socket) => socket.terminate());
  server?.kill('SIGKILL');
}, 20000);

try {
  let address = await start();
  const first = await join(address, null);

  assert.equal(first.paints, 100);
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
  console.log('SQLite refresh, graceful restart, abrupt process kill passed');
} finally {
  clearTimeout(timeout);
  sockets.forEach((socket) => socket.terminate());
  await stop('SIGKILL');
  rmSync(directory, { recursive: true, force: true });
}
