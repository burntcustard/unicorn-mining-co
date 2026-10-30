import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  collectionArguments,
  isNPCService,
  runCollectionSession,
  startNPCProcess,
  stopNPCProcess,
} from '../../benchmarking/npc/collection-run.ts';
import { parseNPCOptions } from '../../benchmarking/npc/options.ts';

const defaults = parseNPCOptions({ args: collectionArguments([]) });

assert.deepEqual(defaults.scenarios, [
  'collection-courser',
  'collection-finch',
]);
assert.equal(defaults.seconds, 120);
assert.equal(defaults.warmup, 0);
assert.equal(defaults.repetitions, 9);
assert.equal(defaults.seed, 1);
assert.equal(defaults.concurrency, 6);
assert.equal(defaults.output, 'benchmarking/_local/npc-collection.json');

const override = parseNPCOptions({
  args: collectionArguments([
    '--seconds',
    '5',
    '--watch',
    '--repetitions',
    '2',
    '--seed',
    '0',
    '--output',
    '/tmp/custom.json',
  ]),
});

assert.equal(override.seconds, 5);
assert.equal(override.watch, true);
assert.equal(override.repetitions, 2);
assert.equal(override.seed, 0);
assert.equal(override.output, '/tmp/custom.json');

const helpLines: string[] = [];
const log = console.log;

try {
  console.log = (line: string) => helpLines.push(line);
  await runCollectionSession(['--help']);
} finally {
  console.log = log;
}

const help = helpLines.join('\n');

assert.match(help, /--repetitions 9/);
assert.match(help, /--seed 1/);
assert.match(help, /--seconds 120/);
assert.match(help, /--watch/);
assert.match(help, /Both ships use the same layout for each repetition/);

const watcher = {
  pid: 123,
  parent: 1,
  started: '456',
  state: 'S',
  cwd: '/repo',
  executable: '/usr/bin/node',
  args: ['node', 'scripts/dev-server.ts'],
};

assert(isNPCService(watcher, '/repo', 'watcher'));
assert(!isNPCService({ ...watcher, cwd: '/other' }, '/repo', 'watcher'));
assert(
  !isNPCService(
    { ...watcher, executable: '/usr/bin/python' },
    '/repo',
    'watcher',
  ),
);
assert(
  !isNPCService(
    { ...watcher, args: ['node', '-e', 'scripts/dev-server.ts'] },
    '/repo',
    'watcher',
  ),
);

for (const script of [
  'node_modules/.bin/vite',
  '/repo/node_modules/vite/bin/vite.js',
]) {
  assert(
    isNPCService(
      { ...watcher, args: ['node', script, '--strictPort'] },
      '/repo',
      'frontend',
    ),
  );
  assert(
    !isNPCService(
      { ...watcher, args: ['node', script, 'preview'] },
      '/repo',
      'frontend',
    ),
  );
}

const directory = await mkdtemp(resolve(tmpdir(), 'npc-session-test-'));
const children: Awaited<ReturnType<typeof startNPCProcess>>[] = [];

const launch = async (source: string, name: string, visible = false) => {
  const child = await startNPCProcess({
    command: process.execPath,
    args: ['-e', source],
    cwd: directory,
    env: process.env,
    log: resolve(directory, name),
    visible,
  });

  children.push(child);
  return child;
};

const waitForOutput = async (log: string) => {
  const deadline = Date.now() + 3000;

  for (;;) {
    const output = await readFile(log, 'utf8');

    if (output.trim()) return output.trim();
    assert(Date.now() < deadline, 'Test child did not become ready');
    await pause(10);
  }
};

try {
  const visible = await launch(
    "console.log('logged stdout'); console.error('logged stderr')",
    'visible.log',
    true,
  );

  assert.equal((await visible.completion).code, 0);
  const captured = await readFile(visible.log, 'utf8');

  assert.match(captured, /logged stdout/);
  assert.match(captured, /logged stderr/);

  const graceful = await launch(
    "process.on('SIGTERM', () => process.exit(0)); console.log('ready'); setInterval(() => {}, 1000)",
    'graceful.log',
  );

  await waitForOutput(graceful.log);
  await stopNPCProcess(graceful);
  assert.equal((await graceful.completion).code, 0);

  const forced = await launch(
    "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
    'forced.log',
  );

  await waitForOutput(forced.log);
  await stopNPCProcess(forced, 20);
  assert.equal((await forced.completion).signal, 'SIGKILL');

  const orphan = await launch(
    "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(() => {}, 1000)'],{stdio:'ignore'}); console.log(child.pid); child.unref();",
    'orphan.log',
  );
  const descendant = Number(await waitForOutput(orphan.log));

  assert.equal((await orphan.completion).code, 0);
  await stopNPCProcess(orphan);
  const { stdout } = await promisify(execFile)('ps', ['-eo', 'pid=,stat=']);

  assert(
    !stdout
      .trim()
      .split('\n')
      .some((line) => {
        const [pid, state] = line.trim().split(/\s+/);

        return Number(pid) === descendant && !state.startsWith('Z');
      }),
    'A grandchild survived after its group leader exited',
  );

  const failed = await startNPCProcess({
    command: resolve(directory, 'absent'),
    args: [],
    cwd: directory,
    env: {},
    log: resolve(directory, 'failed.log'),
  });

  children.push(failed);
  assert((await failed.completion).error);
  await stopNPCProcess(failed);
} finally {
  for (const child of children) await stopNPCProcess(child, 20);
  await rm(directory, { recursive: true, force: true });
}
