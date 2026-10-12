import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createFlyRequest,
  parseResetArgs,
  resetWorldLive,
  restoreVolumeConfig,
} from '../../scripts/reset-world-live.ts';

const original = {
  image: 'deployed-image',
  mounts: [{ path: '/data', volume: 'old-volume' }],
  services: [{ port: 8080, checks: [{ type: 'http' }] }],
  restart: { policy: 'on-failure' },
  init: { cmd: ['/app/server'] },
  env: { DATABASE_PATH: '/data/world.sqlite', WORLD_SEED: '25' },
};

assert.deepEqual(parseResetArgs([]), {
  app: undefined,
  resume: false,
  restore: undefined,
});

assert.equal(parseResetArgs(['--resume']).resume, true);
assert.equal(parseResetArgs(['my-app', '--resume']).app, 'my-app');
assert.deepEqual(
  parseResetArgs(['--restore', 'machine', '/tmp/config.json']).restore,
  { machineId: 'machine', configPath: '/tmp/config.json' },
);

for (const args of [
  ['--restore'],
  ['app', 'restore'],
  ['app', '--restore'],
  ['--resume', '--all'],
  ['--unknown'],
]) {
  assert.throws(() => parseResetArgs(args), /Usage/);
}

await assert.rejects(
  promisify(execFile)(
    process.execPath,
    [
      fileURLToPath(
        new URL('../../scripts/reset-world-live.ts', import.meta.url),
      ),
    ],
    {
      env: { ...process.env, npm_config_restore: 'true' },
      timeout: 2000,
    },
  ),
  /Put a standalone -- before script flags/,
  'an npm-consumed restore flag must never become another reset',
);

for (const resume of [false, true]) {
  let leased = false;
  let reads = 0;
  let executions = 0;
  const paths: string[] = [];

  const machine = () => ({
    id: 'game',
    state: 'started',
    instance_id: 'same-vm',
    config: original,
    checks: [{ status: reads++ < 3 ? 'warning' : 'passing' }],
  });

  await resetWorldLive({
    app: 'test-app',
    resume,
    pause: async () => {},
    request: async (path, body, options) => {
      paths.push(path);

      if (path === '') return [machine()];

      if (path === '/game/lease') {
        if (options?.method === 'DELETE') {
          assert(leased);
          assert.equal(options.leaseNonce, 'lease');
          leased = false;
          return {};
        }

        leased = true;
        return { data: { nonce: 'lease' } };
      }

      assert(
        !leased,
        'Fly exec is blocked by an externally acquired Machine lease',
      );
      assert.equal(options?.leaseNonce, undefined);

      if (path === '/game' && body === undefined) return machine();

      assert.equal(
        path,
        '/game/exec',
        'reset cannot stop, start or reconfigure the Machine',
      );

      assert.deepEqual(body, {
        cmd: `/app/server --${resume ? 'resume' : 'reset'}-world-live`,
        timeout: 25,
      });

      executions++;

      return {
        stdout: resume
          ? 'Game running; no world reset was run.'
          : 'World reset complete; previous database archived in /data/archive',
      };
    },
  });

  assert.equal(executions, 1);
  assert(!leased);
  assert(reads >= 4, 'maintenance waits for health checks');
  assert(!paths.includes('/game/start'));
  assert(
    !paths.includes('/game/lease'),
    'live maintenance uses the private socket lock',
  );
}

for (const result of [
  { exit_code: 1, stderr: 'shutdown did not flush successfully' },
  { exit_code: 0, exit_signal: 9 },
  { stdout: 'unfinished output' },
  { exit_code: 2, stderr: 'flag provided but not defined: -reset-world-live' },
]) {
  let released = false;
  let executions = 0;

  const machine = {
    id: 'game',
    state: 'started',
    instance_id: 'vm',
    config: original,
  };

  await assert.rejects(
    resetWorldLive({
      app: 'test-app',
      pause: async () => {},
      request: async (path, body, options) => {
        if (path === '') return [machine];

        if (path === '/game/lease') {
          if (options?.method === 'DELETE') {
            released = true;
            return {};
          }

          return { data: { nonce: 'lease' } };
        }

        if (path === '/game' && body === undefined) return machine;

        assert.equal(path, '/game/exec');
        executions++;
        return result;
      },
    }),
    /did not complete successfully|Deploy the server version/,
  );

  assert.equal(executions, 1, 'failed reset is never replayed automatically');
  assert(!released, 'normal reset never acquires a Machine lease');
}

for (const [stopped, legacyReset] of [
  [false, false],
  [true, false],
  [true, true],
]) {
  let state = stopped ? 'stopped' : 'started';

  let config: Omit<typeof original, 'init'> & {
    init: { cmd?: string[]; exec?: string[] };
  } = {
    ...original,
    services: [],
    restart: { policy: 'no' },
    init: legacyReset
      ? { exec: ['/app/server', '--reset-world'] }
      : original.init,
  };

  let instanceId = 'initial';
  let currentVolume = 'already-migrated-volume';
  let startCalls = 0;
  let updates = 0;
  let readsAfterUpdate = 0;
  let released = false;

  const machine = () => ({
    id: 'game',
    state,
    instance_id: instanceId,
    config: { ...config, mounts: [{ path: '/data', volume: currentVolume }] },
    checks: [{ status: readsAfterUpdate >= 3 ? 'passing' : 'warning' }],
  });

  await resetWorldLive({
    app: 'test-app',
    pause: async () => {},
    restore: { machineId: 'game', config: original },
    request: async (path, body, options) => {
      if (path === '') return [machine()];

      if (path === '/game/lease') {
        if (options?.method === 'DELETE') {
          released = true;
          return {};
        }

        return { data: { nonce: 'lease' } };
      }

      assert.equal(options?.leaseNonce, 'lease');

      if (path === '/game/start') {
        assert(
          !legacyReset,
          'recovery must never boot the old offline reset command',
        );
        startCalls++;
        currentVolume = 'new-volume-after-start-migration';
        instanceId = 'migrated';
        state = 'started';
        return machine();
      }

      if (path === '/game' && body === undefined) {
        if (updates) {
          readsAfterUpdate++;

          // Do not accept old-version health before the replacement starts.
          if (readsAfterUpdate >= 2) {
            instanceId = 'restored';
            state = 'started';
          }
        }

        return machine();
      }

      assert.equal(
        path,
        '/game',
        'configuration recovery cannot execute a reset',
      );

      assert.deepEqual(body, {
        config: {
          ...original,
          mounts: [{ path: '/data', volume: currentVolume }],
        },
        skip_launch: false,
      });

      updates++;

      config = (body as { config: typeof config }).config;

      return { ...machine(), instance_id: 'restored' };
    },
  });

  assert.equal(startCalls, stopped && !legacyReset ? 1 : 0);
  assert.equal(updates, 1);
  assert(readsAfterUpdate >= 3);
  assert(released);
  assert.equal(
    original.mounts[0].volume,
    'old-volume',
    'saved config is not mutated',
  );
}

assert.throws(
  () =>
    restoreVolumeConfig({
      saved: original,
      current: { mounts: [{ path: '/other', volume: 'volume' }] },
    }),
  /mount paths differ/,
);

assert.throws(
  () =>
    restoreVolumeConfig({
      saved: original,
      current: { mounts: [{ path: '/data' }] },
    }),
  /no volume ID/,
);

await assert.rejects(
  resetWorldLive({
    app: 'test-app',
    restore: {
      machineId: 'game',
      config: {
        ...original,
        init: { exec: ['/app/server', '--reset-world=true'] },
      },
    },
    request: async (path, body, options) => {
      if (path === '') {
        return [
          { id: 'game', state: 'stopped', instance_id: 'vm', config: original },
        ];
      }

      if (path === '/game/lease') {
        return options?.method === 'DELETE' ? {} : { data: { nonce: 'lease' } };
      }

      assert.equal(path, '/game');
      assert.equal(
        body,
        undefined,
        'unsafe saved startup cannot cause any Machine mutation',
      );

      return {
        id: 'game',
        state: 'stopped',
        instance_id: 'vm',
        config: original,
      };
    },
  }),
  /saved configuration contains a reset command/,
);

// A failed restore must save the migrated ID in its next recovery file.
let recovery = '';
const report = console.error;

console.error = (...args: unknown[]) => {
  const match = (typeof args[0] === 'string' ? args[0] : '').match(
    /Recovery config saved at (.+)\. Restore/,
  );

  if (match) recovery = match[1];
};

try {
  const machine = {
    id: 'game',
    state: 'started',
    instance_id: 'vm',
    config: { ...original, mounts: [{ path: '/data', volume: 'new-volume' }] },
  };

  await assert.rejects(
    resetWorldLive({
      app: 'test-app',
      restore: { machineId: 'game', config: original },
      request: async (path, body, options) => {
        if (path === '') return [machine];

        if (path === '/game/lease') {
          return options?.method === 'DELETE'
            ? {}
            : { data: { nonce: 'lease' } };
        }

        if (body === undefined) return machine;

        throw new Error('HTTP 409: insufficient memory on host');
      },
    }),
    /insufficient memory/,
  );

  assert.equal(
    JSON.parse(await readFile(recovery, 'utf8')).mounts[0].volume,
    'new-volume',
  );
} finally {
  console.error = report;

  if (recovery) await rm(dirname(recovery), { recursive: true });
}

const failedRequest = createFlyRequest({
  app: 'test-app',
  token: 'test-token',
  fetchRequest: async () =>
    new Response('{"error":"machine is still updating"}', { status: 412 }),
});

await assert.rejects(
  failedRequest('/game/start', {}),
  /HTTP 412:.*machine is still updating/,
);
await assert.rejects(
  resetWorldLive({ app: 'test-app', request: async () => [] }),
  /Expected one game Machine/,
);
console.log(
  'Live resets keep the Machine running; recovery preserves migrated volumes',
);
