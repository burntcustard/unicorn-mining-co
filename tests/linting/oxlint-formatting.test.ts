import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'unicorn-formatting-'));
const file = join(directory, 'fixture.ts');
const lint = (...options: string[]) =>
  spawnSync(
    resolve('node_modules/.bin/oxlint'),
    ['-c', resolve('.oxlintrc.json'), '--no-ignore', ...options, file],
    { encoding: 'utf8' },
  );

try {
  writeFileSync(
    file,
    `import '../dependency';
// Following code must be separated too.
const unused = 1;

/** Compact documentation. */
export function check(value: number) {
  if (value > 1) value++;
  else if (value) value--;
  else value = 0;
  console.log(value);
  if (value) value++;
  return value;
}
`,
  );

  const invalid = lint();

  assert.equal(invalid.status, 1);
  assert.match(invalid.stdout, /no-unused-vars/);

  const formatting = lint('-A', 'correctness');

  assert.equal(formatting.status, 1);
  assert.doesNotMatch(formatting.stdout, /no-unused-vars/);

  const fixed = lint('-A', 'correctness', '--fix');

  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.equal(
    readFileSync(file, 'utf8'),
    `import '../dependency';

// Following code must be separated too.
const unused = 1;

// Compact documentation.
export function check(value: number) {
  if (value > 1) { value++; }
  else if (value) { value--; }
  else { value = 0; }
  console.log(value);

  if (value) value++;
  return value;
}
`,
  );
} finally {
  rmSync(directory, { recursive: true });
}
