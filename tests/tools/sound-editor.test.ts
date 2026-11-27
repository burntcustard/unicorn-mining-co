import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  maxLayers,
  soundEvents,
  type SoundData,
  soundId,
  validateSound,
} from '../../src/tools/sound-editor/parameters.ts';
import {
  createSoundStore,
  SoundDataError,
} from '../../src/tools/sound-editor/persistence.ts';
import type { SoundEffect } from '../../src/client/audio/synthesis.ts';

const testEffect = {
  volume: 0.5,
  attack: 5,
  decay: 50,
  frequency: 440,
} satisfies SoundEffect;

const testSoundData = (): SoundData => ({
  effectData: Object.fromEntries(
    soundEvents.map((event) => [event, [{ ...testEffect }]]),
  ),
  continuousData: {
    engine: {
      duration: 100,
      frequency: 40,
      fundamental: 0.7,
      secondHarmonic: 0.3,
      thirdHarmonic: 0,
      motorVolume: 0.25,
      noiseSmoothing: 0.05,
      noiseFilter: 0.05,
      noiseVolume: 0,
      noisePulse: 0,
      basePitch: 1,
      revRange: 1,
      idleVolume: 0.2,
      volume: 0.5,
      ramp: 300,
    },
    hornDrill: {
      duration: 40,
      frequency: 50,
      volume: 0.5,
      highpass: 100,
      basePitch: 1,
      activeVolume: 0.6,
      bitingVolume: 0.8,
      activePitch: 1.2,
      bitingPitch: 1.4,
      ramp: 300,
    },
  },
});

const curve = {
  volume: testEffect.volume,
  attack: testEffect.attack,
  decay: testEffect.decay,
  waveform: 'sine' as const,
  cutoff: 2000,
  gainPoints: [0, 1, 0],
  gainPositions: [0, 0.1, 1],
  pitchPoints: [440, 660, 440],
  resonancePoints: [700, 1000, 700],
  partials: [1, 0.25],
  partialRatio: 0.2,
  lowpassOrder: 3,
};

for (const [key, value] of [
  ['waveform', 'organ'],
  ['frequency', Infinity],
  ['gainPositions', [0, 0, 1]],
  ['pitchPoints', [440, 600.5]],
  ['resonancePoints', [700, 0]],
  ['partials', [1, -0.1]],
  ['lowpassOrder', 0],
] as const) {
  assert.throws(
    () => validateSound('fixture', [{ ...curve, [key]: value }]),
    new RegExp(`fixture layer 1\\.${key}`),
  );
}

assert.throws(() => validateSound('fixture', Array(maxLayers + 1).fill(curve)));
assert.throws(() => validateSound('fixture', [{ ...curve, extra: 1 }]));
const timing = { ...testEffect, attack: 5.5, delay: 6.5, frequency: 440.5 };

validateSound('fixture', [timing]);

assert.deepEqual(timing, {
  ...testEffect,
  attack: 5.5,
  delay: 7,
  frequency: 441,
});

const directory = await mkdtemp(join(tmpdir(), 'unicorn-sound-editor-'));
const fileFor = (name: string) => join(directory, `${soundId(name)}.ts`);
const hasStatus = (status: number) => (error: unknown) =>
  error instanceof SoundDataError && error.status === status;

try {
  const { effectData, continuousData } = testSoundData();

  await Promise.all(
    Object.entries({ ...effectData, ...continuousData }).map(([name, data]) =>
      writeFile(fileFor(name), `export default ${JSON.stringify(data)};\n`),
    ),
  );

  const store = createSoundStore(directory);
  const loaded = await store.read();

  assert.deepEqual(loaded.effectData, effectData);
  assert.deepEqual(loaded.continuousData, continuousData);
  assert.deepEqual(loaded.unassigned, {});

  const initial = loaded.revisions.hatchOpen;
  const brokenSource = 'export default [;';
  const otherPath = fileFor('hatchClose');

  await writeFile(otherPath, brokenSource);

  const [winner, stale, unrelated] = await Promise.allSettled([
    store.save('hatchOpen', {
      data: [{ ...curve, frequency: 440, endFrequency: 440, fmRatio: 2 }],
      revision: initial,
    }),
    store.save('hatchOpen', { data: [], revision: initial }),
    store.save('engine', {
      data: { ...continuousData.engine, frequency: 55 },
      revision: loaded.revisions.engine,
    }),
  ]);

  assert.equal(winner.status, 'fulfilled');
  assert.equal(stale.status, 'rejected');
  assert(hasStatus(409)(stale.reason));
  assert.equal(unrelated.status, 'fulfilled');
  assert.notEqual(winner.value.revision, initial);

  assert.deepEqual(await store.readSound('hatchOpen'), {
    data: [curve],
    revision: winner.value.revision,
  });

  assert.equal(await readFile(otherPath, 'utf8'), brokenSource);
  await assert.rejects(store.read());
  await writeFile(
    otherPath,
    `export default ${JSON.stringify(effectData.hatchClose)};\n`,
  );

  const externalPath = fileFor('External ping');

  await writeFile(externalPath, 'export default [];\n');
  assert.deepEqual((await store.read()).effectData.externalPing, []);
  await assert.rejects(
    store.createEvent({ name: 'External Ping', data: [] }),
    hasStatus(409),
  );
  await assert.rejects(
    store.createEvent({ name: 'Engine', data: [] }),
    hasStatus(400),
  );

  const layer = await store.createLayer({ name: 'Tone preset', data: curve });

  const event = await store.createEvent({
    name: 'Example chime',
    data: [layer.data],
  });

  assert.equal(event.name, 'exampleChime');

  assert.deepEqual(await store.readSound('example-chime'), {
    data: [curve],
    revision: event.revision,
  });

  const updated = await store.saveLayer('tone-preset', {
    data: { ...curve, volume: 0.7 },
    revision: layer.revision,
  });

  await assert.rejects(
    store.saveLayer(layer.name, { data: curve, revision: layer.revision }),
    hasStatus(409),
  );
  const catalog = await store.read();

  assert.deepEqual(catalog.effectData.exampleChime, [curve]);
  assert.deepEqual(catalog.unassigned.tonePreset, updated.data);
  assert.equal(catalog.layerRevisions.tonePreset, updated.revision);

  const independentStore = createSoundStore(directory);

  const creations = await Promise.allSettled([
    store.createLayer({ name: 'Concurrent voice', data: testEffect }),
    independentStore.createLayer({
      name: 'concurrent-voice',
      data: { ...testEffect, frequency: 880 },
    }),
  ]);

  const created = creations.find((result) => result.status === 'fulfilled');
  const rejected = creations.find((result) => result.status === 'rejected');

  assert(created);
  assert(rejected && hasStatus(409)(rejected.reason));
  assert.deepEqual(
    (await store.readLayer('concurrentVoice')).data,
    created.value.data,
  );

  await symlink(externalPath, fileFor('linked'));
  await assert.rejects(store.readSound('linked'), hasStatus(404));
  await assert.rejects(
    store.createEvent({ name: 'linked', data: [] }),
    hasStatus(409),
  );
  assert(
    !(await readdir(directory, { recursive: true })).some((file) =>
      file.endsWith('.tmp'),
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
