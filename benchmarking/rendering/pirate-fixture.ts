import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function preparePirateRenderingFixture(directory: string) {
  const output = resolve(directory);
  const manifest = resolve('benchmarking/_local/rendering-pirate-fixture.json');

  mkdirSync(output, { recursive: true });
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(
    manifest,
    JSON.stringify({ directory: output }, null, 2) + '\n',
  );
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const manifest = preparePirateRenderingFixture(
    process.argv[2] || '/tmp/unicorn-pirate-rendering',
  );

  console.log(
    `Start the fixture watcher with SERVER_BENCHMARK_FIXTURES=1 PIRATE_BENCHMARK_FIXTURE="${manifest}" npm run dev:server`,
  );
}
