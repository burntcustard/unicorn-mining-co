import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  parseResetArgs,
  resetWorldLive,
} from '../../scripts/reset-world-live.ts';
import { getFlyApp } from '../../scripts/fly-maintenance.ts';

const machine = {
  id: 'game',
  state: 'started',
  instance_id: 'same-vm',
  config: {
    mounts: [{ path: '/data' }],
    services: [{ checks: [{ type: 'http' }] }],
  },
  checks: [{ status: 'passing' }],
};

assert.deepEqual(parseResetArgs([]), {
  app: undefined,
  resume: false,
  help: false,
});

assert.equal(parseResetArgs(['--resume']).resume, true);
assert.equal(parseResetArgs(['my-app', '--resume']).app, 'my-app');
assert.equal(await getFlyApp('other-app'), 'other-app');
assert.equal(await getFlyApp(), 'unicorn-mining-co');

for (const args of [
  ['--restore'],
  ['app', 'restore'],
  ['app', '--restore', 'machine', '/tmp/config.json'],
  ['--resume', '--all'],
  ['--unknown'],
  [''],
]) {
  assert.throws(() => parseResetArgs(args));
}

const script = fileURLToPath(
  new URL('../../scripts/reset-world-live.ts', import.meta.url),
);
const exec = promisify(execFile);

for (const flag of ['restore', 'resume']) {
  await assert.rejects(
    exec(process.execPath, [script], {
      env: { ...process.env, [`npm_config_${flag}`]: 'true' },
      timeout: 2000,
    }),
    /Put a standalone -- before script flags/,
    'npm-consumed flags must never become another reset',
  );
}

const { stdout: help } = await exec(process.execPath, [script, '--help']);

assert.match(help, /Resume after failed maintenance/);

for (const resume of [false, true]) {
  const commands: string[] = [];
  let reads = 0;

  await resetWorldLive({
    app: 'test-app',
    resume,
    pause: async () => {},
    run: async (args) => {
      commands.push(args[1]);

      if (args[1] === 'list') {
        assert.deepEqual(args, [
          'machine',
          'list',
          '--app',
          'test-app',
          '--json',
        ]);

        return [
          {
            ...machine,
            checks: [{ status: reads++ < 2 ? 'warning' : 'passing' }],
          },
        ];
      }

      assert.deepEqual(args, [
        'machine',
        'exec',
        'game',
        `'/app/server' '--${resume ? 'resume' : 'reset'}-world-live'`,
        '--app',
        'test-app',
        '--json',
        '--timeout',
        '25',
      ]);

      return {
        stdout: resume
          ? 'Game running; no world reset was run.'
          : 'World reset complete; previous database archived in /data/archive',
      };
    },
  });

  assert.equal(commands.filter((command) => command === 'exec').length, 1);
  assert(
    commands.every((command) => command === 'list' || command === 'exec'),
    'maintenance cannot stop, start, lease, or reconfigure a Machine',
  );
  assert.equal(reads, 3, 'maintenance waits for passing health checks');
}

for (const result of [
  { exit_code: 1, stderr: 'shutdown did not flush successfully' },
  { exit_code: 0, exit_signal: 9 },
  { stdout: 'unfinished output' },
  { exit_code: 2, stderr: 'flag provided but not defined: -reset-world-live' },
]) {
  let executions = 0;

  await assert.rejects(
    resetWorldLive({
      app: 'test-app',
      pause: async () => {},
      run: async (args) => {
        if (args[1] === 'list') return [machine];
        executions++;
        return result;
      },
    }),
    /Maintenance command failed/,
  );

  assert.equal(executions, 1, 'failed reset is never replayed automatically');
}

for (const [machines, expected] of [
  [[], /found 0/],
  [[machine, machine], /found 2/],
  [[{ ...machine, state: 'stopped' }], /requires a running Machine/],
] as const) {
  await assert.rejects(
    resetWorldLive({
      app: 'test-app',
      run: async (args) => {
        assert.equal(
          args[1],
          'list',
          'invalid Machine selection cannot execute a reset',
        );
        return machines;
      },
    }),
    expected,
  );
}

for (const failure of ['timeout', 'changed instance', 'unhealthy']) {
  let reads = 0;
  let executions = 0;

  await assert.rejects(
    resetWorldLive({
      app: 'test-app',
      pause: async () => {},
      run: async (args) => {
        if (args[1] === 'list') {
          return [
            {
              ...machine,
              instance_id:
                failure === 'changed instance' && reads++
                  ? 'replacement-vm'
                  : machine.instance_id,
              checks: [
                { status: failure === 'unhealthy' ? 'critical' : 'passing' },
              ],
            },
          ];
        }

        executions++;

        if (failure === 'timeout') throw new Error('Fly command timed out');
        return { stdout: 'World reset complete;' };
      },
    }),
    /timed out|Machine changed|did not become healthy/,
  );

  assert.equal(
    executions,
    1,
    'uncertain results and failed health checks cannot repeat a reset',
  );
}

console.log('Live reset uses the Fly CLI and keeps the Machine running');
