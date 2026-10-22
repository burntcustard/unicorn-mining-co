// Alternate compiled session benchmarks; CPU metrics exclude world setup/warmup.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cpuAffinity, goEnvironment } from './go-cpu-environment.ts';

const [before, after, output = 'benchmarking/local/pirate-cpu.json'] =
  process.argv.slice(2);

if (!before || !after) {
  throw new Error(
    'Usage: node benchmarking/tools/pirate-cpu.ts BEFORE AFTER [RESULT_JSON]',
  );
}

const ticks = Number(process.env.TICKS || 9000);
const repetitions = Number(process.env.REPETITIONS || 5);

if (
  ![ticks, repetitions].every(
    (value) => Number.isSafeInteger(value) && value > 0,
  )
) {
  throw new Error('TICKS and REPETITIONS must be positive integers');
}

type Sample = {
  variant: string;
  repetition: number;
  scenario: string;
  schedulerWidth: number;
  ticks: number;
  metrics: Record<string, number>;
};

const executables = { before, after };
const samples: Sample[] = [];
const scenarios: string[] = [];
const environment = goEnvironment;

const result = {
  environment: {
    GOGC: environment.GOGC,
    GOMAXPROCS: environment.GOMAXPROCS,
    affinity: cpuAffinity,
  },
  executables: Object.fromEntries(
    Object.entries(executables).map(([variant, path]) => [
      variant,
      {
        path,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
        build: execFileSync('go', ['version', '-m', path], {
          encoding: 'utf8',
        }),
      },
    ]),
  ),
  ticks,
  repetitions,
  samples,
};

mkdirSync(dirname(output), { recursive: true });

for (let repetition = 0; repetition < repetitions; repetition++) {
  const order =
    repetition % 2
      ? (['after', 'before'] as const)
      : (['before', 'after'] as const);

  for (const variant of order) {
    const start = samples.length;
    const text = execFileSync(
      'taskset',
      [
        '-c',
        cpuAffinity,
        executables[variant],
        '-test.run',
        '^$',
        '-test.bench',
        '^BenchmarkPirateCombat$',
        '-test.benchtime',
        `${ticks}x`,
        '-test.count',
        '1',
      ],
      { encoding: 'utf8', env: environment },
    );

    writeFileSync(`${output}.${variant}.${repetition}.log`, text);

    for (const match of text.matchAll(
      /^BenchmarkPirateCombat\/([\w-]+)-(\d+)\s+(\d+)\s+(.+)$/gm,
    )) {
      const parts = match[4].trim().split(/\s+/);
      const metrics = Object.fromEntries(
        Array.from({ length: parts.length / 2 }, (_, index) => [
          parts[index * 2 + 1],
          Number(parts[index * 2]),
        ]),
      );

      samples.push({
        variant,
        repetition,
        scenario: match[1],
        schedulerWidth: Number(match[2]),
        ticks: Number(match[3]),
        metrics,
      });
    }

    const current = samples.slice(start);

    if (scenarios.length === 0) {
      scenarios.push(...current.map((sample) => sample.scenario));
    }

    if (
      current.length === 0 ||
      current.length !== scenarios.length ||
      scenarios.some(
        (scenario) => !current.some((sample) => sample.scenario === scenario),
      ) ||
      current.some((sample) => !Number.isFinite(sample.metrics['cpu-ns/tick']))
    ) {
      throw new Error(
        'Expected matching CPU measurements for every combat case',
      );
    }

    writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`${variant} repetition ${repetition + 1}/${repetitions}`);
  }
}

const median = (values: number[]) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (const scenario of scenarios) {
  const cpu = ['before', 'after'].map((variant) =>
    median(
      samples
        .filter(
          (sample) =>
            sample.scenario === scenario && sample.variant === variant,
        )
        .map((sample) => sample.metrics['cpu-ns/tick']),
    ),
  );

  console.log(
    `${scenario}: ${(cpu[0] / 1000).toFixed(3)} → ${(cpu[1] / 1000).toFixed(3)} µs CPU/tick; ${(100 * (1 - cpu[1] / cpu[0])).toFixed(2)}% less`,
  );
}

console.log(output);
