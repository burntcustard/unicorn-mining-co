import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createFlyRequest } from './reset-world-live.ts';

/**
 * Inspect or remove backups through the deployed scratch image's executable.
 */
export async function backupsLive({
  app,
  request,
  deletePath,
  deleteAll = false,
  output = (text: string) => process.stdout.write(text),
}: {
  app: string;
  request: ReturnType<typeof createFlyRequest>;
  deletePath?: string;
  deleteAll?: boolean;
  output?: (text: string) => void;
}) {
  if (deletePath && deleteAll) {
    throw new Error('Choose one backup path or --all');
  }

  const machines = (await request('')) as {
    id: string;
    state: string;
    config: { mounts?: { path: string }[] };
  }[];

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
      `Machine ${machine.id} is ${machine.state}. Fly exec needs a running Machine; after failed reset maintenance, restore the saved configuration using the printed reset-world:live --restore command first.`,
    );
  }

  const command = deleteAll
    ? ['--delete-all-backups']
    : deletePath
      ? ['--delete-backup', deletePath]
      : ['--backups'];

  output(`Backups on ${app}/${machine.id}\n`);

  // Fly parses cmd into argv itself, so the scratch image needs no shell.
  // Quote each argument to keep paths with spaces or quotes as a single value.
  const result = (await request(`/${machine.id}/exec`, {
    cmd: ['/app/server', ...command]
      .map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
      .join(' '),
    timeout: 20,
  })) as {
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    exit_signal?: number;
  };

  if (result.stdout) output(result.stdout);

  // Fly can omit a zero exit code. Require the server's inventory summary too.
  if (
    (result.exit_code ?? 0) !== 0 ||
    (result.exit_signal ?? 0) > 0 ||
    !result.stdout?.includes('Backups:')
  ) {
    const detail = result.stderr?.trim();

    throw new Error(
      detail?.includes('flag provided but not defined')
        ? 'Deploy the server version with backup maintenance commands before using these scripts.'
        : `Backup command failed (exit ${result.exit_code ?? 'unknown'}, signal ${result.exit_signal ?? 0})${detail ? `: ${detail}` : ''}`,
    );
  }

  if (result.stderr) output(result.stderr);
}

/**
 * Require an explicit deletion target before authenticating with Fly.
 */
export function parseBackupArgs(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      app: { type: 'string' },
      delete: { type: 'boolean' },
      all: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });

  if (
    !values.help &&
    (positionals.includes('') ||
      positionals.length > 1 ||
      (values.delete
        ? Number(!!values.all) + positionals.length !== 1
        : !!values.all || positionals.length > 0))
  ) {
    throw new Error(
      'Usage: npm run backups:live -- [--app app]\n' +
        '       npm run backups:delete:live -- <full-backup-path|--all> [--app app]',
    );
  }

  return {
    app: values.app,
    deletePath: values.delete ? positionals[0] : undefined,
    deleteAll: !!values.all,
    help: !!values.help,
  };
}

if (import.meta.main) {
  try {
    const options = parseBackupArgs(process.argv.slice(2));

    if (options.help) {
      console.log(`List completed periodic backups, reset archives and volume disk space:
  npm run backups:live -- [--app app]
Delete one backup using its full path from the listing:
  npm run backups:delete:live -- /data/backups/world-<timestamp>.sqlite [--app app]
Delete all completed periodic backups and reset archives:
  npm run backups:delete:live -- --all [--app app]
Deletion reports counts and disk space before and after.
Requires a running Machine with the backup maintenance server version deployed.`);
    } else {
      const config = await readFile(
        new URL('../fly.toml', import.meta.url),
        'utf8',
      );
      const app =
        options.app || config.match(/^app\s*=\s*['"]([^'"]+)['"]/m)?.[1];

      if (!app) throw new Error('Specify the Fly app with --app');

      const token =
        process.env.FLY_API_TOKEN ||
        execFileSync(
          'fly',
          ['tokens', 'create', 'deploy', '--app', app, '--expiry', '15m'],
          { encoding: 'utf8' },
        ).trim();

      await backupsLive({
        ...options,
        app,
        request: createFlyRequest({ app, token }),
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
