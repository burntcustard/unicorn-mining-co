/* global process */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rolldown } from 'rolldown';
import { minify } from 'terser';
import {
  buildPlugin,
  buildPrePlugin,
  terserMangleOptions,
} from '../plugins/build-plugins.js';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.slice(2).split(/=(.*)/s, 2)),
);
const directory = await mkdtemp(join(tmpdir(), 'unicorn-motion-'));
const entry = options.bundle || options.save || join(directory, 'motion.mjs');

try {
  if (!options.bundle) {
    const baseline = options.baseline
      ? await readFile(options.baseline, 'utf8')
      : undefined;
    const entryId = resolve('src/__remote_motion_benchmark.ts');
    const workload = (
      await readFile('benchmarking/remote-motion-workload.ts', 'utf8')
    ).replaceAll("'../src/", "'./");
    const bundle = await rolldown({
      input: entryId,
      platform: 'node',
      plugins: [
        {
          name: 'motion-baseline',
          resolveId: (id) => (id === entryId ? entryId : undefined),
          load: (id) => (id === entryId ? workload : undefined),
          transform: (code, id) =>
            id.endsWith('/client/remote-motion.ts') && baseline !== undefined
              ? baseline
              : code,
        },
        { ...buildPrePlugin(), generateBundle: undefined },
        { ...buildPlugin(), generateBundle: undefined },
      ],
    });
    const { output } = await bundle.generate({ format: 'esm' });
    const compressed = await minify(output[0].code, {
      ...terserMangleOptions(),
      compress: { passes: 2 },
    });

    await writeFile(entry, compressed.code);
    await bundle.close();
  }
  // Keep native timing and output labels outside production property rewriting.
  const runner = join(directory, 'run.mjs');

  await writeFile(
    runner,
    `
import {motionFixture,replayMotion} from ${JSON.stringify(resolve(entry))};
const results=[];
// Prime all delivery paths before measuring: five replays alone left the first
// steady case unstable. This cycle is identical for both variants.
for (const scenario of ['steady','jitter','burst','slow','outage']) {
  const fixture=motionFixture([16,scenario]);
  for(let i=0;i<10;i++) replayMotion(fixture);
}
for (const players of [4,8,16]) for (const scenario of ['steady','jitter','burst','slow','outage']) {
  const fixture=motionFixture([players,scenario]);
  const quality=Object.values(replayMotion(fixture,true));
  for(let i=0;i<5;i++) replayMotion(fixture);
  const samples=[];
  for(let repeat=0;repeat<5;repeat++) {
    const start=process.cpuUsage();
    let checksum=0;
    for(let i=0;i<10;i++) checksum+=Object.values(replayMotion(fixture))[0];
    const cpu=process.cpuUsage(start);
    samples.push({cpuMs:(cpu.user+cpu.system)/1000/10,checksum});
  }
  results.push({players,scenario,quality:Object.fromEntries(['checksum','stalls','backwards','meanLagMs','meanSpeedChange','maxLagMs'].map((key,i)=>[key,quality[i]])),samples});
}
console.log(JSON.stringify(results));
`,
  );
  const child = spawnSync(
    process.execPath,
    ['--max-semi-space-size=16', runner],
    { encoding: 'utf8', timeout: 290000, maxBuffer: 4 * 1024 * 1024 },
  );

  assert.equal(child.status, 0, child.stderr || String(child.error));
  console.log(child.stdout.trim());
} finally {
  await rm(directory, { recursive: true, force: true });
}
