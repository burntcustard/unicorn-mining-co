import assert from 'node:assert/strict';
import {
  npcLanes,
  npcOverlay,
  parseNPCOptions,
} from '../../benchmarking/npc/options.ts';

for (const [flags, expected] of [
  ['', undefined],
  [' \t\r\n ', undefined],
  ['-trimpath -race', undefined],
  ['-overlay=/tmp/overlay.json', '/tmp/overlay.json'],
  ['--overlay=relative/overlay.json', 'relative/overlay.json'],
  ['-trimpath\t-overlay=/tmp/overlay.json\n-race', '/tmp/overlay.json'],
  ['-overlay=first --overlay=second -overlay=last', 'last'],
  [
    '"-overlay=/tmp/path with spaces/overlay.json"',
    '/tmp/path with spaces/overlay.json',
  ],
  [
    "'-overlay=/tmp/path with spaces/overlay.json'",
    '/tmp/path with spaces/overlay.json',
  ],
  ['"-ldflags=-X text=-overlay=wrong" -overlay=right', 'right'],
  ['"-overlay=first"--overlay=second', 'second'],
  ['-overlay="literal-quotes"', '"literal-quotes"'],
  ['"-overlay=literal\\backslash"', 'literal\\backslash'],
  ['-overlay=first -overlay=', ''],
  ['-not-overlay=wrong -overlay other', undefined],
] as const) {
  assert.equal(npcOverlay(flags), expected, flags);
}

for (const flags of ['"-overlay=unfinished', "'-overlay=unfinished"]) {
  assert.throws(() => npcOverlay(flags), /Unterminated quote/);
}

const defaults = parseNPCOptions({ args: [] });

assert.deepEqual(defaults, {
  scenarios: [
    'collector-empty',
    'collector-idle',
    'collector',
    'collector-crowded-idle',
    'collector-crowded',
    'collection-courser',
    'collection-finch',
  ],
  seconds: 30,
  warmup: 15,
  repetitions: 3,
  concurrency: 1,
  seed: 1,
  cores: 2,
  output: 'benchmarking/_local/npc.json',
  watch: false,
  browser: 'chrome',
  help: false,
});

assert.deepEqual(
  parseNPCOptions({ args: ['--scenario', 'all,collector,all'] }).scenarios,
  defaults.scenarios,
);

assert.deepEqual(
  parseNPCOptions({
    args: ['--scenario', 'collection-finch, collector,collection-finch'],
  }).scenarios,
  ['collection-finch', 'collector'],
);

const watched = parseNPCOptions({
  args: [
    '--watch',
    '--browser',
    'chrome',
    '--scenario',
    'collection-courser',
    '--seconds',
    '120',
    '--warmup',
    '49',
    '--repetitions',
    '1',
    '--cores',
    '4',
    '--output',
    '/tmp/npc-watch.json',
  ],
});

assert.equal(watched.watch, true);
assert.equal(watched.browser, 'chrome');
assert.equal(watched.seconds, 120);
assert.equal(watched.warmup, 49);
assert.equal(watched.repetitions, 1);
assert.equal(watched.cores, 4);
assert.equal(watched.output, '/tmp/npc-watch.json');
assert.equal(parseNPCOptions({ args: ['--help'] }).help, true);
assert.equal(
  parseNPCOptions({ args: ['--seconds', '5', '--warmup', '0'] }).warmup,
  0,
);

for (const seed of [0, 1, 42, 4294967295]) {
  assert.equal(parseNPCOptions({ args: ['--seed', String(seed)] }).seed, seed);
}

for (const seed of ['', ' ', '-1', '1.5', '4294967296', 'NaN', 'Infinity']) {
  assert.throws(
    () => parseNPCOptions({ args: [`--seed=${seed}`] }),
    /integer seed between 0 and 4294967295/,
  );
}

for (const scenario of ['', 'unknown', 'all,unknown', 'collector,']) {
  assert.throws(
    () => parseNPCOptions({ args: ['--scenario', scenario] }),
    /Choose scenarios/,
  );
}

for (const seconds of ['0', '4.9', '120.1', 'NaN', 'Infinity']) {
  assert.throws(
    () => parseNPCOptions({ args: ['--seconds', seconds] }),
    /Measure between 5 and 120 seconds/,
  );
}

for (const warmup of ['-1', '140', 'NaN', 'Infinity']) {
  assert.throws(
    () => parseNPCOptions({ args: [`--warmup=${warmup}`] }),
    /below 170 seconds/,
  );
}

for (const option of ['repetitions', 'cores']) {
  for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity']) {
    assert.throws(
      () => parseNPCOptions({ args: [`--${option}=${value}`] }),
      /positive integer/,
    );
  }
}

assert.throws(
  () => parseNPCOptions({ args: ['--watch', '--browser', 'firefox'] }),
  /Choose chrome/,
);

for (const value of ['0', '7', '1.5', 'NaN']) {
  assert.throws(
    () => parseNPCOptions({ args: ['--concurrency', value] }),
    /concurrent NPC runs/,
  );
}

assert.throws(
  () => parseNPCOptions({ args: ['--concurrency', '6'] }),
  /require collection scenarios/,
);

const lanes = npcLanes(
  parseNPCOptions({
    args: [
      '--scenario',
      'collection-courser,collection-finch',
      '--concurrency',
      '6',
      '--repetitions',
      '9',
    ],
  }),
);

assert.equal(lanes.length, 6);
assert.deepEqual(
  lanes.map((lane) => lane.queue[0].scenario),
  [
    ...Array(3).fill('collection-courser'),
    ...Array(3).fill('collection-finch'),
  ],
);
assert.equal(lanes[0].queue, lanes[1].queue);
assert.equal(lanes[1].queue, lanes[2].queue);
assert.equal(lanes[3].queue, lanes[4].queue);
assert.equal(lanes[4].queue, lanes[5].queue);
assert.notEqual(lanes[0].queue, lanes[3].queue);
assert.deepEqual(
  lanes[0].queue.map((job) => job.seed),
  [1, 2, 3, 4, 5, 6, 7, 8, 9],
);
assert.deepEqual(
  lanes[3].queue.map((job) => job.seed),
  lanes[0].queue.map((job) => job.seed),
);
assert.equal(lanes[0].queue.shift().seed, 1);
assert.equal(lanes[1].queue.shift().seed, 2);
assert.equal(lanes[2].queue.shift().seed, 3);
// A fast window takes seed 4 without waiting for seeds 1 and 3 to finish.
assert.equal(lanes[1].queue.shift().seed, 4);
assert.equal(lanes[2].queue.shift().seed, 5);

const serial = npcLanes(
  parseNPCOptions({
    args: [
      '--scenario',
      'collection-courser,collection-finch',
      '--repetitions',
      '2',
    ],
  }),
);

assert.equal(serial.length, 1);
assert.deepEqual(
  serial[0].queue.map((job) => job.scenario),
  [
    'collection-courser',
    'collection-finch',
    'collection-finch',
    'collection-courser',
  ],
);

const short = npcLanes(
  parseNPCOptions({
    args: [
      '--scenario',
      'collection-finch',
      '--concurrency',
      '6',
      '--repetitions',
      '7',
    ],
  }),
);

assert.equal(short.length, 6);
assert(short.every((lane) => lane.queue === short[0].queue));
assert.equal(short[0].queue.length, 7);
