import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

type FlyRequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  leaseNonce?: string;
};

type Machine = {
  id: string;
  instance_id: string;
  state: string;
  checks?: { status: string }[];
  config: {
    mounts?: { path: string }[];
    init?: Record<string, unknown>;
    restart?: Record<string, unknown>;
    services?: unknown[];
    [key: string]: unknown;
  };
  events?: {
    type: string;
    status?: string;
    timestamp: number;
    request?: {
      exit_event?: {
        exit_code?: number;
        guest_exit_code?: number;
        guest_signal?: number;
        oom_killed?: boolean;
        requested_stop?: boolean;
      };
    };
  }[];
};

/**
 * Run the deployed image's offline reset command on its existing volume.
 */
export async function resetWorldLive({
  app,
  request,
  pause = () => setTimeout(1000),
  restore,
}: {
  app: string;
  request: (
    path: string,
    body?: unknown,
    options?: FlyRequestOptions,
  ) => Promise<unknown>;
  pause?: () => Promise<void>;
  restore?: { machineId: string; config: Machine['config'] };
}) {
  const machines = (await request('')) as Machine[];
  const games = machines.filter(
    (machine) =>
      machine.config.mounts?.some((mount) => mount.path === '/data') &&
      (!restore || machine.id === restore.machineId),
  );

  if (games.length !== 1) {
    throw new Error(
      `Expected one game Machine in ${app}; found ${games.length}`,
    );
  }

  const machine = games[0];
  let original = machine.config;
  const directory = await mkdtemp(join(tmpdir(), 'unicorn-world-reset-'));
  const recovery = join(directory, 'machine.json');

  await writeFile(recovery, JSON.stringify(original), { mode: 0o600 });
  const path = `/${machine.id}`;
  const requestAPI = request;
  let leaseNonce: string | undefined;

  request = (path, body, options) =>
    requestAPI(path, body, { ...options, leaseNonce });

  const waitFor = async ({
    state,
    instanceId,
    afterExit = -1,
    updated = false,
    allowStarted = false,
    healthy = false,
  }: {
    state: string;
    instanceId?: string;
    afterExit?: number;
    updated?: boolean;
    allowStarted?: boolean;
    healthy?: boolean;
  }) => {
    for (let attempt = 0; attempt < 90; attempt++) {
      const current = (await request(path)) as Machine;

      if (
        (current.state === state ||
          (allowStarted && current.state === 'started')) &&
        (!instanceId || current.instance_id === instanceId) &&
        (!healthy ||
          (current.checks?.length &&
            current.checks.every((check) => check.status === 'passing'))) &&
        (!updated ||
          (allowStarted && current.state === 'started') ||
          current.events?.some(
            (event) => event.type === 'update' && event.status === state,
          )) &&
        (afterExit < 0 ||
          current.events?.some(
            (event) => event.type === 'exit' && event.timestamp > afterExit,
          ))
      ) {
        return current;
      }

      await pause();
    }

    throw new Error(`Machine ${machine.id} did not become ${state}`);
  };

  const update = async ({
    config,
    allowStarted = false,
  }: {
    config: Machine['config'];
    allowStarted?: boolean;
  }) => {
    const replacement = (await request(path, {
      config,
      skip_launch: true,
    })) as Machine;

    if (!replacement.instance_id) {
      throw new Error('Fly update returned no Machine version');
    }

    // Updates are asynchronous. An old version can still report stopped while
    // Fly is preparing its replacement; starting then can fail with HTTP 412.
    return waitFor({
      state: 'stopped',
      instanceId: replacement.instance_id,
      updated: true,
      allowStarted,
    });
  };

  const start = async (instanceId: string) => {
    try {
      await request(`${path}/start`, {});
    } catch (error) {
      // The restored services can autostart the game before this request.
      // Verify that this version is actually booting before accepting a race.
      const current = (await request(path)) as Machine;

      if (
        current.instance_id !== instanceId ||
        !['starting', 'started'].includes(current.state)
      ) {
        throw error;
      }
    }
  };

  console.log(
    `${restore ? 'Restoring game configuration' : 'Resetting world and player progress'} on ${app}/${machine.id}`,
  );

  try {
    const lease = (await requestAPI(`${path}/lease`, {
      description: 'World reset maintenance',
      ttl: 600,
    })) as { data?: { nonce?: string } };

    if (!lease.data?.nonce) {
      throw new Error('Fly did not return a Machine lease');
    }

    leaseNonce = lease.data.nonce;
    const locked = (await request(path)) as Machine;

    original = restore?.config ?? locked.config;
    await writeFile(recovery, JSON.stringify(original), { mode: 0o600 });

    if (!restore) {
      if (
        Object.values(original.init || {}).some(
          (value) => Array.isArray(value) && value.includes('--reset-world'),
        )
      ) {
        throw new Error(
          'The Machine still has a reset command configured. Restore the saved original configuration before resetting again.',
        );
      }

      // Remove services while the lease prevents proxy autostarts.
      await update({
        config: { ...original, services: [], restart: { policy: 'no' } },
      });

      const ready = await update({
        config: {
          ...original,
          services: [],
          restart: { policy: 'no' },
          init: { exec: ['/app/server', '--reset-world'] },
        },
      });

      const previousExit = Math.max(
        0,
        ...(ready.events || [])
          .filter((event) => event.type === 'exit')
          .map((event) => event.timestamp),
      );

      await start(ready.instance_id);

      const stopped = await waitFor({
        state: 'stopped',
        instanceId: ready.instance_id,
        afterExit: previousExit,
      });

      const exit = stopped.events?.find((event) => event.type === 'exit')
        ?.request?.exit_event;

      if (
        !exit ||
        (exit.guest_exit_code ?? 0) !== 0 ||
        (exit.exit_code ?? 0) !== 0 ||
        (exit.guest_signal ?? 0) > 0 ||
        exit.oom_killed ||
        exit.requested_stop
      ) {
        throw new Error(
          'Reset command did not exit successfully; inspect Fly logs',
        );
      }
    }

    const restored = await update({ config: original, allowStarted: true });

    if (restored.state !== 'started') await start(restored.instance_id);

    await waitFor({
      state: 'started',
      instanceId: restored.instance_id,
      healthy: original.services?.some(
        (service) => !!(service as { checks?: unknown[] }).checks?.length,
      ),
    });

    await rm(directory, { recursive: true });
    console.log(
      restore
        ? 'Original game configuration restored; no world reset was run.'
        : 'World reset and game restarted. The old database remains archived on /data.',
    );
  } catch (error) {
    console.error(`Original Machine config saved at ${recovery}. Restore with:
npm run reset-world:live -- ${app} --restore ${machine.id} ${recovery}`);
    throw error;
  } finally {
    if (leaseNonce) {
      await requestAPI(`${path}/lease`, undefined, {
        method: 'DELETE',
        leaseNonce,
      });
    }
  }
}

/**
 * Keep Fly's response body when an API request fails.
 */
export const createFlyRequest =
  ({
    app,
    token,
    fetchRequest = fetch,
  }: {
    app: string;
    token: string;
    fetchRequest?: typeof fetch;
  }) =>
  async (path: string, body?: unknown, options?: FlyRequestOptions) => {
    const response = await fetchRequest(
      `https://api.machines.dev/v1/apps/${encodeURIComponent(app)}/machines${path}`,
      {
        method: options?.method ?? (body === undefined ? 'GET' : 'POST'),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options?.leaseNonce && {
            'fly-machine-lease-nonce': options.leaseNonce,
          }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000),
      },
    );

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Fly request ${path} failed: HTTP ${response.status}${text ? `: ${text}` : ''}`,
      );
    }

    return text ? JSON.parse(text) : undefined;
  };

if (import.meta.main) {
  const config = await readFile(
    new URL('../fly.toml', import.meta.url),
    'utf8',
  );
  const [appArg, action, machineId, configPath] = process.argv.slice(2);
  const app = appArg || config.match(/^app\s*=\s*['"]([^'"]+)['"]/m)?.[1];

  if (!app) throw new Error('Specify the Fly app as an argument');

  if (action && (action !== '--restore' || !machineId || !configPath)) {
    throw new Error(
      'Usage: reset-world-live.ts [app] [--restore machine-id config-path]',
    );
  }

  const restore = action
    ? {
        machineId,
        config: JSON.parse(
          await readFile(configPath, 'utf8'),
        ) as Machine['config'],
      }
    : undefined;

  const token =
    process.env.FLY_API_TOKEN ||
    execFileSync(
      'fly',
      ['tokens', 'create', 'deploy', '--app', app, '--expiry', '15m'],
      { encoding: 'utf8' },
    ).trim();

  await resetWorldLive({
    app,
    request: createFlyRequest({ app, token }),
    restore,
  });
}
