import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

type Machine = {
  id: string;
  state: string;
  config: {
    mounts?: { path: string }[];
    init?: Record<string, unknown>;
    restart?: Record<string, unknown>;
    services?: unknown[];
    [key: string]: unknown;
  };
  events?: {
    type: string;
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
}: {
  app: string;
  request: (path: string, body?: unknown) => Promise<unknown>;
  pause?: () => Promise<void>;
}) {
  const machines = (await request('')) as Machine[];
  const games = machines.filter((machine) =>
    machine.config.mounts?.some((mount) => mount.path === '/data'),
  );

  if (games.length !== 1) {
    throw new Error(
      `Expected one game Machine in ${app}; found ${games.length}`,
    );
  }

  const machine = games[0];
  const original = machine.config;
  const directory = await mkdtemp(join(tmpdir(), 'unicorn-world-reset-'));
  const recovery = join(directory, 'machine.json');

  await writeFile(recovery, JSON.stringify(original), { mode: 0o600 });
  const path = `/${machine.id}`;

  const waitFor = async (state: string, afterExit = -1) => {
    for (let attempt = 0; attempt < 90; attempt++) {
      const current = (await request(path)) as Machine;

      if (
        current.state === state &&
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

  console.log(`Resetting world and player progress on ${app}/${machine.id}`);

  try {
    // Removing services prevents Fly Proxy from restarting the game while the
    // existing process shuts down and its volume is reset.
    await request(path, {
      config: { ...original, services: [], restart: { policy: 'no' } },
      skip_launch: true,
    });

    const parked = (await request(path)) as Machine;

    if (parked.state !== 'stopped') {
      await request(`${path}/stop`, { signal: 'SIGTERM', timeout: '10s' });
    }

    await waitFor('stopped');

    await request(path, {
      config: {
        ...original,
        services: [],
        restart: { policy: 'no' },
        init: { exec: ['/app/server', '--reset-world'] },
      },
      skip_launch: true,
    });

    const ready = (await request(path)) as Machine;
    const previousExit = Math.max(
      0,
      ...(ready.events || [])
        .filter((event) => event.type === 'exit')
        .map((event) => event.timestamp),
    );

    await request(`${path}/start`, {});
    const stopped = await waitFor('stopped', previousExit);
    const exit = stopped.events?.find((event) => event.type === 'exit')?.request
      ?.exit_event;

    if (
      !exit ||
      (exit.guest_exit_code ?? 0) !== 0 ||
      (exit.exit_code ?? 0) !== 0 ||
      exit.guest_signal ||
      exit.oom_killed ||
      exit.requested_stop
    ) {
      throw new Error(
        'Reset command did not exit successfully; inspect Fly logs',
      );
    }

    await request(path, { config: original, skip_launch: true });
    await request(`${path}/start`, {});
    await waitFor('started');
    await rm(directory, { recursive: true });
    console.log(
      'World reset and game restarted. The old database remains archived on /data.',
    );
  } catch (error) {
    console.error(`Original Machine config saved at ${recovery}. Restore with:
fly machine update ${machine.id} --app ${app} --machine-config ${recovery} --skip-start --yes
fly machine start ${machine.id} --app ${app}`);
    throw error;
  }
}

if (import.meta.main) {
  const config = await readFile(
    new URL('../fly.toml', import.meta.url),
    'utf8',
  );
  const app =
    process.argv[2] || config.match(/^app\s*=\s*['"]([^'"]+)['"]/m)?.[1];

  if (!app) throw new Error('Specify the Fly app as an argument');
  const token =
    process.env.FLY_API_TOKEN ||
    execFileSync('fly', ['auth', 'token'], { encoding: 'utf8' }).trim();

  await resetWorldLive({
    app,
    request: async (path, body) => {
      const response = await fetch(
        `https://api.machines.dev/v1/apps/${encodeURIComponent(app)}/machines${path}`,
        {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          ...(body !== undefined && { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(30000),
        },
      );

      if (!response.ok) {
        throw new Error(`Fly request ${path} failed: HTTP ${response.status}`);
      }

      const text = await response.text();

      return text ? JSON.parse(text) : undefined;
    },
  });
}
