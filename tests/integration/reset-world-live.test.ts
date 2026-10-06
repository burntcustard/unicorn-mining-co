import assert from 'node:assert/strict';
import { resetWorldLive } from '../../scripts/reset-world-live.ts';

for (const exitCode of [0, 1]) {
  const original = {
    image: 'deployed-image',
    mounts: [{ path: '/data', volume: 'existing-volume' }],
    services: [{ port: 8080 }],
    restart: { policy: 'on-failure' },
    init: { cmd: ['/app/server'] },
  };

  let config = original;
  let state = 'started';
  let resetRan = false;
  let gameRestarted = false;
  let timestamp = 1;

  const events = [] as {
    type: string;
    timestamp: number;
    request: { exit_event: { guest_exit_code?: number } };
  }[];

  const request = async (path: string, body?: unknown) => {
    const machine = () => ({ id: 'game', state, config, events });

    if (path === '') return [machine()];

    if (body === undefined) return machine();

    if (path === '/game') {
      config = (body as { config: typeof original }).config;

      return machine();
    }

    if (path === '/game/stop') {
      assert.deepEqual(
        config.services,
        [],
        'traffic is removed before stopping',
      );
      state = 'stopped';

      events.unshift({
        type: 'exit',
        timestamp: timestamp++,
        request: { exit_event: {} },
      });

      return machine();
    }

    if (path === '/game/start') {
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
            exit_event: exitCode ? { guest_exit_code: exitCode } : {},
          },
        });
      } else {
        assert(resetRan);
        assert.equal(exitCode, 0, 'a failed reset cannot restart the game');
        assert.deepEqual(
          config,
          original,
          'all original settings are restored',
        );
        gameRestarted = true;
        state = 'started';
      }

      return machine();
    }

    throw new Error(`Unexpected request ${path}`);
  };

  const reset = resetWorldLive({
    app: 'test-app',
    request,
    pause: async () => {},
  });

  if (exitCode) await assert.rejects(reset, /did not exit successfully/);
  else await reset;
  assert(resetRan);
  assert.equal(gameRestarted, exitCode === 0);
}

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
