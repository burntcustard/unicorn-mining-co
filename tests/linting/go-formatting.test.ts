import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'go-spacing-'));
const binary = join(directory, 'formatter');
const file = join(directory, 'fixture.go');
const source = `//go:build fixture

package fixture

type First struct{ Value int }
// Second documents the next declaration.
type Second interface{ Run() }
func compact() { }
//go:noinline
func example(value int) {
 text := ${'`'}braces {
}
if fake {
}${'`'}
 _ = text
 // Decide which branch to take.
 if value > 0 {
  value++
 } else {
  value--
 }
 for value < 5 {
  value++
 }
 // Keep this comment with the return.
 return
}
func branches(value int, ready chan bool) {
 switch value {
 case 0:
  value++
  if value > 0 {
   value++
  }
  value--
 }
 select {
 case <-ready:
  value++
  for value < 5 {
   value++
  }
  value--
 default:
 }
}
`;

try {
  const build = spawnSync(
    'go',
    ['build', '-o', binary, './scripts/go-formatter.go'],
    {
      encoding: 'utf8',
    },
  );

  assert.equal(build.status, 0, build.stdout + build.stderr);

  const run = (...args: string[]) =>
    spawnSync(binary, args, { encoding: 'utf8' });

  writeFileSync(file, source);
  const check = run('--check', file);

  assert.equal(check.status, 1);
  assert.equal(check.stdout.trim(), file);
  assert.equal(readFileSync(file, 'utf8'), source, 'check never writes');
  const fix = run(file);

  assert.equal(fix.status, 0, fix.stderr);
  const fixed = readFileSync(file, 'utf8');

  assert.match(fixed, /struct\{ Value int \}\n\n\/\/ Second/);
  assert.match(fixed, /interface\{ Run\(\) \}\n\nfunc compact/);
  assert.match(
    fixed,
    /func compact\(\)\s*\{\}\n\n\/\/go:noinline\nfunc example/,
  );
  assert.match(fixed, /_ = text\n\n\t\/\/ Decide[^\n]*\n\tif /);
  assert.match(fixed, /\n\t\} else \{\n/);
  assert.match(fixed, /\n\t\}\n\n\tfor value/);
  assert.match(fixed, /\n\t\}\n\n\t\/\/ Keep[^\n]*\n\treturn/);
  assert.match(fixed, /\n\}\n\nfunc branches/);
  assert.match(fixed, /\n\t\}\n\n\tselect/);
  assert.match(fixed, /value\+\+\n\n\t\tif value/);
  assert.match(fixed, /value\+\+\n\n\t\tfor value/);
  assert.match(fixed, /\n\t\t\}\n\n\t\tvalue--/);
  assert.ok(fixed.includes(`${'`'}braces {\n}\nif fake {\n}${'`'}`));
  assert.ok(fixed.startsWith('//go:build fixture\n\npackage fixture\n'));
  const gofmt = spawnSync('gofmt', [], { input: fixed, encoding: 'utf8' });

  assert.equal(gofmt.status, 0, gofmt.stderr);
  assert.equal(gofmt.stdout, fixed, 'spacing survives gofmt');
  assert.equal(run('--check', file).status, 0);
  assert.equal(run(file).status, 0);
  assert.equal(readFileSync(file, 'utf8'), fixed, 'formatting is idempotent');
  const invalid = 'package fixture\nfunc broken( {\n';

  writeFileSync(file, invalid);
  assert.equal(run(file).status, 1);
  assert.equal(
    readFileSync(file, 'utf8'),
    invalid,
    'invalid source is untouched',
  );
  console.log('Go block spacing, check mode, and gofmt compatibility pass');
} finally {
  rmSync(directory, { recursive: true });
}
