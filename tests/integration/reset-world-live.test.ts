import assert from 'node:assert/strict';
import {
  createFlyRequest,
  resetWorldLive,
} from '../../scripts/reset-world-live.ts';

for (const [exitCode, autostart, restoreOnly] of [
  [0, false, false],
  [0, true, false],
  [1, false, false],
  [1, true, false],
  [0, false, true],
] as const) {
  const original = {
    image: 'deployed-image',
    mounts: [{ path: '/data', volume: 'existing-volume' }],
    services: [{ port: 8080, checks: [{ type: 'http' }] }],
    restart: { policy: 'on-failure' },
    init: { cmd: ['/app/server'] } as { cmd?: string[]; exec?: string[] },
  };

  let config = restoreOnly
    ? {
        ...original,
        services: [],
        init: { exec: ['/app/server', '--reset-world'] },
      }
    : original;

  let state = 'started';
  let resetRan = false;
  let gameRestarted = false;
  let timestamp = 1;
  let instanceId = 'version-0';
  let nextVersion = 0;
  let leased = false;
  let healthReads = 0;

  let pending:
    | { config: typeof original; instanceId: string; reads: number }
    | undefined;

  const events = [] as {
    type: string;
    status?: string;
    timestamp: number;
    request?: {
      exit_event: { guest_exit_code?: number; guest_signal?: number };
    };
  }[];

  const request = async (
    path: string,
    body?: unknown,
    options?: { method?: string; leaseNonce?: string },
  ) => {
    const machine = () => ({
      id: 'game',
      instance_id: instanceId,
      state,
      config,
      events,
      checks: gameRestarted
        ? [{ status: healthReads++ < 2 ? 'warning' : 'passing' }]
        : [],
    });

    if (path === '') return [machine()];

    if (path === '/game/lease') {
      if (options?.method === 'DELETE') {
        assert(leased);
        assert.equal(options.leaseNonce, 'test-lease');
        leased = false;
        return {};
      }

      leased = true;
      return { data: { nonce: 'test-lease' } };
    }

    assert(leased, 'maintenance holds a lease to prevent proxy autostarts');
    assert.equal(options?.leaseNonce, 'test-lease');

    if (body === undefined) {
      if (pending) {
        pending.reads++;

        if (pending.reads === 1) return { ...machine(), state: 'stopped' };

        // Fly can publish the new version before the host finishes preparing it.
        instanceId = pending.instanceId;
        config = pending.config;
        state = 'stopped';

        if (pending.reads === 2) {
          return {
            ...machine(),
            events: [
              { type: 'launch', status: 'created', timestamp: timestamp++ },
            ],
          };
        }

        events.length = 0;

        events.unshift({
          type: 'update',
          status: 'stopped',
          timestamp: timestamp++,
        });

        pending = undefined;
      }

      return machine();
    }

    if (path === '/game') {
      pending = {
        config: (body as { config: typeof original }).config,
        instanceId: `version-${++nextVersion}`,
        reads: 0,
      };

      return {
        ...machine(),
        instance_id: pending.instanceId,
        state: 'created',
      };
    }

    if (path === '/game/start') {
      assert(
        !pending,
        'starting before the replacement is ready causes HTTP 412',
      );

      if ('exec' in config.init) {
        assert.deepEqual(config.mounts, original.mounts);
        assert.deepEqual(config.restart, { policy: 'no' });
        assert.deepEqual(config.services, []);
        resetRan = true;
        state = 'stopped';

        // The API may omit a zero exit code.
        events.unshift({
          type: 'exit',
          timestamp: timestamp++,
          request: {
            exit_event: exitCode
              ? { guest_exit_code: exitCode }
              : { guest_signal: -1 },
          },
        });
      } else {
        assert(resetRan || restoreOnly);
        assert.equal(exitCode, 0, 'a failed reset cannot restart the game');
        assert.deepEqual(
          config,
          original,
          'all original settings are restored',
        );
        gameRestarted = true;
        state = 'started';

        if (autostart) {
          throw new Error('HTTP 412: machine is already started');
        }
      }

      return machine();
    }

    throw new Error(`Unexpected request ${path}`);
  };

  const reset = resetWorldLive({
    app: 'test-app',
    request,
    pause: async () => {},
    ...(restoreOnly && { restore: { machineId: 'game', config: original } }),
  });

  if (exitCode) await assert.rejects(reset, /did not exit successfully/);
  else await reset;
  assert.equal(resetRan, !restoreOnly, 'recovery cannot run the reset command');
  assert.equal(gameRestarted, exitCode === 0);

  if (!exitCode) assert(healthReads >= 3, 'wait for health checks to pass');
  assert(!leased, 'the lease is released after success and failure');
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
  resetWorldLive({
    app: 'test-app',
    request: async () => [],
  }),
  /Expected one game Machine/,
);

console.log(
  'Server world reset preserves config and volume, and refuses failed maintenance',
);
