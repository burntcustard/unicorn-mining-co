import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parseShipDestructionLimit, shipDestructionFlags } from './options.ts';

export function preparePirateRenderingFixture({
  directory,
  untilShipDestroyed = false,
  shipDestructionLimit = untilShipDestroyed ? 1 : 0,
}: {
  directory: string;
  untilShipDestroyed?: boolean;
  shipDestructionLimit?: number;
}) {
  const output = resolve(directory);
  const manifest = resolve('benchmarking/_local/rendering-pirate-fixture.json');

  mkdirSync(output, { recursive: true });
  mkdirSync(dirname(manifest), { recursive: true });

  writeFileSync(
    manifest,
    JSON.stringify(
      {
        directory: output,
        untilShipDestroyed: shipDestructionLimit > 0,
        ...(shipDestructionLimit > 1 && { shipDestructionLimit }),
      },
      null,
      2,
    ) + '\n',
  );

  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: shipDestructionFlags,
  });

  const manifest = preparePirateRenderingFixture({
    directory: positionals[0] || '/tmp/unicorn-pirate-rendering',
    shipDestructionLimit: parseShipDestructionLimit(values),
  });

  console.log(
    `Start the fixture watcher with SERVER_BENCHMARK_FIXTURES=1 PIRATE_BENCHMARK_FIXTURE="${manifest}" npm run dev:server`,
  );
}
