import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, sampleRate } from '../../src/tools/sound-analysis/render.ts';
import {
  readFloat32,
  readLayers,
} from '../../src/tools/sound-analysis/runtime.ts';
import { summarizeTiming } from '../../src/tools/sound-analysis/timing.ts';

const layers = [{ volume: 0.2, frequency: 1800, attack: 1, decay: 40 }];
const samples = render(layers);
const summary = summarizeTiming({ samples });

assert.ok(Math.abs(summary.durationMs - 41) < 0.03);
assert.ok(summary.peak > 0 && summary.peak < 0.2);
assert.equal(summary.energyAfterRepeatPercent, 0);
assert.equal(summary.repeatPeak, summary.peak);

assert.equal(
  summarizeTiming({
    samples: Float32Array.of(0.5, 0.75),
    repeatMs: 1000 / sampleRate,
  }).repeatPeak,
  1.25,
);

assert.throws(
  () => summarizeTiming({ samples, repeatMs: 0 }),
  /positive repeat interval/,
);
assert.throws(
  () => summarizeTiming({ samples: Float32Array.of(NaN) }),
  /Non-finite/,
);

const noise = [{ ...layers[0], waveform: 'noise' as const }];

assert.deepEqual(render(noise, 1), render(noise, 1));
assert.notDeepEqual(render(noise, 1), render(noise, 2));

const directory = mkdtempSync(join(tmpdir(), 'sound-analysis-test-'));
const toolDirectory = fileURLToPath(
  new URL('../../src/tools/sound-analysis/', import.meta.url),
);

const run = (script: string, ...args: string[]) => {
  const path = join(directory, 'cli.log');
  const log = openSync(path, 'w');

  try {
    execFileSync(process.execPath, [join(toolDirectory, script), ...args], {
      cwd: directory,
      stdio: ['ignore', log, log],
    });
  } catch (error) {
    throw new Error(readFileSync(path, 'utf8'), { cause: error });
  } finally {
    closeSync(log);
  }

  return readFileSync(path, 'utf8');
};

try {
  const preRoll = Math.round((sampleRate * 30) / 1000);
  const clip = Buffer.alloc((preRoll + samples.length) * 4);

  samples.forEach((sample, index) =>
    clip.writeFloatLE(sample, (preRoll + index) * 4),
  );
  writeFileSync(join(directory, 'reference.f32'), clip);
  assert.deepEqual(
    readFloat32(join(directory, 'reference.f32')).subarray(preRoll),
    samples,
  );

  writeFileSync(
    join(directory, 'base.ts'),
    `export default ${JSON.stringify([{ ...layers[0], volume: 0.1 }])};`,
  );
  writeFileSync(join(directory, 'target.json'), JSON.stringify(layers[0]));
  const [reference, base, target] = run(
    'compare.ts',
    'reference.f32',
    'base.ts',
    'target.json',
    '--onset',
    '30',
    '--png',
    'comparison.png',
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(target.spectralErrorDb, 0);
  assert.equal(target.peak, reference.peak);
  assert.ok(Math.abs(target.dominantFrequencyHz - 1800) < 44);
  assert.ok(base.spectralErrorDb > 0);
  assert.ok(base.peak < target.peak);
  const png = readFileSync(join(directory, 'comparison.png'));

  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.ok(png.readUInt32BE(20) > png.readUInt32BE(16));
  const fit = JSON.parse(
    run('fit.ts', 'reference.f32', 'base.ts', 'fit.json', '--onset', '30'),
  );

  assert.ok(fit.spectralErrorDb < fit.initialErrorDb);
  assert.equal((await readLayers(join(directory, 'fit.json'))).length, 1);
  assert.throws(
    () => run('fit.ts', 'reference.f32', 'base.ts', 'fit.json'),
    /EEXIST/,
  );

  const audit = JSON.parse(
    run('audit.ts', 'target.json', '--repeat-wav', 'repeat.wav'),
  );
  const wav = readFileSync(join(directory, 'repeat.wav'));

  assert.equal(audit.event.repeatPeak, summary.peak);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), sampleRate);
  assert.equal(wav.readUInt32LE(40), (samples.length + 7 * 2205) * 2);
} finally {
  rmSync(directory, { recursive: true });
}

// Gain curves must preserve legacy rendering when absent or uniformly one.
const sustained = {
  waveform: 'sine' as const,
  volume: 0.2,
  frequency: 1200,
  attack: 1,
  decay: 0,
  sustain: 1,
  hold: 90,
  release: 9,
};

assert.deepEqual(
  render([sustained]),
  render([{ ...sustained, gainPoints: [1, 1] }]),
);
assert.ok(
  render([{ ...sustained, gainPoints: [0, 0] }]).every((value) => value === 0),
);
const fading = render([{ ...sustained, gainPoints: [1, 0] }]);
const full = render([sustained]);
const middle = Math.round(0.05 * sampleRate);

assert.ok(Math.abs(fading[middle] - full[middle] * 0.5) < 0.0001);

const resonating = {
  ...sustained,
  waveform: 'noise' as const,
  resonance: 2300,
  ring: 10,
};

assert.deepEqual(
  render([resonating]),
  render([{ ...resonating, endResonance: 2300 }]),
);
const sweeping = render([{ ...resonating, endResonance: 4600 }]);

assert.ok(sweeping.every(Number.isFinite));
assert.notDeepEqual(sweeping, render([resonating]));

// Nonuniform gain positions preserve a short transient inside a longer layer.
const timed = {
  volume: 0.2,
  frequency: 1000,
  attack: 0,
  decay: 100,
  sustain: 1,
  gainPoints: [0, 1, 0, 0],
  gainPositions: [0, 0.1, 0.2, 1],
};

const timedSamples = render([timed]);

assert.ok(
  timedSamples.slice(200, 600).some((sample) => Math.abs(sample) > 0.1),
);
assert.ok(timedSamples.slice(1000).every((sample) => Math.abs(sample) < 1e-7));
assert.deepEqual(
  render([{ ...timed, gainPositions: [] }]),
  render([{ ...timed, gainPositions: undefined }]),
);
