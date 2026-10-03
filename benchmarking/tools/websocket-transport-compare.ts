import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';

const [before, after, destination] = process.argv.slice(2);

assert(
  before && after && destination,
  'Usage: node benchmarking/tools/websocket-transport-compare.ts BEFORE AFTER OUTPUT.json.gz',
);
const repetitions = Number(process.env.REPETITIONS || 5);
const ticks = Number(process.env.TICKS || 3000);
const pacedTicks = Number(process.env.PACED_TICKS ?? 150);
const counts = (process.env.PLAYERS || '4,8,16,32').split(',').map(Number);
const sizes = (process.env.SIZES || '128,2048,8192').split(',').map(Number);
const game = process.env.GAME === '1';
const activities = (process.env.ACTIVITIES || 'idle,flight').split(',');

assert(Number.isInteger(repetitions) && repetitions > 0);
assert(Number.isInteger(ticks) && ticks > 0);
assert(Number.isInteger(pacedTicks) && pacedTicks >= 0);
assert(counts.every((count) => Number.isInteger(count) && count > 0));
assert(sizes.every((size) => Number.isInteger(size) && size >= 8));

const cases: {
  players: number;
  size: number;
  ticks: number;
  hz: number;
  activity?: string;
}[] = game
  ? counts.flatMap((players) =>
      activities.map((activity) => ({
        players,
        activity,
        size: 2048,
        ticks: pacedTicks,
        hz: 30,
      })),
    )
  : counts.flatMap((players) => [
      ...sizes.map((size) => ({ players, size, ticks, hz: 0 })),
      ...(pacedTicks
        ? [{ players, size: 2048, ticks: pacedTicks, hz: 30 }]
        : []),
    ]);

const hash = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const variants = [
  {
    name: 'before',
    executable: before,
    sha256: hash(before),
  },
  {
    name: 'after',
    executable: after,
    sha256: hash(after),
  },
];

const capture = {
  date: new Date().toISOString(),
  processor: cpus()[0]?.model,
  node: process.version,
  repetitions,
  cases,
  variants,
  harnessSha256: {
    server: hash('benchmarking/tools/websocket-transport/main.go'),
    client: hash('benchmarking/tools/websocket-transport.ts'),
    comparison: hash('benchmarking/tools/websocket-transport-compare.ts'),
  },
  results: [] as Record<string, unknown>[],
  completedAt: undefined as string,
};

const env = {
  ...process.env,
  GOGC: process.env.GOGC || '800',
};

const save = () => {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, gzipSync(JSON.stringify(capture, null, 2) + '\n'));
};

for (const scenario of cases) {
  for (let repetition = 0; repetition < repetitions; repetition++) {
    for (const variant of repetition % 2 ? variants.toReversed() : variants) {
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          [
            'benchmarking/tools/websocket-transport.ts',
            variant.executable,
            ...(game ? ['-game'] : []),
            '-players',
            String(scenario.players),
            '-size',
            String(scenario.size),
            '-ticks',
            String(scenario.ticks),
            '-hz',
            String(scenario.hz),
          ],
          {
            env: {
              ...env,
              ...(scenario.activity && { ACTIVITY: scenario.activity }),
            },
            encoding: 'utf8',
          },
        ),
      );

      capture.results.push({ ...result, variant: variant.name, repetition });
      save();
      console.log(
        `${variant.name}: ${scenario.players} clients / ${scenario.activity || `${scenario.size} bytes`} / ${scenario.hz || 'unpaced'} Hz / ${result.cpuMsPerTick.toFixed(4)} CPU ms/tick / ${result.allocationsPerTick.toFixed(1)} allocations/tick`,
      );
    }
  }
}

capture.completedAt = new Date().toISOString();
save();
