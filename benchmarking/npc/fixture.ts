import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function prepareNPCFixture({
  directory,
  items = 6,
  manifestPath = 'benchmarking/_local/npc-fixture.json',
}: {
  directory: string;
  items?: number;
  manifestPath?: string;
}) {
  assert(
    Number.isInteger(items) && items >= 3 && items <= 48,
    'Use between 3 and 48 fixture items',
  );
  const output = resolve(directory);
  const manifest = resolve(manifestPath);

  mkdirSync(output, { recursive: true });
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(
    manifest,
    JSON.stringify({ directory: output, items }, null, 2) + '\n',
  );
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const manifest = prepareNPCFixture({
    directory: process.argv[2] || '/tmp/unicorn-npc-benchmark',
    items: Number(process.argv[3] || 6),
  });

  console.log(
    `Start the fixture watcher with SERVER_BENCHMARK_FIXTURES=1 NPC_BENCHMARK_FIXTURE="${manifest}" npm run dev:server`,
  );
}
