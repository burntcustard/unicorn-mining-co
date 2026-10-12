import { parseArgs } from 'node:util';
import {
  executeGameCommand,
  getFlyApp,
  getGameMachine,
  runFly,
} from './fly-maintenance.ts';

/**
 * Inspect or remove backups through the deployed scratch image's executable.
 */
export async function backupsLive({
  app,
  run = runFly,
  deletePath,
  deleteAll = false,
  output = (text: string) => process.stdout.write(text),
}: {
  app: string;
  run?: typeof runFly;
  deletePath?: string;
  deleteAll?: boolean;
  output?: (text: string) => void;
}) {
  if (deletePath && deleteAll) {
    throw new Error('Choose one backup path or --all');
  }

  const machine = await getGameMachine({ app, run });

  const command = deleteAll
    ? ['--delete-all-backups']
    : deletePath
      ? ['--delete-backup', deletePath]
      : ['--backups'];

  output(`Backups on ${app}/${machine.id}\n`);

  output(
    (await executeGameCommand({
      app,
      machine,
      run,
      args: command,
      marker: 'Backups:',
    })) + '\n',
  );
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
      await backupsLive({
        ...options,
        app: await getFlyApp(options.app),
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
