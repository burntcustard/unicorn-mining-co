import { parseArgs } from 'node:util';

const scenarios = [
  'collector-empty',
  'collector-idle',
  'collector',
  'collector-crowded-idle',
  'collector-crowded',
  'collection-courser',
  'collection-finch',
] as const;

/*
 * GOFLAGS quotes whole tokens and does not unescape their contents. Later
 * occurrences override earlier flags, matching the Go command's parsing.
 */
export function npcOverlay(flags: string) {
  let overlay: string | undefined;

  while (flags) {
    flags = flags.replace(/^[ \t\r\n]+/, '');

    if (!flags) break;

    let token: string;
    const quote = flags[0];

    if (quote === '"' || quote === "'") {
      const end = flags.indexOf(quote, 1);

      if (end < 0) throw new Error('Unterminated quote in server GOFLAGS');
      token = flags.slice(1, end);
      flags = flags.slice(end + 1);
    } else {
      const end = flags.search(/[ \t\r\n]/);

      token = end < 0 ? flags : flags.slice(0, end);
      flags = end < 0 ? '' : flags.slice(end);
    }

    if (/^--?overlay=/.test(token)) {
      overlay = token.slice(token.indexOf('=') + 1);
    }
  }

  return overlay;
}

export function parseNPCOptions({ args }: { args: string[] }) {
  const { values } = parseArgs({
    args,
    options: {
      scenario: { type: 'string', default: 'all' },
      seconds: { type: 'string', default: '30' },
      warmup: { type: 'string', default: '15' },
      repetitions: { type: 'string', default: '3' },
      concurrency: { type: 'string', default: '1' },
      seed: { type: 'string', default: '1' },
      cores: { type: 'string', default: '2' },
      output: { type: 'string', default: 'benchmarking/_local/npc.json' },
      watch: { type: 'boolean', default: false },
      browser: { type: 'string', default: 'chrome' },
      help: { type: 'boolean', default: false },
    },
  });

  const selected = values.scenario.split(',').map((name) => name.trim());
  const seconds = Number(values.seconds);
  const warmup = Number(values.warmup);
  const repetitions = Number(values.repetitions);
  const concurrency = Number(values.concurrency);
  const seed = Number(values.seed);
  const cores = Number(values.cores);

  if (
    selected.some(
      (name) =>
        name !== 'all' &&
        !scenarios.includes(name as (typeof scenarios)[number]),
    )
  ) {
    throw new Error(`Choose scenarios: all, ${scenarios.join(', ')}`);
  }

  if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120) {
    throw new Error('Measure between 5 and 120 seconds');
  }

  if (!Number.isFinite(warmup) || warmup < 0 || warmup + seconds >= 170) {
    throw new Error(
      'Keep warmup nonnegative and total warmup plus capture below 170 seconds',
    );
  }

  if (!Number.isInteger(repetitions) || repetitions <= 0) {
    throw new Error('Use a positive integer repetition count');
  }

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) {
    throw new Error('Use between 1 and 6 concurrent NPC runs');
  }

  if (
    concurrency > 1 &&
    selected.some((name) => !name.startsWith('collection-'))
  ) {
    throw new Error(
      'Concurrent runs require collection scenarios; CPU-only scenes run serially',
    );
  }

  if (
    !values.seed.trim() ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff
  ) {
    throw new Error('Use an integer seed between 0 and 4294967295');
  }

  if (!Number.isInteger(cores) || cores <= 0) {
    throw new Error('Use a positive integer CPU core count');
  }

  if (values.browser !== 'chrome') {
    throw new Error('Choose chrome for NPC watch mode');
  }

  return {
    scenarios: selected.includes('all')
      ? [...scenarios]
      : [...new Set(selected)],
    seconds,
    warmup,
    repetitions,
    concurrency,
    seed,
    cores,
    output: values.output,
    watch: values.watch,
    browser: 'chrome' as const,
    help: values.help,
  };
}

/*
 * Each hull has a shared FIFO queue. Its next available window takes the next
 * seed immediately, keeping the top row on Courser and the bottom row on Finch.
 */
export function npcLanes(options: ReturnType<typeof parseNPCOptions>) {
  const jobs = Array.from({ length: options.repetitions }, (_, index) => {
    const repetition = index + 1;
    const scenarios =
      repetition % 2 ? options.scenarios : options.scenarios.toReversed();

    return scenarios.map((scenario) => ({
      scenario,
      repetition,
      seed: scenario.startsWith('collection-')
        ? (options.seed + index) >>> 0
        : null,
    }));
  }).flat();

  const queues =
    options.concurrency === 1
      ? [jobs]
      : options.scenarios
          .toSorted()
          .map((scenario) => jobs.filter((job) => job.scenario === scenario));

  return Array.from(
    { length: Math.min(options.concurrency, jobs.length) },
    (_, index) => ({ queue: queues[index % queues.length] }),
  ).toSorted((a, b) =>
    a.queue[0].scenario.localeCompare(b.queue[0].scenario, 'en-US'),
  );
}
