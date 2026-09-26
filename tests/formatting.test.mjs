import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'import-spacing-'));
const file = join(directory, 'fixture.ts');
const spacingFile = join(directory, 'spacing.ts');
const inlineFile = join(directory, 'inline.ts');
const commentFile = join(directory, 'comments.ts');
const source =
  "import './dependency';\n// Following code must be separated too.\nexport const value = 1;\n";
const lint = ({ config, fix = false, target = file }) =>
  spawnSync(
    resolve('node_modules/.bin/oxlint'),
    ['-c', resolve(config), '--no-ignore', ...(fix ? ['--fix'] : []), target],
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
  writeFileSync(
    spacingFile,
    'function example() {\n  const a = 1;\n  const b = 2;\n  console.log(a);\n  if (\n    a &&\n    b\n  )\n    console.log(b);\n  for (const value of [a, b]) {\n    console.log(value);\n  }\n  switch (a) {\n    case 1:\n      break;\n    case 2:\n      break;\n  }\n}\n',
  );
  const checkSpacing = (fix = false, target = spacingFile) =>
    spawnSync(
      resolve('node_modules/.bin/oxlint'),
      [
        '-c',
        resolve('.oxlint-format.json'),
        '--no-ignore',
        ...(fix ? ['--fix'] : []),
        target,
      ],
      { encoding: 'utf8' },
    );

  assert.equal(checkSpacing().status, 1, 'missing braces and spacing fail');
  const fixedResult = checkSpacing(true);

  assert.equal(fixedResult.status, 0, fixedResult.stdout + fixedResult.stderr);
  const fixed = readFileSync(spacingFile, 'utf8');

  assert.match(fixed, /const b = 2;\n\n  console\.log\(a\);/);
  assert.match(
    fixed,
    /console\.log\(a\);\n\n  if \([\s\S]*\)\s*\{\s*console\.log\(b\);\s*\}/,
  );
  assert.match(fixed, /\n\n  for \(/);
  assert.match(fixed, /\n\n  switch \(/);
  assert.match(fixed, /break;\n\n    case 2:/);
  assert.equal(checkSpacing().status, 0, 'fixed braces and spacing pass');
  writeFileSync(
    inlineFile,
    'function inline() { const value = 1; if (value) console.log(value); }\n',
  );
  assert.equal(checkSpacing(false, inlineFile).status, 1);
  assert.equal(checkSpacing(true, inlineFile).status, 0);
  assert.match(readFileSync(inlineFile, 'utf8'), /value = 1;\s*\n\s*\nif \(/);
  writeFileSync(
    commentFile,
    '/** Compact documentation. */\nexport const value = 1;\n',
  );
  assert.equal(
    lint({ config: '.oxlintrc.json', target: commentFile }).status,
    1,
  );
  assert.equal(
    lint({ config: '.oxlint-format.json', target: commentFile }).status,
    1,
  );
  assert.equal(
    lint({ config: '.oxlint-format.json', fix: true, target: commentFile })
      .status,
    0,
  );
  assert.equal(
    readFileSync(commentFile, 'utf8'),
    '// Compact documentation.\nexport const value = 1;\n',
  );
  assert.equal(
    lint({ config: '.oxlintrc.json', target: commentFile }).status,
    0,
  );
  writeFileSync(
    commentFile,
    'export class Sweep {\n  /** World angle */\n  a = 0;\n}\n',
  );
  assert.equal(
    lint({ config: '.oxlintrc.json', target: commentFile }).status,
    1,
  );
  assert.equal(
    lint({ config: '.oxlint-format.json', fix: true, target: commentFile })
      .status,
    0,
  );
  assert.equal(
    readFileSync(commentFile, 'utf8'),
    'export class Sweep {\n  // World angle\n  a = 0;\n}\n',
  );
  const inlineDocumentation =
    'export const first = 1; /** Keep this code */ export const second = 2;\n';

  writeFileSync(commentFile, inlineDocumentation);
  assert.equal(
    lint({ config: '.oxlint-format.json', fix: true, target: commentFile })
      .status,
    1,
  );
  assert.equal(readFileSync(commentFile, 'utf8'), inlineDocumentation);
  writeFileSync(
    commentFile,
    '// Short documentation.\nexport const value = 1;\n',
  );
  assert.equal(
    lint({ config: '.oxlint-format.json', target: commentFile }).status,
    0,
  );
  writeFileSync(
    commentFile,
    '/** \n * The opener has a trailing space.\n */\nexport const value = 1;\n',
  );
  assert.equal(
    lint({ config: '.oxlint-format.json', target: commentFile }).status,
    1,
  );
  writeFileSync(
    commentFile,
    'export const example = "/** text in a string */";\n',
  );
  assert.equal(
    lint({ config: '.oxlint-format.json', target: commentFile }).status,
    0,
  );
  console.log(
    'Import spacing, braces, statement spacing, and documentation comments are enforced',
  );
} finally {
  rmSync(directory, { recursive: true });
}
