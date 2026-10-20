// Materialize immutable source snapshots as Go overlays without editing the checkout.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../..');
const [snapshotName, outputName, fixtureName, baseName] = process.argv.slice(2);

if (!snapshotName || !outputName) {
  throw new Error(
    'Usage: node prepare.ts SNAPSHOT.json[.gz] OUTPUT_DIRECTORY [FIXTURE.go.txt] [BASE_SNAPSHOT.json.gz]',
  );
}

const sha256 = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');

const load = (name: string): Record<string, string> => {
  const data = readFileSync(resolve(name));

  return JSON.parse(
    (name.endsWith('.gz') ? gunzipSync(data) : data).toString('utf8'),
  );
};

const snapshot = load(snapshotName);
const sources = { ...(baseName ? load(baseName) : {}), ...snapshot };
const output = resolve(outputName);
const replacements: Record<string, string> = {};
const masked: string[] = [];

const save = (name: string, text: string) => {
  const destination = join(output, name);

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, text);
  return destination;
};

for (const [name, text] of Object.entries(sources)) {
  if (
    !name.startsWith('src/') ||
    name.split('/').includes('..') ||
    typeof text !== 'string'
  ) {
    throw new Error(`Invalid source entry: ${name}`);
  }

  const destination = save(`source/${name}`, text);

  if (name.endsWith('.go')) {
    replacements[join(repository, name)] = destination;
  }
}

// New tests may refer to APIs absent from an older checkpoint. New production
// files must also be masked so that they cannot silently alter that checkpoint.
for (const entry of readdirSync(join(repository, 'src/server'), {
  encoding: 'utf8',
  recursive: true,
})) {
  const name = `src/server/${entry}`;

  if (!name.endsWith('.go') || name in sources) {
    continue;
  }

  const text = readFileSync(join(repository, name), 'utf8');
  const packageName = text.match(/^package\s+(\w+)/m)?.[1];

  if (!packageName) {
    throw new Error(`No Go package declaration: ${name}`);
  }

  replacements[join(repository, name)] = save(
    `masks/${name}`,
    `package ${packageName}\n`,
  );
  masked.push(name);
}

const fixture = resolve(
  fixtureName || join(directory, 'fixtures/pirate-benchmark-original.go.txt'),
);
const fixtureText = readFileSync(fixture, 'utf8');

replacements[join(repository, 'src/server/network/pirate-benchmark_test.go')] =
  save('fixtures/pirate-benchmark_test.go', fixtureText);

save('overlay.json', `${JSON.stringify({ Replace: replacements }, null, 2)}\n`);

save(
  'prepared.json',
  `${JSON.stringify(
    {
      repository,
      snapshot: resolve(snapshotName),
      snapshotSha256: sha256(readFileSync(resolve(snapshotName))),
      base: baseName ? resolve(baseName) : null,
      fixture,
      fixtureSha256: sha256(fixtureText),
      sourceEntries: Object.keys(sources).length,
      masked,
    },
    null,
    2,
  )}\n`,
);

console.log(join(output, 'overlay.json'));
