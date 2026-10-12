import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

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
    mounts?: { path: string; volume?: string }[];
    init?: Record<string, unknown>;
    restart?: Record<string, unknown>;
    services?: unknown[];
    [key: string]: unknown;
  };
};

/**
 * Accept maintenance flags with either the configured app or an explicit app.
 */
export function parseResetArgs(args: string[]) {
  const normalized = args[0]?.startsWith('--') ? ['', ...args] : args;
  const [app, action, machineId, configPath] = normalized;

  if (
    action === '--resume'
      ? normalized.length !== 2
      : action
        ? action !== '--restore' ||
          normalized.length !== 4 ||
          !machineId ||
          !configPath
        : normalized.length > 1
  ) {
    throw new Error(
      'Usage: reset-world-live.ts [app] [--resume | --restore machine-id config-path]',
    );
  }

  return {
    app: app || undefined,
    resume: action === '--resume',
    restore: action === '--restore' ? { machineId, configPath } : undefined,
  };
}

/**
 * Restore startup settings while keeping the volumes currently mounted at
 * those paths. Fly can change volume IDs when it migrates a Machine.
 */
export function restoreVolumeConfig({
  saved,
  current,
}: {
  saved: Machine['config'];
  current: Machine['config'];
}) {
  const mounts = saved.mounts || [];
  const attached = current.mounts || [];

  if (
    mounts.length !== attached.length ||
    new Set(mounts.map((mount) => mount.path)).size !== mounts.length ||
    mounts.some(
      (mount) =>
        attached.filter((candidate) => candidate.path === mount.path).length !==
        1,
    )
  ) {
    throw new Error(
      'Saved and current volume mount paths differ; refusing to replace attached data volumes',
    );
  }

  return {
    ...saved,
    mounts: mounts.map((mount) => {
      const active = attached.find(
        (candidate) => candidate.path === mount.path,
      )!;

      if (!active.volume) {
        throw new Error(`Current mount ${mount.path} has no volume ID`);
      }

      return { ...mount, ...active };
    }),
  };
}

function hasResetCommand(config: Machine['config']) {
  return Object.values(config.init || {}).some(
    (value) =>
      Array.isArray(value) &&
      value.some(
        (argument) =>
          typeof argument === 'string' &&
          /^--reset-world(?:-live)?(?:=|$)/.test(argument),
      ),
  );
}

/**
 * Reset or resume through the running server's private maintenance socket.
 * Configuration restoration remains available for older interrupted resets.
 */
export async function resetWorldLive({
  app,
  request,
  pause = () => setTimeout(1000),
  restore,
  resume = false,
}: {
  app: string;
  request: (
    path: string,
    body?: unknown,
    options?: FlyRequestOptions,
  ) => Promise<unknown>;
  pause?: () => Promise<void>;
  restore?: { machineId: string; config: Machine['config'] };
  resume?: boolean;
}) {
  if (restore && resume) throw new Error('Choose restore or resume');

  const machines = (await request('')) as Machine[];
  const games = machines.filter(
    (machine) =>
      machine.config?.mounts?.some((mount) => mount.path === '/data') &&
      (!restore || machine.id === restore.machineId),
  );

  if (games.length !== 1) {
    throw new Error(
      `Expected one game Machine in ${app}; found ${games.length}`,
    );
  }

  const machine = games[0];
  const path = `/${machine.id}`;
  const requestAPI = request;
  let leaseNonce: string | undefined;
  let directory: string | undefined;
  let recovery: string | undefined;
  let original = machine.config;

  request = (path, body, options) =>
    requestAPI(path, body, { ...options, leaseNonce });

  const waitFor = async ({
    instanceId,
    healthy = false,
  }: {
    instanceId?: string;
    healthy?: boolean;
  } = {}) => {
    for (let attempt = 0; attempt < 90; attempt++) {
      const current = (await request(path)) as Machine;

      if (
        current.state === 'started' &&
        (!instanceId || current.instance_id === instanceId) &&
        (!healthy ||
          (current.checks?.length &&
            current.checks.every((check) => check.status === 'passing')))
      ) {
        return current;
      }

      await pause();
    }

    throw new Error(`Machine ${machine.id} did not become healthy and started`);
  };

  const needsHealth = (config: Machine['config']) =>
    config.services?.some(
      (service) => !!(service as { checks?: unknown[] }).checks?.length,
    );

  console.log(
    `${restore ? 'Restoring game configuration' : resume ? 'Resuming game' : 'Resetting world and player progress'} on ${app}/${machine.id}`,
  );

  try {
    // Fly exec rejects a Machine with an externally held lease, even with
    // its nonce supplied. The private socket serializes live maintenance.
    if (restore) {
      const lease = (await requestAPI(`${path}/lease`, {
        description: 'World configuration recovery',
        ttl: 600,
      })) as { data?: { nonce?: string } };

      if (!lease.data?.nonce) {
        throw new Error('Fly did not return a Machine lease');
      }

      leaseNonce = lease.data.nonce;
    }

    let locked = (await request(path)) as Machine;

    if (restore) {
      if (hasResetCommand(restore.config)) {
        throw new Error(
          'The saved configuration contains a reset command; use the original game configuration',
        );
      }

      original = restoreVolumeConfig({
        saved: restore.config,
        current: locked.config,
      });

      directory = await mkdtemp(join(tmpdir(), 'unicorn-world-reset-'));
      recovery = join(directory, 'machine.json');
      await writeFile(recovery, JSON.stringify(original), { mode: 0o600 });

      // Starting an ordinary game can let Fly migrate it away from a full host.
      // Never boot a legacy offline-reset command while trying to recover.
      if (
        locked.state === 'stopped' &&
        !hasResetCommand(locked.config) &&
        locked.config.image === original.image &&
        isDeepStrictEqual(locked.config.env, original.env) &&
        isDeepStrictEqual(locked.config.init || {}, original.init || {})
      ) {
        try {
          await request(`${path}/start`, {});
        } catch (error) {
          const current = (await request(path)) as Machine;

          if (
            !['starting', 'started'].includes(current.state) ||
            hasResetCommand(current.config)
          ) {
            throw error;
          }
        }

        locked = await waitFor();
      }

      // Read again after startup: automatic migration can replace the volume.
      locked = (await request(path)) as Machine;

      original = restoreVolumeConfig({
        saved: restore.config,
        current: locked.config,
      });

      await writeFile(recovery, JSON.stringify(original), { mode: 0o600 });

      const restored = (await request(path, {
        config: original,
        skip_launch: false,
      })) as Machine;

      if (!restored.instance_id) {
        throw new Error('Fly update returned no Machine version');
      }

      await waitFor({
        instanceId: restored.instance_id,
        healthy: needsHealth(original),
      });

      await rm(directory, { recursive: true });
      console.log(
        'Original game configuration restored; no world reset was run.',
      );
      return;
    }

    if (locked.state !== 'started' || hasResetCommand(locked.config)) {
      throw new Error(
        'The game Machine must already be running with its normal startup command; restore interrupted legacy maintenance first',
      );
    }

    const result = (await request(`${path}/exec`, {
      cmd: `/app/server --${resume ? 'resume' : 'reset'}-world-live`,
      timeout: 25,
    })) as {
      exit_code?: number;
      exit_signal?: number;
      stdout?: string;
      stderr?: string;
    };

    const marker = resume
      ? 'Game running; no world reset was run.'
      : 'World reset complete;';

    if (
      (result.exit_code ?? 0) !== 0 ||
      (result.exit_signal ?? 0) > 0 ||
      !result.stdout?.includes(marker)
    ) {
      if (result.stderr?.includes('flag provided but not defined')) {
        throw new Error(
          'Deploy the server version with live maintenance commands before resetting; no Machine configuration was changed',
        );
      }

      throw new Error(
        `Live maintenance did not complete successfully${result.stderr ? `: ${result.stderr.trim()}` : ''}`,
      );
    }

    console.log(result.stdout.trim());

    await waitFor({
      instanceId: locked.instance_id,
      healthy: needsHealth(locked.config),
    });

    console.log(
      'Game healthy; the Machine stayed running throughout maintenance.',
    );
  } catch (error) {
    if (recovery) {
      console.error(
        `Recovery config saved at ${recovery}. Restore with:\nnpm run reset-world:live -- ${app} --restore ${machine.id} ${recovery}`,
      );
    } else {
      console.error(
        `Do not automatically retry a reset after a timeout. To resume after failed server maintenance without another reset:\nnpm run reset-world:live -- ${app} --resume`,
      );
    }

    throw error;
  } finally {
    if (leaseNonce) {
      try {
        await requestAPI(`${path}/lease`, undefined, {
          method: 'DELETE',
          leaseNonce,
        });
      } catch (error) {
        console.error(
          'Could not release the recovery lease; it expires automatically:',
          error,
        );
      }
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
  if (process.env.npm_config_restore || process.env.npm_config_resume) {
    throw new Error(
      'Put a standalone -- before script flags, for example: npm run reset-world:live -- --resume',
    );
  }

  const config = await readFile(
    new URL('../fly.toml', import.meta.url),
    'utf8',
  );
  const options = parseResetArgs(process.argv.slice(2));
  const app = options.app || config.match(/^app\s*=\s*['"]([^'"]+)['"]/m)?.[1];

  if (!app) throw new Error('Specify the Fly app as an argument');

  const restore = options.restore
    ? {
        machineId: options.restore.machineId,
        config: JSON.parse(
          await readFile(options.restore.configPath, 'utf8'),
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
    resume: options.resume,
  });
}
