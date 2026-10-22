// Generate a local compiler overlay; gameplay equipment still uses dock actions.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = process.argv[2];

assert(
  directory,
  'Usage: node benchmarking/tools/combat-fixture.ts OUTPUT_DIRECTORY',
);
const sourcePath = resolve('src/server/network/game-session.go');
const source = readFileSync(sourcePath, 'utf8');
const marker = '\n\troundSpawn(p.ship)';

assert.equal(
  source.split(marker).length,
  2,
  'Expected one hello spawn boundary',
);
const replacement = source.replace(
  marker,
  `${marker}
	// Local benchmark fixture: use the authoritative respawn docking pose.
	nearest := s.nearestStation(p.ship.Position)
	s.regions.Sync(s.World, append(s.positions(), nearest.Position))
	if station, ok := s.World.Entities.Get(s.regions.idOffset + int64(nearest.ID)); ok && station.Base().Kind == "station" {
		p.ship.Position, p.ship.Rotation = station.Base().Position, station.Base().Rotation
		id := station.Base().ID
		p.ship.DockedTo = &id
	}
`,
);

mkdirSync(directory, { recursive: true });
const fixturePath = resolve(directory, 'docked-game-session.go');
const overlayPath = resolve(directory, 'overlay.json');

writeFileSync(fixturePath, replacement);
writeFileSync(
  overlayPath,
  JSON.stringify({ Replace: { [sourcePath]: fixturePath } }, null, 2) + '\n',
);
console.log(overlayPath);
