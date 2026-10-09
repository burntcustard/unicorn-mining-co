import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import stylelint from 'stylelint';

const directory = mkdtempSync(join(tmpdir(), 'css-spacing-'));
const file = join(directory, 'fixture.css');

const lint = (fix = false) =>
  stylelint.lint({
    files: file,
    configFile: resolve('.stylelintrc.json'),
    fix,
  });

try {
  writeFileSync(
    file,
    `.first {
  content: "}";
}
.second {
  color: blue;
}
/* Describes the responsive rules. */
@media (width > 600px) {
  .first {
    color: red;
  }
  .second {
    color: blue;
  }
}
@keyframes fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
`,
  );
  const invalid = await lint();

  assert(invalid.errored, invalid.report);

  for (const rule of [
    'rule-empty-line-before',
    'at-rule-empty-line-before',
    'comment-empty-line-before',
  ]) {
    assert(
      invalid.results[0].warnings.some((warning) => warning.rule === rule),
      `${rule} rejects missing spacing: ${invalid.report}`,
    );
  }

  const fixed = await lint(true);

  assert(!fixed.errored, fixed.report);
  const source = readFileSync(file, 'utf8');

  assert.match(source, /\}\n\n\.second/);
  assert.match(source, /\}\n\n\/\* Describes/);
  assert.match(source, /\*\/\n@media/);
  assert.match(source, /@media[^\n]*\{\n  \.first/);
  assert.match(source, /  \}\n\n  \.second/);
  assert.match(source, /\}\n\n@keyframes/);
  assert.match(source, /@keyframes fade \{\n  from/);
  assert.match(source, /  \}\n\n  to/);
  assert(!(await lint()).errored);
  const formatted = spawnSync(
    resolve('node_modules/.bin/oxfmt'),
    ['--config', resolve('.oxfmtrc.json'), file],
    { encoding: 'utf8' },
  );

  assert.equal(formatted.status, 0, formatted.stdout + formatted.stderr);
  assert(!(await lint()).errored, 'Oxfmt preserves the CSS spacing rules');
  const formattedSource = readFileSync(file, 'utf8');

  assert(!(await lint(true)).errored);
  assert.equal(
    readFileSync(file, 'utf8'),
    formattedSource,
    'formatting CSS again leaves it unchanged',
  );

  for (const declaration of [
    'font-size: 16px',
    'font-size: clamp(14px, 3vw, 24px)',
    'font: 16px/1.5 sans-serif',
    'font-size: 1em',
  ]) {
    writeFileSync(file, `.example { ${declaration}; }\n`);
    const result = await lint();

    assert(
      result.results[0].warnings.some(
        (warning) => warning.rule === 'declaration-property-unit-allowed-list',
      ),
      `${declaration} must fail the font-unit rule`,
    );
  }

  for (const declaration of [
    'font-size: 1rem',
    'font-size: clamp(0.875rem, 3vw, 1.5rem)',
    'font: 1rem/1.5 sans-serif',
    'font: inherit',
    'font-size: var(--size)',
    'padding: 16px',
  ]) {
    writeFileSync(file, `.example { ${declaration}; }\n`);
    const result = await lint();

    assert(!result.errored, `${declaration}: ${result.report}`);
  }

  for (const value of ['pointer', 'default', 'auto', 'inherit']) {
    writeFileSync(file, `.example { cursor: ${value}; }\n`);
    const result = await lint();

    assert(
      result.results[0].warnings.some(
        (warning) => warning.rule === 'property-disallowed-list',
      ),
      `cursor: ${value} must be rejected`,
    );
  }

  console.log('CSS spacing, font units, and native cursors are enforced');
} finally {
  rmSync(directory, { recursive: true });
}
