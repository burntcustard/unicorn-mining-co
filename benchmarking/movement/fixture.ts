import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Provision benchmark ships at the normal Play boundary using a Go overlay.
 */
export function prepareMovementFixture(directory: string) {
  const output = resolve(directory);
  const sessionPath = resolve('src/server-go/network/game-session.go');
  const fixturePath = resolve('src/server-go/network/movement-benchmark.go');
  const play =
    'func (s *GameSession) play(p *playerRecord) {\n\tif s.World.Players.Has(p.playerID) {\n\t\treturn\n\t}\n';
  const session = readFileSync(sessionPath, 'utf8');
  const fixture = readFileSync(
    new URL('./fixture.go', import.meta.url),
    'utf8',
  );

  assert.equal(session.split(play).length, 2, 'Expected one Play boundary');

  mkdirSync(output, { recursive: true });
  const overlay = resolve(output, 'overlay.json');
  const sessionCopy = resolve(output, 'game-session.go');
  const fixtureCopy = resolve(output, 'movement-benchmark.go');

  writeFileSync(
    sessionCopy,
    session.replace(play, `${play}\n\ts.prepareMovementBenchmark(p)\n`),
  );
  writeFileSync(fixtureCopy, fixture.slice(fixture.indexOf('package network')));

  writeFileSync(
    overlay,
    JSON.stringify({
      Replace: { [sessionPath]: sessionCopy, [fixturePath]: fixtureCopy },
    }) + '\n',
  );

  return overlay;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  console.log(
    prepareMovementFixture(
      process.argv[2] || 'benchmarking/_local/movement/fixture',
    ),
  );
}
