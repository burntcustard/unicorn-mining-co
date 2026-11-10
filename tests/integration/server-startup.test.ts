import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'unicorn-startup-'));
const database = join(directory, 'world.sqlite');
const owner = createServer((socket) => socket.end());

try {
  owner.listen(`${database}.control.sock`);
  await once(owner, 'listening');

  const server = spawn(resolve('bin/server'), [], {
    env: {
      ...process.env,
      DATABASE_PATH: database,
      APP_ENV: 'development',
      PORT: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let log = '';

  const timer = setTimeout(() => server.kill('SIGKILL'), 5000);

  server.once('exit', () => clearTimeout(timer));
  server.stderr.on('data', (data) => (log += data));
  const [code] = await once(server, 'exit');

  assert.notEqual(code, 0);
  assert.match(log, /a live maintenance service already owns/);
  assert.doesNotMatch(log, /Go server listening/);
  await assert.rejects(
    stat(database),
    { code: 'ENOENT' },
    'a competing server must not open or create the world before claiming its socket',
  );
} finally {
  await new Promise<void>((resolveClose, reject) =>
    owner.close((error) => (error ? reject(error) : resolveClose())),
  );
  await rm(directory, { recursive: true, force: true });
}
