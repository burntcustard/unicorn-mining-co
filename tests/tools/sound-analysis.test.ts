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
import { analyzeSpectrum } from '../../src/tools/sound-analysis/spectrum.ts';
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
const modulationProbe = { ...sustained, frequency: 1000, hold: 200 };

const fmProbe = { ...modulationProbe, frequency: 2000 };
const fmBase = render([fmProbe]);
const fm = render([{ ...fmProbe, fmRatio: 0.35, fmDepth: 1.5 }]);

const amplitudeAt = (samples: Float32Array, frequency: number) => {
  let real = 0;
  let imaginary = 0;
  const start = Math.round(sampleRate * 0.05);
  const end = Math.round(sampleRate * 0.15);

  for (let i = start; i < end; i++) {
    const phase = (i * frequency * Math.PI * 2) / sampleRate;

    real += samples[i] * Math.cos(phase);
    imaginary += samples[i] * Math.sin(phase);
  }

  return (2 * Math.hypot(real, imaginary)) / (end - start);
};

assert.deepEqual(fmBase, render([{ ...fmProbe, fmRatio: 0.35, fmDepth: 0 }]));
assert.deepEqual(fmBase, render([{ ...fmProbe, fmRatio: 0, fmDepth: 1.5 }]));

for (const sideband of [1300, 2700]) {
  assert.ok(amplitudeAt(fm, sideband) > 0.02);
  assert.ok(amplitudeAt(fmBase, sideband) < 0.0001);
}

const fmHigh = render([
  { ...fmProbe, frequency: 18000, fmRatio: 16, fmDepth: 16 },
]);

assert.ok(fmHigh.every(Number.isFinite));
assert.deepEqual(fmHigh, render([{ ...fmProbe, frequency: 18000 }]));

const partialProbe = {
  ...fmProbe,
  partials: [0.5, 1, 0.25],
  partialRatio: 0.25,
};

const partialSamples = render([partialProbe]);
const carrierLevel = amplitudeAt(partialSamples, 2000);

assert.ok(
  Math.abs(amplitudeAt(partialSamples, 1500) / carrierLevel - 0.5) < 0.001,
);
assert.ok(
  Math.abs(amplitudeAt(partialSamples, 2500) / carrierLevel - 0.25) < 0.001,
);
assert.ok(amplitudeAt(partialSamples, 1000) < 0.0001);
assert.deepEqual(fmBase, render([{ ...fmProbe, partials: [] }]));
assert.ok(render([{ ...fmProbe, partials: [0, 0, 0] }]).every((x) => x === 0));
assert.ok(
  render([{ ...fmProbe, partials: [1, 0, 0], partialRatio: 2 }]).every(
    (x) => x === 0,
  ),
);
const highPartials = render([
  { ...fmProbe, frequency: 18000, partials: [1, 1, 1], partialRatio: 0.5 },
]);

assert.ok(highPartials.every(Number.isFinite));
assert.ok(amplitudeAt(highPartials, 9000) > 0.01);
assert.ok(
  amplitudeAt(highPartials, 17100) < 0.0001,
  'ultrasonic partials do not alias',
);

assert.deepEqual(
  render([modulationProbe]),
  render([{ ...modulationProbe, modulationRate: 5, modulationDepth: 0 }]),
);
assert.deepEqual(
  render([modulationProbe]),
  render([{ ...modulationProbe, modulationRate: 0, modulationDepth: 1200 }]),
);
const modulated = render([
  { ...modulationProbe, modulationRate: 5, modulationDepth: 1200 },
]);

const crossings = (start: number, end: number) => {
  let count = 0;

  for (let i = Math.round(start * sampleRate); i < end * sampleRate; i++) {
    if (modulated[i - 1] <= 0 && modulated[i] > 0) count++;
  }

  return count;
};

assert.equal(modulated.length, render([modulationProbe]).length);
assert.ok(crossings(0.04, 0.06) > crossings(0.14, 0.16) * 3);
assert.ok(modulated.every(Number.isFinite));
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
const modulatedResonance = render([
  { ...resonating, modulationRate: 30, modulationDepth: 900 },
]);

assert.ok(modulatedResonance.every(Number.isFinite));
assert.notDeepEqual(modulatedResonance, render([resonating]));

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

// A filter path can rise and fall once without repeating vibrato.
const archSettings = {
  volume: 0.2,
  waveform: 'noise' as const,
  attack: 1,
  decay: 299,
  sustain: 1,
  release: 1,
  ring: 20,
  resonancePoints: [1000, 4000, 1000],
  filterDuration: 300,
};

const archSamples = render([archSettings]);

const archPeak = (time: number) => {
  const offset = Math.round(time * sampleRate);

  return analyzeSpectrum(archSamples.slice(offset - 512, offset + 512))
    .dominantFrequencyHz!;
};

assert.ok(archPeak(0.15) > 2 * archPeak(0.035));
assert.ok(archPeak(0.15) > 2 * archPeak(0.265));
assert.ok(Math.abs(archPeak(0.035) - archPeak(0.265)) < 300);
assert.deepEqual(
  render([{ ...resonating, resonancePoints: [] }]),
  render([resonating]),
);
assert.deepEqual(
  render([{ ...archSettings, resonance: 0, endResonance: 0 }]),
  archSamples,
  'curve endpoints override resolved editor defaults',
);
const heldPath = render([{ ...archSettings, filterDuration: 100 }]);

assert.ok(
  Math.abs(
    analyzeSpectrum(heldPath.slice(8820, 9844)).dominantFrequencyHz! - 1000,
  ) < 100,
  'the filter holds the final curve frequency after its duration',
);

// A pitch path preserves non-repeating bends and holds its final frequency.
const pitchPath = {
  volume: 0.2,
  attack: 1,
  decay: 499,
  sustain: 1,
  release: 1,
  pitchPoints: [800, 3200, 800],
  pitchDuration: 300,
};

const bentTone = render([pitchPath]);

const pitchAt = (time: number) => {
  const offset = Math.round(time * sampleRate);
  const crossings: number[] = [];

  for (let i = offset - 256; i < offset + 256; i++) {
    if (bentTone[i] <= 0 && bentTone[i + 1] > 0) {
      crossings.push(i - bentTone[i] / (bentTone[i + 1] - bentTone[i]));
    }
  }

  return (
    ((crossings.length - 1) * sampleRate) / (crossings.at(-1)! - crossings[0])
  );
};

assert.ok(pitchAt(0.15) > 2 * pitchAt(0.035));
assert.ok(Math.abs(pitchAt(0.035) - pitchAt(0.265)) < 100);
assert.ok(Math.abs(pitchAt(0.4) - 800) < 50);
assert.deepEqual(
  render([{ ...pitchPath, frequency: 100, endFrequency: 6000 }]),
  bentTone,
  'pitch points override editor frequency defaults',
);
assert.deepEqual(
  render([{ ...sustained, pitchPoints: [] }]),
  render([sustained]),
);

// Cascaded low-pass stages reject upper harmonics more steeply without
// changing existing one-stage sounds.
const filteredTone = { ...sustained, waveform: 'sine' as const, cutoff: 12000 };

const toneRms = (frequency: number, lowpassOrder: number) => {
  const samples = render([{ ...filteredTone, frequency, lowpassOrder }]).slice(
    1000,
  );

  return Math.sqrt(
    samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
  );
};

const lowAttenuation = toneRms(500, 4) / toneRms(500, 1);
const highAttenuation = toneRms(8000, 4) / toneRms(8000, 1);

assert.ok(lowAttenuation > 0.5);
assert.ok(highAttenuation < lowAttenuation / 10);
assert.deepEqual(
  render([{ ...filteredTone, lowpassOrder: 1 }]),
  render([filteredTone]),
);
const sweptStages = render([
  { ...filteredTone, lowpassOrder: 4, endCutoff: 0, release: 10 },
]);

assert.ok(sweptStages.every(Number.isFinite));
assert.equal(sweptStages.at(-1), 0);
