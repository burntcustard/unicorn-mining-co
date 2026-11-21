import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareNPCFixture } from '../../benchmarking/npc/fixture.ts';

const directory = mkdtempSync(join(tmpdir(), 'unicorn-npc-fixture-'));

try {
  const manifestPath = join(directory, 'config/fixture.json');
  const output = join(directory, 'reports');

  assert.equal(
    prepareNPCFixture({ directory: output, manifestPath }),
    manifestPath,
  );

  assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), {
    directory: output,
    items: 6,
  });

  assert.throws(
    () => prepareNPCFixture({ directory: output, manifestPath, items: 49 }),
    /3 and 48/,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
