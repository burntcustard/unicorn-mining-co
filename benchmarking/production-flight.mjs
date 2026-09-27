/* global process */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rolldown } from 'rolldown';
import { minify } from 'terser';
import { instrumentPhases, phaseRuntime } from './server-phases.mjs';
import { resourceRuntime } from './flight-resources.mjs';
import {
  buildPlugin,
  buildPrePlugin,
  terserMangleOptions,
} from '../plugins/build-plugins.js';

const options = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg) =>
      arg.includes('=') ? arg.slice(2).split('=') : [arg.slice(2), true],
    ),
);

if (options.profile && options['broken-cache']) {
  throw new Error('--profile and --broken-cache must be measured separately');
}
const directory = await mkdtemp(join(tmpdir(), 'unicorn-production-flight-'));
const entry = options.bundle || options.save || join(directory, 'flight.mjs');
const labels = [
  'warmed',
  'scenario',
  'ticks',
  'players',
  'heapMiB',
  'rssMiB',
  'wallMs',
  'cpuMs',
  'p50',
  'p95',
  'max',
  'entities',
  'maxEntities',
  'positions',
  'packets',
  'bytes',
  'hash',
  'costs',
];

try {
  if (!options.bundle) {
    // Use the same workload, but compile its game accesses together with the game.
    // An unmangled driver cannot call production's mangled methods/properties.
    const source = await readFile(
      new URL('./three-player-flight.mjs', import.meta.url),
      'utf8',
    );
    const start = source.indexOf('  const scenarios = [');
    const end = source.lastIndexOf('\n} finally');

    if (start < 0 || end < start) {
      throw new Error('Flight workload markers changed');
    }
    let workload = source.slice(start, end);
    const reportStart = workload.lastIndexOf('    console.log(');

    if (reportStart < 0) throw new Error('Flight report marker changed');
    workload =
      workload.slice(0, reportStart) +
      workload
        .slice(reportStart)
        .replace('JSON.stringify({', 'JSON.stringify(Object.values({')
        .replace(/\n      \}\),\n    \);/, '\n      })),\n    );');
    workload = workload
      .replace(
        "const hash = createHash('sha256');",
        'const [updateHash, digestHash] = createPacketHash();',
      )
      .replace('hash.update(packet)', 'updateHash(packet)')
      .replace("hash.digest('hex')", 'digestHash()')
      .replace('process.cpuUsage()', 'cpuTime()')
      .replace('process.cpuUsage(cpu)', 'cpuTime() - cpu')
      .replace(
        '(used.user + used.system) / 1000 / ticks',
        'used / 1000 / ticks',
      );

    if (options.profile) {
      workload = workload.replace(
        'for (const key in costs) costs[key] = 0;',
        'resetPhases();',
      );
      workload = workload.replace(
        'Object.entries(costs)',
        'Object.entries(readPhases())',
      );
    }
    const entryId = resolve('src/__production_flight.ts');
    const bundle = await rolldown({
      input: entryId,
      platform: 'node',
      plugins: [
        {
          name: 'production-flight-entry',
          transform(code, id) {
            if (options.profile) {
              return instrumentPhases(code, id, options.profile === 'detail');
            }

            if (
              options['broken-cache'] &&
              id.endsWith('/src/server/replication.ts')
            ) {
              if (!code.includes('value === full.segments')) {
                throw new Error('Cache fault-injection marker changed');
              }
              return code.replace(
                'value === full.segments',
                "key === 'segments'",
              );
            }
          },
          resolveId(id) {
            if (id === 'flight-native') return '\0flight-native';

            if (id === entryId) return id;

            if (id === 'ws') {
              return {
                id: resolve('node_modules/ws/wrapper.mjs'),
                external: true,
              };
            }
          },
          load(id) {
            if (id === '\0flight-native') {
              return `${resourceRuntime} ${phaseRuntime} import {createHash} from 'node:crypto'; export function cpuTime(){const used=process.cpuUsage();return used.user+used.system;} export function createPacketHash(){const hash=createHash('sha256');return [packet=>${options.profile ? "measure('Harness packet hashing', () => hash.update(packet))" : 'hash.update(packet)'},()=>hash.digest('hex')];}`;
            }

            if (id === entryId) {
              return `import {createPacketHash,cpuTime,resetPhases,readPhases} from 'flight-native';
import {GameSession} from './server/game-session';
${
  options.profile
    ? `import {parseClientMessage} from './server/parse-client-message';
import {packPlayerInput} from './shared/protocol/input';
import {measure} from 'flight-native';
const receive = GameSession.prototype.receive;
GameSession.prototype.receive = function(options) {
  if (options.message.type === 'input') {
    const {tick, sequence, input} = options.message;
    const wire = measure('Harness wire construction', () => Buffer.from(JSON.stringify([tick, sequence, packPlayerInput(input)])));
    options = {...options, message: parseClientMessage(wire)};
  }
  return receive.call(this, options);
};`
    : ''
}
const api = { GameSession };
const [ticks, playerCount, warm, scenario] = JSON.parse(process.argv[2]);
const options = {ticks, warm, scenario};
const costs = {};
${workload}`;
            }
          },
        },
        { ...buildPrePlugin(), generateBundle: undefined },
        { ...buildPlugin(), generateBundle: undefined },
      ],
    });
    const { output } = await bundle.generate({ format: 'esm' });
    const chunk = output.find((item) => item.type === 'chunk');
    const compressed = await minify(chunk.code, {
      ...terserMangleOptions(),
      compress: { passes: 2 },
    });

    await writeFile(entry, compressed.code);
    await bundle.close();
  }
  const players = Number(options.players || 3);

  if (![1, 2, 3].includes(players)) {
    throw new Error('--players must be 1, 2 or 3');
  }
  const child = spawnSync(
    process.execPath,
    [
      ...(options['node-flag'] ? [options['node-flag']] : []),
      ...(options['semi-space']
        ? [`--max-semi-space-size=${Number(options['semi-space'])}`]
        : []),
      entry,
      JSON.stringify([
        Number(options.ticks || 9000),
        players,
        Boolean(options.warm),
        options.scenario || null,
      ]),
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 290000 },
  );

  let resources;

  for (const line of child.stderr.split('\n').filter(Boolean)) {
    if (line.startsWith('FLIGHT_RESOURCES ')) {
      resources = JSON.parse(line.slice(17));
    } else process.stderr.write(line + '\n');
  }

  if (child.status !== 0) {
    throw new Error(`Flight exited ${child.status}: ${child.error || ''}`);
  }

  for (const line of child.stdout.trim().split('\n')) {
    const values = JSON.parse(line);

    if (
      !Array.isArray(values) ||
      values.length !== labels.length ||
      !Number.isFinite(values[7])
    ) {
      throw new Error('Flight report fields changed');
    }
    console.log(
      JSON.stringify({
        production: true,
        resources,
        ...Object.fromEntries(labels.map((key, i) => [key, values[i]])),
      }),
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
