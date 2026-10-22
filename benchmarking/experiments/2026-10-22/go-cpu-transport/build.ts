import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [variant, destination, target = 'session'] = process.argv.slice(2);

assert(
  ['before', 'after'].includes(variant) &&
    destination &&
    ['session', 'transport'].includes(target),
  'Usage: node benchmarking/experiments/2026-10-22/go-cpu-transport/build.ts before|after OUTPUT [session|transport]',
);

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const manifest = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const input = manifest.variants[variant];
const replacements = Object.fromEntries(
  Object.entries({ ...input.files, ...manifest.commonFiles }).map(
    ([path, snapshot]) => [
      resolve(repository, path),
      snapshot === null ? '' : resolve(here, snapshot as string),
    ],
  ),
);
const sourceHash = createHash('sha256');

for (const path of [
  ...new Set([
    ...readdirSync(join(repository, 'src/server'), {
      recursive: true,
      encoding: 'utf8',
    })
      .filter((p) => p.endsWith('.go'))
      .map((p) => 'src/server/' + p),
    ...Object.keys(input.files),
  ]),
]
  .filter((p) => p.endsWith('.go') && !p.endsWith('_test.go'))
  .sort()) {
  const source =
    replacements[resolve(repository, path)] ?? resolve(repository, path);

  if (!source) continue;
  sourceHash.update(`${path}\0`);
  sourceHash.update(readFileSync(source));
  sourceHash.update('\0');
}

assert.equal(
  sourceHash.digest('hex'),
  manifest.productionSourceSha256[variant],
  `Source differs from this capture. Use commit ${manifest.baselineRevision} and regenerate its catalogs.`,
);

const profile = resolve(here, input.profile);

assert.equal(
  createHash('sha256').update(readFileSync(profile)).digest('hex'),
  input.profileSha256,
  'PGO profile differs from this capture',
);
assert.equal(
  execFileSync('go', ['env', 'GOVERSION'], { encoding: 'utf8' }).trim(),
  'go1.27.1',
);

const temporary = mkdtempSync(join(tmpdir(), 'unicorn-cpu-reproduce-'));

try {
  const overlay = join(temporary, 'overlay.json');

  for (const [name, input] of Object.entries(manifest.modules) as [
    string,
    { snapshot: string; sha256: string },
  ][]) {
    const data = readFileSync(join(here, input.snapshot));

    assert.equal(createHash('sha256').update(data).digest('hex'), input.sha256);
    writeFileSync(join(temporary, name), data);
  }

  writeFileSync(overlay, JSON.stringify({ Replace: replacements }));

  const result = spawnSync(
    'go',
    [
      ...(target === 'session' ? ['test', '-c'] : ['build']),
      `-overlay=${overlay}`,
      `-modfile=${join(temporary, 'go.mod')}`,
      `-pgo=${profile}`,
      '-o',
      resolve(destination),
      target === 'session'
        ? './src/server/network'
        : './benchmarking/tools/websocket-transport',
    ],
    {
      cwd: repository,
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOEXPERIMENT: 'simd',
        GOAMD64: 'v1',
        GOFLAGS: '',
      },
      stdio: 'inherit',
    },
  );

  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Go benchmark build failed');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
