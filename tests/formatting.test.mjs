import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'import-spacing-'));
const file = join(directory, 'fixture.ts');
const source =
  "import './dependency';\n// Following code must be separated too.\nexport const value = 1;\n";
const lint = ({ config, fix = false }) =>
  spawnSync(
    resolve('node_modules/.bin/oxlint'),
    ['-c', resolve(config), '--no-ignore', ...(fix ? ['--fix'] : []), file],
    { encoding: 'utf8' },
  );

try {
  writeFileSync(file, source);
  assert.equal(
    lint({ config: '.oxlintrc.json' }).status,
    1,
    'normal lint rejects missing import spacing',
  );
  assert.equal(
    lint({ config: '.oxlint-format.json' }).status,
    1,
    'format check rejects missing import spacing',
  );
  assert.equal(
    lint({ config: '.oxlint-format.json', fix: true }).status,
    0,
    'format fixes import spacing',
  );
  assert.equal(readFileSync(file, 'utf8'), source.replace("';\n", "';\n\n"));
  assert.equal(
    lint({ config: '.oxlintrc.json' }).status,
    0,
    'formatted imports pass normal lint',
  );
  console.log('Import spacing is enforced and automatically fixed');
} finally {
  rmSync(directory, { recursive: true });
}
