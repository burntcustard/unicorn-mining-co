import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import {
  decodeServerControl,
  encodeClientMessage,
} from '../../src/client/protocol/binary-control';

const directory = await mkdtemp(join(tmpdir(), 'unicorn-live-reset-'));
const database = join(directory, 'world.sqlite');
const backups = join(directory, 'backups');
const executable = resolve('bin/server');

const env = {
  ...process.env,
  DATABASE_PATH: database,
  BACKUP_DIRECTORY: backups,
  WORLD_SEED: '25',
  APP_ENV: 'production',
  NODE_ENV: 'production',
  PORT: '0',
  ASSET_DIR: resolve('dist'),
};

let server = spawn(executable, [], {
  env,
  stdio: ['ignore', 'ignore', 'pipe'],
});

const sockets: WebSocket[] = [];
let log = '';
let address = '';

const timeout = setTimeout(() => {
  sockets.forEach((socket) => socket.terminate());
  server.kill('SIGKILL');
}, 20000);

async function player(token: string | null) {
  const socket = new WebSocket(
    address.replace('http:', 'ws:') + '/game-socket',
    { origin: address.replace('http:', 'https:') },
  );

  sockets.push(socket);

  return new Promise<string>((resolveToken, reject) => {
    socket.once('error', reject);
    socket.once('close', () =>
      reject(new Error('Connection closed before welcome')),
    );
    socket.once('open', () =>
      socket.send(encodeClientMessage({ type: 'hello', playerToken: token })),
    );

    socket.on('message', (data) => {
      const packet = new Uint8Array(data as Buffer);

      if (packet[1] !== 0x43) return;

      const control = decodeServerControl(packet);

      if (control.type === 'welcome') resolveToken(control.playerToken);
    });
  });
}

const command = async (...args: string[]) => {
  const { stdout } = await promisify(execFile)(executable, args, {
    env,
    encoding: 'utf8',
  });

  return stdout;
};

async function ready() {
  log = '';
  address = '';

  return new Promise<void>((resolveReady, reject) => {
    server.once('error', reject);
    server.once('exit', (code) =>
      reject(new Error(`Server exited (${code}): ${log}`)),
    );

    server.stderr.on('data', (data) => {
      log += data;
      const match = log.match(/listening on .*:(\d+)/);

      if (match) address = `http://127.0.0.1:${match[1]}`;

      if (log.includes('World maintenance ready')) resolveReady();
    });
  });
}

try {
  await ready();

  const pid = server.pid;
  const socketInfo = await stat(`${database}.control.sock`);

  assert.equal(
    socketInfo.mode & 0o777,
    0o600,
    'maintenance is restricted to the game user',
  );

  const first = await player(null);
  const second = await player(null);
  const closed = sockets.map((socket) => once(socket, 'close'));

  assert.notEqual(first, second);
  assert.equal(
    (await fetch(address + '/reset-world', { method: 'POST' })).status,
    405,
    'public HTTP cannot reset the world',
  );
  await assert.rejects(
    command('--reset-world'),
    /stop the game server before resetting/,
    'offline reset still honors the live database lock',
  );

  const completed = await command('--reset-world-live');

  await Promise.all(closed);
  assert.match(completed, /World reset complete; previous database archived/);
  assert.equal(server.pid, pid);
  assert.equal(
    server.exitCode,
    null,
    'the main process remains alive during reset',
  );
  assert.equal(await (await fetch(address + '/healthz')).text(), 'ok');

  const archives = (await readdir(directory)).filter((name) =>
    name.startsWith('world.sqlite.reset-'),
  );

  assert.equal(archives.length, 1);

  const old = new DatabaseSync(join(directory, archives[0], 'world.sqlite'), {
    readOnly: true,
  });

  try {
    assert.deepEqual(
      old
        .prepare('SELECT id FROM players ORDER BY id')
        .all()
        .map((row) => row.id),
      [first, second].sort(),
      'both player records were flushed into the archive',
    );
    assert.equal(old.prepare('SELECT seed FROM world').get()?.seed, 25);
  } finally {
    old.close();
  }

  const fresh = new DatabaseSync(database, { readOnly: true });

  try {
    assert.equal(
      fresh.prepare('SELECT COUNT(*) AS count FROM players').get()?.count,
      0,
      'the restarted game has fresh player progress',
    );
  } finally {
    fresh.close();
  }

  const rejoined = await player(first);

  assert.notEqual(
    rejoined,
    first,
    'a pre-reset token receives a fresh player profile',
  );
  assert.match(await command('--resume-world-live'), /no world reset was run/);
  assert.equal(
    (await readdir(directory)).filter((name) =>
      name.startsWith('world.sqlite.reset-'),
    ).length,
    1,
    'resume cannot archive another database',
  );

  // A second reset exercises reuse of the same private socket and TCP port.
  assert.match(await command('--reset-world-live'), /World reset complete/);
  assert.equal(server.exitCode, null);
  assert.equal(await (await fetch(address + '/healthz')).text(), 'ok');
  assert.equal(
    (await readdir(directory)).filter((name) =>
      name.startsWith('world.sqlite.reset-'),
    ).length,
    2,
  );

  await player(null);

  const stopped = once(server, 'exit');

  server.kill('SIGTERM');
  const [code] = await stopped;

  assert.equal(code, 0);
  await assert.rejects(
    stat(`${database}.control.sock`),
    /ENOENT/,
    'shutdown removes the private control socket',
  );

  // Generation changes must keep maintenance reachable so an explicit reset
  // can archive an incompatible world without cycling the Machine again.
  const incompatible = new DatabaseSync(database);

  try {
    assert.equal(
      incompatible
        .prepare(
          "UPDATE world SET generation_digest = 'incompatible-generation'",
        )
        .run().changes,
      1,
    );
  } finally {
    incompatible.close();
  }

  server = spawn(executable, [], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  await ready();
  assert.match(log, /Game unavailable:.*world generation rules changed/);
  const incompatiblePid = server.pid;

  await assert.rejects(
    command('--resume-world-live'),
    /world generation rules changed/,
  );
  assert.equal(
    server.exitCode,
    null,
    'incompatible data leaves the Machine process alive',
  );
  const recovered = await command('--reset-world-live');

  assert.match(recovered, /World reset complete/);
  assert.equal(server.pid, incompatiblePid);
  assert.equal(server.exitCode, null);
  assert.equal(await (await fetch(address + '/healthz')).text(), 'ok');
  const incompatibleArchive = new DatabaseSync(
    join(recovered.match(/archived in (.+)/)![1], 'world.sqlite'),
    { readOnly: true },
  );

  try {
    assert.equal(
      incompatibleArchive.prepare('SELECT generation_digest FROM world').get()
        ?.generation_digest,
      'incompatible-generation',
    );
  } finally {
    incompatibleArchive.close();
  }

  const recoveredStopped = once(server, 'exit');

  server.kill('SIGTERM');
  assert.equal((await recoveredStopped)[0], 0);
  await command('--reset-world');
  console.log(
    'Live reset flushes progress and restarts the game without replacing its process',
  );
} finally {
  clearTimeout(timeout);
  sockets.forEach((socket) => socket.terminate());

  if (server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, 'exit');

    server.kill('SIGKILL');
    await stopped;
  }

  await rm(directory, { recursive: true, force: true });
}
