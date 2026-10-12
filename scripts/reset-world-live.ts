import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  executeGameCommand,
  getFlyApp,
  getGameMachine,
  runFly,
} from './fly-maintenance.ts';

/**
 * Accept an optional app and resume flag; reject obsolete restore commands.
 */
export function parseResetArgs(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { resume: { type: 'boolean' }, help: { type: 'boolean' } },
  });

  if (positionals.length > 1 || positionals.includes('')) {
    throw new Error('Usage: reset-world-live.ts [app] [--resume]');
  }

  return { app: positionals[0], resume: !!values.resume, help: !!values.help };
}

/**
 * Reset or resume inside the running Machine, then verify its health.
 */
export async function resetWorldLive({
  app,
  run = runFly,
  pause = () => setTimeout(1000),
  resume = false,
}: {
  app: string;
  run?: typeof runFly;
  pause?: () => Promise<void>;
  resume?: boolean;
}) {
  const machine = await getGameMachine({ app, run });

  console.log(
    `${resume ? 'Resuming game' : 'Resetting world and player progress'} on ${app}/${machine.id}`,
  );

  try {
    console.log(
      await executeGameCommand({
        app,
        machine,
        run,
        args: [`--${resume ? 'resume' : 'reset'}-world-live`],
        marker: resume
          ? 'Game running; no world reset was run.'
          : 'World reset complete;',
      }),
    );

    const needsHealth = machine.config.services?.some(
      (service) => service.checks?.length,
    );

    for (let attempt = 0; attempt < 90; attempt++) {
      const current = await getGameMachine({ app, run });

      if (
        current.id !== machine.id ||
        current.instance_id !== machine.instance_id
      ) {
        throw new Error(
          'The Machine changed during maintenance; inspect its state before continuing',
        );
      }

      if (
        !needsHealth ||
        (current.checks?.length &&
          current.checks.every((check) => check.status === 'passing'))
      ) {
        console.log(
          'Game ready; the Machine stayed running throughout maintenance.',
        );
        return;
      }

      await pause();
    }

    throw new Error(`Machine ${machine.id} did not become healthy`);
  } catch (error) {
    console.error(
      `Do not retry an uncertain reset automatically. To resume without another reset:\nnpm run reset-world:live -- ${app} --resume`,
    );
    throw error;
  }
}

if (import.meta.main) {
  try {
    if (process.env.npm_config_restore || process.env.npm_config_resume) {
      throw new Error(
        'Put a standalone -- before script flags, for example: npm run reset-world:live -- --resume',
      );
    }

    const options = parseResetArgs(process.argv.slice(2));

    if (options.help) {
      console.log(
        'Reset the live world and player progress:\n  npm run reset-world:live -- [app]\nResume after failed maintenance without another reset:\n  npm run reset-world:live -- [app] --resume',
      );
    } else {
      await resetWorldLive({ ...options, app: await getFlyApp(options.app) });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
