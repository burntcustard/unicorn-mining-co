import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve('.');
const output = process.argv[2];

assert(
  output,
  'Usage: node benchmarking/remote-consistency-screen.mjs OUTPUT.json',
);
const variants = [];
const sourcePaths = [
  'src/client/remote-motion.ts',
  'src/client/frame-prediction.ts',
];
const sources = process.env.REMOTE_SCREEN_SOURCE
  ? JSON.parse(gunzipSync(readFileSync(process.env.REMOTE_SCREEN_SOURCE)))
      .sources.after
  : Object.fromEntries(
      sourcePaths.map((path) => [path, readFileSync(path, 'utf8')]),
    );

for (const width of (process.env.REMOTE_SCREEN_WIDTHS || '3,4,6')
  .split(',')
  .map(Number)) {
  for (const damping of [1, 1.5, 2]) {
    const path = `${root}/bin/remote-consistency-screen-${width}-${damping}.mjs`;
    const bundle = await rolldown({
      input: root + '/tests/remote-perspectives.test.ts',
      platform: 'node',
      external: ['ws', /^node:/],
      plugins: [
        {
          name: 'variant',
          transform(source, id) {
            if (id.endsWith('/src/client/remote-motion.ts')) {
              const code = sources['src/client/remote-motion.ts'];

              return code
                .replace(
                  '3 * Vec.length(difference)',
                  `${width} * Vec.length(difference)`,
                )
                .replace('Math.max(0, age)', `${damping} * Math.max(0, age)`)
                .replace(
                  'const correctionRate = 1 / simulationStep;',
                  `const correctionRate = ${damping} / simulationStep;`,
                );
            }

            if (id.endsWith('/src/client/frame-prediction.ts')) {
              return sources['src/client/frame-prediction.ts'].replace(
                '3 * maxPredictionTicks',
                `${width} * maxPredictionTicks`,
              );
            }
          },
        },
      ],
    });

    await bundle.write({ file: path, format: 'esm', codeSplitting: false });
    await bundle.close();
    variants.push({ width, damping, path });
  }
}
const results = [];

try {
  for (let i = 0; i < variants.length; i += 3) {
    const group = await Promise.allSettled(
      variants.slice(i, i + 3).map(async (v) => {
        const { stdout, stderr } = await run(process.execPath, [v.path], {
          cwd: root,
          maxBuffer: 4e6,
        });

        if (!stdout.trim()) {
          throw new Error(`Empty output: ${v.width}/${v.damping}: ${stderr}`);
        }
        const rows = stdout.trim().split('\n').map(JSON.parse);

        return { ...v, rows };
      }),
    );

    for (const r of group) {
      if (r.status === 'rejected') throw r.reason;
      results.push(r.value);
      const v = r.value;

      console.log(
        JSON.stringify({
          width: v.width,
          damping: v.damping,
          roughness: v.rows.map((x) => [
            x.delivery,
            x.fps,
            x.rmsChange,
            x.maxChange,
          ]),
        }),
      );
    }
  }
  const data = JSON.stringify(
    {
      sources: Object.fromEntries(
        sourcePaths.map((path) => [path, sources[path]]),
      ),
      hashes: Object.fromEntries(
        sourcePaths.map((path) => [
          path,
          createHash('sha256').update(sources[path]).digest('hex'),
        ]),
      ),
      results,
    },
    null,
    2,
  );

  writeFileSync(
    output,
    output.endsWith('.gz') ? gzipSync(data, { level: 9 }) : data,
  );
} finally {
  variants.forEach((v) => rmSync(v.path, { force: true }));
}
