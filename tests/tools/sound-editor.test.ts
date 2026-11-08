import assert from 'node:assert/strict';
import {
  copyFile,
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  renderEffectBuffer,
  resolveSoundEffect,
  type SoundCurve,
  type SoundEffect,
  type SoundWaveform,
} from '../../src/client/audio/synthesis.ts';
import {
  compactOptional,
  effectParameters,
  engineParameters,
  hornDrillParameters,
  maxLayers,
  normalizeSoundName,
  soundEvents,
  soundIds,
  soundId,
  soundNames,
  validateSound,
  validateSoundData,
  type SoundName,
} from '../../src/tools/sound-editor/parameters.ts';
import {
  createSoundStore,
  SoundDataError,
} from '../../src/tools/sound-editor/persistence.ts';
import { TestAudioContext } from '../support/audio-context.ts';

const basic = { volume: 0.5, attack: 10, decay: 100 };

for (const name of ['Laser ping', 'laserPing', 'laser-ping']) {
  assert.equal(normalizeSoundName(name), 'laserPing');
  assert.equal(soundId(normalizeSoundName(name)), 'laser-ping');
}

validateSound('pickup', [basic]);

const fractionalTiming = {
  ...basic,
  attack: 10.4,
  decay: 100.5,
  delay: 3.7,
  hold: 4.2,
  release: 5.8,
  pitchDuration: 18.6,
  filterDuration: 20.3,
};

const exactTiming = { ...fractionalTiming };

validateSound('ui', [fractionalTiming]);

assert.deepEqual(fractionalTiming, {
  ...exactTiming,
  decay: 101,
  delay: 4,
  pitchDuration: 19,
  filterDuration: 20,
});

for (const parameters of [
  effectParameters,
  engineParameters,
  hornDrillParameters,
]) {
  for (const parameter of Object.values(parameters)) {
    if (parameter.max > 500) assert.equal(parameter.integer, true);
  }
}

const fractionalFrequencies = [
  {
    ...basic,
    frequency: 198.4,
    endFrequency: 194.8,
    cutoff: 1999.6,
    highpass: 75.7,
    resonance: 852.7,
    endResonance: 866.4,
    ring: 5.018,
  },
];

validateSound('ui', fractionalFrequencies);

assert.deepEqual(fractionalFrequencies[0], {
  ...basic,
  frequency: 198,
  endFrequency: 195,
  cutoff: 2000,
  highpass: 76,
  resonance: 853,
  endResonance: 866,
  ring: 5.018,
});

validateSound('ui', []);
validateSound('ui', [{ ...basic, attack: 0, decay: 0 }]);

for (const invalid of [NaN, Infinity, -1, 22051, '440', null]) {
  assert.throws(
    () => validateSound('pickup', [{ ...basic, frequency: invalid }]),
    /pickup layer 1.frequency/,
  );
}

for (const invalid of [
  [{ volume: 1, decay: 100 }],
  [{ ...basic, unexpected: 1 }],
  [{ ...basic, cutoff: undefined }],
  Array(33).fill(basic),
  basic,
  null,
]) {
  assert.throws(() => validateSound('ui', invalid));
}

for (const [key, invalid] of [
  ['waveform', 'organ'],
  ['waveform', 1],
  ['attackCurve', 'smooth'],
  ['decayCurve', null],
  ['releaseCurve', undefined],
  ['pitchCurve', 'cubic'],
  ['filterCurve', false],
  ['pulseWidth', 0],
  ['pulseWidth', 1],
  ['delay', -1],
  ['delay', 1001],
  ['attack', 251],
  ['decay', 2501],
  ['hold', 501],
  ['sustain', -0.01],
  ['sustain', 1.01],
  ['release', Infinity],
  ['release', 501],
  ['pitchDuration', NaN],
  ['pitchDuration', 3751],
  ['endCutoff', 22051],
  ['filterDuration', -0.1],
  ['filterDuration', 3751],
  ['highpass', 7001],
  ['endHighpass', 7001],
  ['endHighpass', '100'],
  ['ring', 501],
] as const) {
  assert.throws(
    () => validateSound('ui', [{ ...basic, [key]: invalid }]),
    new RegExp(`ui layer 1.${key}`),
  );
}

validateSound('ui', [
  {
    ...basic,
    attack: 250,
    decay: 2500,
    hold: 500,
    release: 500,
    delay: 1000,
    pitchDuration: 3750,
    filterDuration: 3750,
    highpass: 7000,
    endHighpass: 7000,
    ring: 500,
    sustain: 0,
    pulseWidth: 0.01,
  },
]);

assert.deepEqual(
  compactOptional({
    ...basic,
    frequency: 0,
    cutoff: 0,
    endFrequency: 0,
    highpass: 0,
  }),
  basic,
);

assert.deepEqual(
  compactOptional({ ...basic, frequency: 440, endFrequency: 440 }),
  { ...basic, frequency: 440 },
);
assert.deepEqual(
  compactOptional({ ...basic, frequency: 440, endFrequency: 0 }),
  { ...basic, frequency: 440, endFrequency: 0 },
);

assert.deepEqual(
  compactOptional({
    ...basic,
    cutoff: 70,
    frequency: 440,
    endFrequency: 880,
    highpass: 30,
  }),
  { ...basic, cutoff: 70, highpass: 30 },
);

assert.deepEqual(compactOptional(resolveSoundEffect(basic)), basic);
assert.deepEqual(
  compactOptional({ ...basic, waveform: 'sine', frequency: 440, cutoff: 1200 }),
  { ...basic, waveform: 'sine', frequency: 440, cutoff: 1200 },
  'tonal waveforms can use a low-pass filter without becoming noise',
);

assert.deepEqual(
  compactOptional({
    ...basic,
    waveform: 'noise',
    frequency: 440,
    endFrequency: 880,
  }),
  { ...basic, waveform: 'noise' },
  'unfiltered noise remains explicit while unused pitch settings disappear',
);

assert.deepEqual(
  compactOptional({ ...basic, waveform: 'pulse', pulseWidth: 0.25 }),
  { ...basic, waveform: 'pulse', pulseWidth: 0.25 },
);

assert.deepEqual(
  compactOptional({ ...basic, resonance: 2200, ring: 50 }),
  { ...basic, resonance: 2200 },
  'default rings stay implicit',
);

assert.deepEqual(compactOptional({ ...basic, resonance: 2200, ring: 120 }), {
  ...basic,
  resonance: 2200,
  ring: 120,
});

assert.deepEqual(
  compactOptional({
    ...basic,
    pulseWidth: 0.25,
    pitchDuration: 10,
    pitchCurve: 'ease-in',
    filterDuration: 0,
    filterCurve: 'ease-out',
  }),
  basic,
  'pulse settings and constant pitch/filter sweep controls are unused',
);

const fullDuration = basic.attack + basic.decay + 20 + 30;

const derived: SoundEffect = {
  ...basic,
  frequency: 110,
  endFrequency: 220,
  hold: 20,
  release: 30,
  pitchDuration: fullDuration,
  filterDuration: fullDuration,
  endCutoff: 1200,
};

const compactDerived = compactOptional(derived);

assert(!Object.hasOwn(compactDerived, 'pitchDuration'));
assert(!Object.hasOwn(compactDerived, 'filterDuration'));
assert.equal(compactDerived.endCutoff, 1200);

const roundedDefaults: SoundEffect = {
  volume: 0.5,
  waveform: 'sine',
  frequency: 220,
  endFrequency: 440,
  attack: 20,
  decay: 200,
  hold: 60,
  release: 80,
  pitchDuration: 360,
  cutoff: 2000,
  endCutoff: 500,
  highpass: 10,
  endHighpass: 100,
  filterDuration: 360,
};

const compactRounded = compactOptional(roundedDefaults);

assert(!Object.hasOwn(compactRounded, 'pitchDuration'));
assert(!Object.hasOwn(compactRounded, 'filterDuration'));
assert.deepEqual(
  compactOptional(compactRounded),
  compactRounded,
  'compaction is idempotent after removing rounded default durations',
);

const editedEnvelope = resolveSoundEffect({ ...compactRounded, hold: 100 });

assert.equal(editedEnvelope.pitchDuration, 20 + 200 + 100 + 80);
assert.equal(editedEnvelope.filterDuration, editedEnvelope.pitchDuration);

const waveforms: SoundWaveform[] = [
  'sine',
  'triangle',
  'square',
  'pulse',
  'sawtooth',
  'noise',
];
const curves: SoundCurve[] = ['linear', 'exponential', 'ease-in', 'ease-out'];

const equivalenceCases: SoundEffect[] = [
  basic,
  resolveSoundEffect(basic),
  { ...basic, frequency: 440, endFrequency: 440, cutoff: 0 },
  { ...basic, frequency: 440, endFrequency: 0, highpass: 30 },
  { ...basic, frequency: 0, endFrequency: 880 },
  { ...basic, cutoff: 70, frequency: 440, endFrequency: 880, highpass: 30 },
  { ...basic, waveform: 'sine', frequency: 440, cutoff: 1200 },
  { ...basic, waveform: 'noise', frequency: 440, endFrequency: 880 },
  { ...basic, waveform: 'pulse', pulseWidth: 0.5, frequency: 440 },
  {
    ...basic,
    attack: 0,
    decay: 0,
    hold: 0,
    release: 0,
    sustain: 0.5,
    attackCurve: 'ease-in',
    decayCurve: 'linear',
    releaseCurve: 'ease-out',
  },
  { ...basic, attack: 30, decay: 0, sustain: 0.5, decayCurve: 'ease-in' },
  {
    ...basic,
    frequency: 440,
    sustain: 1,
    decayCurve: 'ease-in',
    hold: 20,
    release: 30,
  },
  {
    ...basic,
    frequency: 440,
    decay: 0,
    hold: 20,
    sustain: 1,
    decayCurve: 'ease-in',
    release: 30,
    releaseCurve: 'linear',
  },
  {
    ...basic,
    frequency: 440,
    sustain: 0,
    release: 30,
    releaseCurve: 'ease-out',
  },
  {
    ...basic,
    frequency: 110,
    endFrequency: 440,
    pitchDuration: 0,
    pitchCurve: 'exponential',
    cutoff: 0,
    endCutoff: 1000,
    highpass: 30,
    endHighpass: 0,
    filterDuration: 0,
    filterCurve: 'ease-out',
  },
  derived,
  ...waveforms.flatMap((waveform) =>
    curves.map((curve) => ({
      ...basic,
      waveform,
      frequency: 110,
      endFrequency: 660,
      pulseWidth: 0.25,
      delay: 7,
      hold: 20,
      sustain: 0.35,
      release: 40,
      attackCurve: curve,
      decayCurve: curve,
      releaseCurve: curve,
      pitchDuration: 30,
      pitchCurve: curve,
      cutoff: 2400,
      endCutoff: 400,
      highpass: 30,
      endHighpass: 180,
      filterDuration: 50,
      filterCurve: curve,
    })),
  ),
];

const context = new TestAudioContext() as unknown as AudioContext;
const random = Math.random;

try {
  Math.random = () => 0.75;

  for (const effect of equivalenceCases) {
    validateSound('ui', [effect]);
    validateSound('ui', [compactOptional(effect)]);

    assert.deepEqual(
      renderEffectBuffer({
        context,
        layers: [compactOptional(effect)],
      }).getChannelData(0),
      renderEffectBuffer({ context, layers: [effect] }).getChannelData(0),
      `compaction preserves every rendered sample: ${JSON.stringify(effect)}`,
    );
  }

  const roundedSamples = renderEffectBuffer({
    context,
    layers: [roundedDefaults],
  }).getChannelData(0);

  const compactSamples = renderEffectBuffer({
    context,
    layers: [compactRounded],
  }).getChannelData(0);

  assert.equal(compactSamples.length, roundedSamples.length);
  assert(
    compactSamples.every(
      (sample, index) => Math.abs(sample - roundedSamples[index]) <= 1e-6,
    ),
    'removing floating-point roundoff from derived durations preserves samples within 1e-6',
  );
} finally {
  Math.random = random;
}

const directory = await mkdtemp(join(tmpdir(), 'unicorn-sound-editor-'));
const fileFor = (name: SoundName) => join(directory, `${soundIds[name]}.ts`);

try {
  await Promise.all(
    soundNames.map((name) =>
      copyFile(join('src/specs/sounds', `${soundIds[name]}.ts`), fileFor(name)),
    ),
  );

  const store = createSoundStore(directory);
  const loaded = await store.read();

  assert.deepEqual(loaded.unassigned, {});
  assert.deepEqual(loaded.layerRevisions, {});
  await assert.rejects(access(join(directory, 'unassigned')));

  validateSoundData({
    effectData: loaded.effectData,
    continuousData: loaded.continuousData,
  });

  assert.deepEqual(Object.keys(loaded.effectData), soundEvents);
  assert.deepEqual(Object.keys(loaded.revisions), soundNames);
  assert(soundNames.every((name) => loaded.revisions[name].length === 64));

  const snapshots = Object.fromEntries(
    await Promise.all(
      soundNames.map(async (name) => [
        name,
        await readFile(fileFor(name), 'utf8'),
      ]),
    ),
  );
  const layers: SoundEffect[] = [
    ...loaded.effectData.hatchOpen,
    { ...basic, cutoff: 70, frequency: 440, endFrequency: 880, highpass: 0 },
  ];

  const saved = await store.save('hatchOpen', {
    data: layers,
    revision: loaded.revisions.hatchOpen,
  });

  const reloaded = await store.readSound('hatchOpen');

  assert.notEqual(saved.revision, loaded.revisions.hatchOpen);
  assert.deepEqual(reloaded, saved);
  assert.deepEqual(reloaded.data[1], { ...basic, cutoff: 70 });
  assert.match(await readFile(fileFor('hatchOpen'), 'utf8'), /export default/);
  assert.doesNotMatch(
    await readFile(fileFor('hatchOpen'), 'utf8'),
    /frequency|endFrequency|highpass/,
  );

  for (const name of soundNames.filter((name) => name !== 'hatchOpen')) {
    assert.equal(
      await readFile(fileFor(name), 'utf8'),
      snapshots[name],
      'saving one sound leaves all other files byte-for-byte unchanged',
    );
  }

  await assert.rejects(
    store.save('hatchOpen', {
      data: layers,
      revision: loaded.revisions.hatchOpen,
    }),
    (error: SoundDataError) => error.status === 409,
  );

  await assert.rejects(
    store.save('hatchOpen', {
      data: [{ ...basic, volume: Infinity }],
      revision: saved.revision,
    }),
    (error: SoundDataError) => error.status === 400,
  );

  assert.deepEqual(await store.readSound('hatchOpen'), saved);

  // An unrelated file's edit or syntax error cannot block saving this sound.
  const unrelated = `${snapshots.hatchClose}\n// Edited alongside the tool.\n`;

  await writeFile(fileFor('hatchClose'), unrelated);

  const engine = await store.save('engine', {
    data: { ...loaded.continuousData.engine, frequency: 55 },
    revision: loaded.revisions.engine,
  });

  assert.equal(engine.data.frequency, 55);
  assert.equal(await readFile(fileFor('hatchClose'), 'utf8'), unrelated);

  await assert.rejects(
    store.save('hatchClose', {
      data: loaded.effectData.hatchClose,
      revision: loaded.revisions.hatchClose,
    }),
    (error: SoundDataError) => error.status === 409,
  );

  await writeFile(fileFor('hatchClose'), 'export default [;');
  await assert.rejects(store.read());
  assert.deepEqual(await store.readSound('hatchOpen'), saved);

  const hornDrill = await store.save('hornDrill', {
    data: { ...loaded.continuousData.hornDrill, ramp: 30 },
    revision: loaded.revisions.hornDrill,
  });

  assert.equal(hornDrill.data.ramp, 30);
  await writeFile(fileFor('hatchClose'), snapshots.hatchClose);

  const current = await store.readSound('engine');

  const results = await Promise.allSettled([
    store.save('engine', {
      data: { ...current.data, frequency: 88 },
      revision: current.revision,
    }),
    store.save('engine', {
      data: { ...current.data, frequency: 99 },
      revision: current.revision,
    }),
    store.save('pickup', { data: [basic], revision: loaded.revisions.pickup }),
  ]);

  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal((results[1] as PromiseRejectedResult).reason.status, 409);
  assert.equal(results[2].status, 'fulfilled');
  assert.equal((await store.readSound('engine')).data.frequency, 88);
  assert.deepEqual((await store.readSound('pickup')).data, [basic]);

  for (let index = 0; index < equivalenceCases.length; index += maxLayers) {
    const current = await store.readSound('pickup');
    const layers = equivalenceCases.slice(index, index + maxLayers);
    const expected = layers.map(compactOptional);

    const saved = await store.save('pickup', {
      data: layers,
      revision: current.revision,
    });

    const reloaded = await store.readSound('pickup');

    assert.deepEqual(saved.data, expected);
    assert.deepEqual(reloaded, saved);
    validateSound('pickup', reloaded.data);
    assert.match(await readFile(fileFor('pickup'), 'utf8'), /waveform: '/);

    try {
      Math.random = () => 0.75;
      assert.deepEqual(
        renderEffectBuffer({ context, layers: reloaded.data }).getChannelData(
          0,
        ),
        renderEffectBuffer({ context, layers }).getChannelData(0),
        'extended layers retain their exact rendered mix through a saved TypeScript roundtrip',
      );
    } finally {
      Math.random = random;
    }
  }

  await assert.rejects(
    store.readSound('../hatch-open' as SoundName),
    (error: SoundDataError) => error.status === 404,
  );
  assert.deepEqual(
    (await readdir(directory)).sort(),
    soundNames.map((name) => `${soundIds[name]}.ts`).sort(),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(
  'Individual sound saves, compact optional settings, independent revisions, and conflict protection passed.',
);

const creationDirectory = await mkdtemp(
  join(tmpdir(), 'unicorn-sound-library-'),
);

try {
  await Promise.all(
    soundNames.map((name) =>
      copyFile(
        join('src/specs/sounds', `${soundId(name)}.ts`),
        join(creationDirectory, `${soundId(name)}.ts`),
      ),
    ),
  );

  const store = createSoundStore(creationDirectory);
  const builtins = await store.read();
  const pickupSource = await readFile(
    join(creationDirectory, 'pickup.ts'),
    'utf8',
  );
  const warp = await store.createEvent({ name: 'Warp ping', data: [basic] });

  assert.equal(warp.name, 'warpPing');
  assert.deepEqual(warp.data, [basic]);

  assert.deepEqual(await store.readSound('warp-ping'), {
    data: warp.data,
    revision: warp.revision,
  });

  assert.match(
    await readFile(join(creationDirectory, 'warp-ping.ts'), 'utf8'),
    /satisfies SoundEffect\[\]/,
  );
  await store.createEvent({ name: 'Alien chime', data: [] });
  assert.deepEqual(Object.keys((await store.read()).effectData), [
    ...soundEvents,
    'alienChime',
    'warpPing',
  ]);

  for (const name of ['warpPing', 'Warp-ping', 'warp ping']) {
    await assert.rejects(
      store.createEvent({ name, data: [] }),
      (error: SoundDataError) => error.status === 409,
    );
    assert.deepEqual((await store.readSound('warpPing')).data, [basic]);
  }

  for (const name of [
    '',
    '../escape',
    'a/b',
    'a\\b',
    '.hidden',
    'a;throw',
    '--',
    'A'.repeat(65),
    'engine',
    'horn-drill',
    'unassigned',
  ]) {
    await assert.rejects(
      store.createEvent({ name, data: [] }),
      (error: SoundDataError) => error.status === 400,
    );
    await assert.rejects(
      store.createLayer({ name, data: basic }),
      (error: SoundDataError) => error.status === 400,
    );
  }

  await assert.rejects(
    store.createEvent({
      name: 'Broken event',
      data: [{ ...basic, waveform: 'invalid' }],
    }),
    (error: SoundDataError) => error.status === 400,
  );

  await assert.rejects(
    store.createLayer({ name: 'Broken layer', data: [basic] }),
    (error: SoundDataError) => error.status === 400,
  );

  await assert.rejects(
    store.createLayer({
      name: 'Broken layer',
      data: { ...basic, frequency: Infinity },
    }),
    (error: SoundDataError) => error.status === 400,
  );

  const independentStore = createSoundStore(creationDirectory);
  const firstLayers = await Promise.all([
    store.createLayer({ name: 'First template', data: basic }),
    independentStore.createLayer({ name: 'Second template', data: basic }),
  ]);

  assert.deepEqual(
    firstLayers.map(({ name }) => name),
    ['firstTemplate', 'secondTemplate'],
  );

  const layer = await store.createLayer({
    name: 'Radiant pop',
    data: { ...basic, waveform: 'triangle', frequency: 880 },
  });

  assert.equal(layer.name, 'radiantPop');

  assert.deepEqual(await store.readLayer('radiant-pop'), {
    data: layer.data,
    revision: layer.revision,
  });

  assert.match(
    await readFile(
      join(creationDirectory, 'unassigned/radiant-pop.ts'),
      'utf8',
    ),
    /from '\.\.\/\.\.\/\.\.\/client\/audio\/synthesis'/,
  );
  await store.createLayer({ name: 'Pickup', data: basic });
  assert.equal(
    await readFile(join(creationDirectory, 'pickup.ts'), 'utf8'),
    pickupSource,
  );

  const copied = await store.createEvent({
    name: 'Shimmer',
    data: [structuredClone(layer.data)],
  });

  const copyPath = join(creationDirectory, 'shimmer.ts');
  const copiedSource = await readFile(copyPath, 'utf8');

  const updatedLayer = await store.saveLayer('radiantPop', {
    data: { ...layer.data, frequency: 440 },
    revision: layer.revision,
  });

  assert.equal(updatedLayer.data.frequency, 440);
  assert.equal(await readFile(copyPath, 'utf8'), copiedSource);
  assert.deepEqual((await store.readSound('shimmer')).data, copied.data);
  assert.doesNotMatch(copiedSource, /unassigned/);
  await assert.rejects(
    store.saveLayer('radiantPop', { data: basic, revision: layer.revision }),
    (error: SoundDataError) => error.status === 409,
  );

  await store.save('shimmer', {
    data: [{ ...layer.data, frequency: 660 }],
    revision: copied.revision,
  });

  assert.equal((await store.readLayer('radiantPop')).data.frequency, 440);

  const layerPath = join(creationDirectory, 'unassigned/radiant-pop.ts');
  const external = `${await readFile(layerPath, 'utf8')}\n// Edited in source.\n`;

  await writeFile(layerPath, external);

  await assert.rejects(
    store.saveLayer('radiantPop', {
      data: basic,
      revision: updatedLayer.revision,
    }),
    (error: SoundDataError) => error.status === 409,
  );

  assert.equal(await readFile(layerPath, 'utf8'), external);
  await store.save('pickup', { data: [], revision: builtins.revisions.pickup });

  const simultaneous = await Promise.allSettled([
    store.createLayer({ name: 'Concurrent voice', data: basic }),
    independentStore.createLayer({
      name: 'concurrent-voice',
      data: { ...basic, volume: 1 },
    }),
  ]);

  const winner = simultaneous.find(
    (result) => result.status === 'fulfilled',
  ) as PromiseFulfilledResult<{ data: SoundEffect }>;

  const loser = simultaneous.find(
    (result) => result.status === 'rejected',
  ) as PromiseRejectedResult;

  assert(winner);
  assert(loser);
  assert.equal(loser.reason.status, 409);
  assert.deepEqual(
    (await store.readLayer('concurrentVoice')).data,
    winner.value.data,
    'racing create requests cannot replace the winning file',
  );

  const eventLink = join(creationDirectory, 'portal.ts');

  await symlink(join(creationDirectory, 'pickup.ts'), eventLink);
  await assert.rejects(
    store.readSound('portal'),
    (error: SoundDataError) => error.status === 404,
  );
  await assert.rejects(
    store.createEvent({ name: 'Portal', data: [basic] }),
    (error: SoundDataError) => error.status === 409,
  );
  assert.deepEqual((await store.readSound('pickup')).data, []);
  await unlink(eventLink);

  const layerLink = join(creationDirectory, 'unassigned/linked.ts');

  await symlink(layerPath, layerLink);
  await assert.rejects(
    store.readLayer('linked'),
    (error: SoundDataError) => error.status === 404,
  );
  await assert.rejects(
    store.createLayer({ name: 'Linked', data: basic }),
    (error: SoundDataError) => error.status === 409,
  );
  assert.equal(await readFile(layerPath, 'utf8'), external);
  await unlink(layerLink);

  const otherDirectory = join(creationDirectory, 'other');

  await mkdir(otherDirectory);
  await symlink(
    join(creationDirectory, 'unassigned'),
    join(otherDirectory, 'unassigned'),
    'dir',
  );

  await assert.rejects(
    createSoundStore(otherDirectory).createLayer({
      name: 'Blocked',
      data: basic,
    }),
    (error: SoundDataError) => error.status === 400,
  );

  await assert.rejects(
    async () =>
      store.saveLayer('../escape', { data: basic, revision: layer.revision }),
    (error: SoundDataError) => error.status === 404,
  );
  await assert.rejects(
    store.readLayer('missing'),
    (error: SoundDataError) => error.status === 404,
  );

  // Manually authored specs join the catalog without changing the tool's code.
  await writeFile(
    join(creationDirectory, 'external-sound.ts'),
    'export default [];',
  );
  await writeFile(join(creationDirectory, 'laser-2.ts'), 'export default [];');
  assert.deepEqual((await store.readSound('externalSound')).data, []);
  assert.deepEqual((await store.readSound('laser2')).data, []);
  await assert.rejects(
    store.createEvent({ name: 'Laser2', data: [basic] }),
    (error: SoundDataError) => error.status === 409,
  );
  await writeFile(join(creationDirectory, 'laser2.ts'), 'export default [];');
  await assert.rejects(
    store.readSound('laser2'),
    (error: SoundDataError) => error.status === 409,
  );
  await unlink(join(creationDirectory, 'laser2.ts'));

  const curveData = [
    {
      ...basic,
      gainPoints: [0, 1, 0.25, 0],
      gainPositions: [0, 0.1, 0.4, 1],
      resonance: 2100,
      endResonance: 3300,
      filterDuration: 42,
    },
  ];

  await store.createEvent({ name: 'Curve test', data: curveData });
  assert.deepEqual((await store.readSound('curveTest')).data, curveData);
  const storedCurve = await store.readSound('curveTest');
  const editedCurve = [{ ...curveData[0], gainPoints: [0, 0.5, 1, 0] }];

  await store.save('curveTest', {
    data: editedCurve,
    revision: storedCurve.revision,
  });

  assert.deepEqual((await store.readSound('curveTest')).data, editedCurve);

  const catalog = await store.read();

  assert.equal(
    catalog.layerRevisions.radiantPop,
    (await store.readLayer('radiantPop')).revision,
  );
  assert.equal(catalog.unassigned.radiantPop.frequency, 440);
  assert.deepEqual(catalog.effectData.shimmer, [
    { ...layer.data, frequency: 660 },
  ]);
  assert.equal(catalog.effectData.externalSound.length, 0);
  assert(
    !(await readdir(creationDirectory, { recursive: true })).some((file) =>
      file.endsWith('.tmp'),
    ),
    'atomic creates and saves leave no temporary source files',
  );
} finally {
  await rm(creationDirectory, { recursive: true, force: true });
}

console.log(
  'Dynamic event discovery, named layer copies, atomic creation, independent revisions, and path guards passed.',
);

const curved = {
  ...basic,
  resonance: 2200,
  endResonance: 3400,
  filterDuration: 42,
  gainPoints: [0, 0.7, 0.2, 1, 0],
};

validateSound('acquireTarget', [curved]);
const compactCurve = compactOptional(curved);

assert.deepEqual(compactCurve.gainPoints, curved.gainPoints);
assert.notEqual(compactCurve.gainPoints, curved.gainPoints);
assert.equal(compactCurve.endResonance, 3400);
assert.equal(compactCurve.filterDuration, 42);

for (const gainPoints of [
  [0.5],
  [0, NaN],
  [0, 1.1],
  [0, -0.1],
  Array(33).fill(1),
  '0,1',
]) {
  assert.throws(
    () => validateSound('acquireTarget', [{ ...basic, gainPoints }]),
    /gainPoints/,
  );
}

validateSound('acquireTarget', [{ ...basic, gainPoints: [] }]);

for (const gainPositions of [
  [0, 0.5, 0.5, 1],
  [0.1, 0.2, 0.5, 1],
  [0, 1],
  [0, 0.4, NaN, 1],
]) {
  assert.throws(
    () =>
      validateSound('sound', [
        {
          volume: 1,
          attack: 0,
          decay: 100,
          gainPoints: [0, 1, 0.5, 0],
          gainPositions,
        },
      ]),
    /gainPositions/,
  );
}
