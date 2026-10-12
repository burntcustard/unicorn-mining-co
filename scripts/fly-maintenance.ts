import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

type Machine = {
  id: string;
  instance_id: string;
  state: string;
  checks?: { status: string }[];
  config: {
    mounts?: { path: string }[];
    services?: { checks?: unknown[] }[];
  };
};

/**
 * Let the installed Fly CLI handle authentication and API requests.
 */
export async function runFly(args: string[]): Promise<unknown> {
  const { stdout } = await promisify(execFile)('fly', args, {
    encoding: 'utf8',
    timeout: 35000,
  });

  return JSON.parse(stdout);
}

export async function getFlyApp(app?: string) {
  if (app) return app;
  const config = await readFile(
    new URL('../fly.toml', import.meta.url),
    'utf8',
  );
  const configured = config.match(/^app\s*=\s*['"]([^'"]+)['"]/m)?.[1];

  if (!configured) throw new Error('Specify the Fly app');
  return configured;
}

export async function getGameMachine({
  app,
  run = runFly,
}: {
  app: string;
  run?: typeof runFly;
}) {
  const machines = (await run([
    'machine',
    'list',
    '--app',
    app,
    '--json',
  ])) as Machine[];
  const games = machines.filter((machine) =>
    machine.config?.mounts?.some((mount) => mount.path === '/data'),
  );

  if (games.length !== 1) {
    throw new Error(
      `Expected one game Machine in ${app}; found ${games.length}`,
    );
  }

  const machine = games[0];

  if (machine.state !== 'started') {
    throw new Error(
      `Machine ${machine.id} is ${machine.state}; maintenance requires a running Machine`,
    );
  }

  return machine;
}

/**
 * Execute only the game binary, keeping each argument intact in Fly's parser.
 */
export async function executeGameCommand({
  app,
  machine,
  args,
  marker,
  run = runFly,
}: {
  app: string;
  machine: Machine;
  args: string[];
  marker: string;
  run?: typeof runFly;
}) {
  const command = ['/app/server', ...args]
    .map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
    .join(' ');

  const result = (await run([
    'machine',
    'exec',
    machine.id,
    command,
    '--app',
    app,
    '--json',
    '--timeout',
    '25',
  ])) as {
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    exit_signal?: number;
  };

  // Fly may omit a zero exit code; require the command's success message too.
  if (
    (result.exit_code ?? 0) !== 0 ||
    (result.exit_signal ?? 0) > 0 ||
    !result.stdout?.includes(marker)
  ) {
    throw new Error(
      `Maintenance command failed (exit ${result.exit_code ?? 'unknown'}, signal ${result.exit_signal ?? 0})${result.stderr ? `: ${result.stderr.trim()}` : ''}`,
    );
  }

  return result.stdout.trim();
}
