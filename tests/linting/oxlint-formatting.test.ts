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
const blockFile = join(directory, 'blocks.ts');
const correctnessFile = join(directory, 'correctness.ts');
const browserFile = join(directory, 'browser.ts');
const source =
  "import '../dependency';\n// Following code must be separated too.\nexport const value = 1;\n";

const lint = ({
  format = false,
  fix = false,
  target = file,
}: {
  format?: boolean;
  fix?: boolean;
  target?: string;
}) =>
  spawnSync(
    resolve('node_modules/.bin/oxlint'),
    [
      '-c',
      resolve('.oxlintrc.json'),
      ...(format ? ['-A', 'correctness'] : []),
      '--no-ignore',
      ...(fix ? ['--fix'] : []),
      target,
    ],
    { encoding: 'utf8' },
  );

try {
  const browserSource = "window.addEventListener('resize', () => {});\n";

  writeFileSync(browserFile, browserSource);

  for (const format of [false, true]) {
    const result = lint({ format, fix: true, target: browserFile });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(
      readFileSync(browserFile, 'utf8'),
      browserSource,
      'browser globals need no existence guards in lint or format mode',
    );
  }

  writeFileSync(correctnessFile, 'const unused = 1;\n');
  assert.match(lint({ target: correctnessFile }).stdout, /no-unused-vars/);
  assert.doesNotMatch(
    lint({ format: true, target: correctnessFile }).stdout,
    /no-unused-vars/,
  );
  writeFileSync(file, source);
  assert.equal(
    lint({}).status,
    1,
    'normal lint rejects missing import spacing',
  );
  assert.equal(
    lint({ format: true }).status,
    1,
    'format check rejects missing import spacing',
  );
  assert.equal(
    lint({ format: true, fix: true }).status,
    0,
    'format fixes import spacing',
  );
  assert.equal(readFileSync(file, 'utf8'), source.replace("';\n", "';\n\n"));
  assert.equal(lint({}).status, 0, 'formatted imports pass normal lint');
  writeFileSync(
    spacingFile,
    'function example() {\n  const a = 1;\n  const b = 2;\n  console.log(a);\n  if (\n    a &&\n    b\n  )\n    console.log(b);\n  for (const value of [a, b]) {\n    console.log(value);\n  }\n  switch (a) {\n    case 1:\n      break;\n    case 2:\n      break;\n  }\n}\n',
  );
  const checkSpacing = (fix = false, target = spacingFile) =>
    lint({ format: true, fix, target });

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
    blockFile,
    `export type First = { value: number };
// Keep this description with Second.
export interface Second { run(): void }
export function example(value: number) {
  if (value) { value++; }
  // Keep this description with the following statement.
  value++;
  const object = {
    value,
  };
  const other = 1;
  switch (value) {
    case 1:
      if (other) { value++; }
      value++;
      break;
  }
}
example(1);
`,
  );
  assert.equal(checkSpacing(false, blockFile).status, 1);
  const blockResult = checkSpacing(true, blockFile);

  assert.equal(blockResult.status, 0, blockResult.stdout + blockResult.stderr);
  const spacedBlocks = readFileSync(blockFile, 'utf8');

  assert.match(spacedBlocks, /First = \{ value: number \};\n\n\/\/ Keep/);
  assert.match(spacedBlocks, /Second \{ run\(\): void \}\n\nexport function/);
  assert.match(spacedBlocks, /if \(value\) \{ value\+\+; \}\n\n  \/\/ Keep/);
  assert.match(spacedBlocks, /statement\.\n  value\+\+;\n\n  const object/);
  assert.match(spacedBlocks, /value,\n  \};\n\n  const other/);
  assert.match(
    spacedBlocks,
    /if \(other\) \{ value\+\+; \}\n\n      value\+\+;/,
  );
  assert.match(spacedBlocks, /\n\}\n\nexample\(1\);/);
  assert.equal(checkSpacing(true, blockFile).status, 0);
  assert.equal(
    readFileSync(blockFile, 'utf8'),
    spacedBlocks,
    'block spacing is idempotent',
  );
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
  assert.equal(lint({ target: commentFile }).status, 1);
  assert.equal(lint({ format: true, target: commentFile }).status, 1);
  assert.equal(
    lint({ format: true, fix: true, target: commentFile }).status,
    0,
  );
  assert.equal(
    readFileSync(commentFile, 'utf8'),
    '// Compact documentation.\nexport const value = 1;\n',
  );
  assert.equal(lint({ target: commentFile }).status, 0);
  writeFileSync(
    commentFile,
    'export class Sweep {\n  /** World angle */\n  a = 0;\n}\n',
  );
  assert.equal(lint({ target: commentFile }).status, 1);
  assert.equal(
    lint({ format: true, fix: true, target: commentFile }).status,
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
    lint({ format: true, fix: true, target: commentFile }).status,
    1,
  );
  assert.equal(readFileSync(commentFile, 'utf8'), inlineDocumentation);
  writeFileSync(
    commentFile,
    '// Short documentation.\nexport const value = 1;\n',
  );
  assert.equal(lint({ format: true, target: commentFile }).status, 0);
  writeFileSync(
    commentFile,
    '/** \n * The opener has a trailing space.\n */\nexport const value = 1;\n',
  );
  assert.equal(lint({ format: true, target: commentFile }).status, 1);
  writeFileSync(
    commentFile,
    'export const example = "/** text in a string */";\n',
  );
  assert.equal(lint({ format: true, target: commentFile }).status, 0);
  console.log(
    'Import spacing, braces, statement spacing, and documentation comments are enforced',
  );
} finally {
  rmSync(directory, { recursive: true });
}
