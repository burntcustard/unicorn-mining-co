import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const support = dirname(fileURLToPath(import.meta.url));
const here = resolve(support, '..');
const repository = resolve(here, '../../../..');
const manifest = JSON.parse(
  readFileSync(resolve(here, 'sources.json'), 'utf8'),
);
const replacements = Object.fromEntries(
  Object.entries(manifest.variants.after.files).map(([path, snapshot]) => [
    resolve(repository, path),
    snapshot === null ? '' : resolve(here, snapshot as string),
  ]),
);

replacements[
  resolve(repository, 'src/server/physics/recovery-oracle_test.go')
] = resolve(support, 'recovery-oracle_test.go.txt');
writeFileSync(
  '/tmp/unicorn-recovery-overlay.json',
  JSON.stringify({ Replace: replacements }),
);
console.log('/tmp/unicorn-recovery-overlay.json');
