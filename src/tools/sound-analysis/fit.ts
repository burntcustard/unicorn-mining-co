import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  resolveSoundEffect,
  type SoundEffect,
} from '../../client/audio/synthesis.ts';
import {
  compactOptional,
  effectParameters,
  type EffectNumberKey,
} from '../sound-editor/parameters.ts';
import { render } from './render.ts';
import { readLayers, readReference } from './runtime.ts';
import { analyzeSpectrum, compareSpectrum } from './spectrum.ts';

const {
  values,
  positionals: [reference, base, output],
} = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean' },
    onset: { type: 'string', default: '0' },
    passes: { type: 'string', default: '5' },
  },
});

if (values.help || !reference || !base || !output) {
  console.log(
    'Usage: node fit.ts [--onset ms] [--passes N] reference.f32|sound.ts|sound.json base.ts|base.json output.json',
  );
} else {
  const passes = Number(values.passes);

  if (!Number.isInteger(passes) || passes < 1 || passes > 12) {
    throw new Error('Choose 1 to 12 passes.');
  }

  if (!output.endsWith('.json')) {
    throw new Error('Choose a new .json output file.');
  }

  const { samples, ambience } = await readReference({
    file: reference,
    onsetMs: Number(values.onset),
  });

  const score = compareSpectrum({
    reference: analyzeSpectrum(samples).grid,
    ambience: analyzeSpectrum(ambience).grid,
  });

  const round = (number: number, key: EffectNumberKey) =>
    effectParameters[key].integer
      ? Math.round(number)
      : Math.round(number * 1000) / 1000;
  const keys = Object.keys(effectParameters) as EffectNumberKey[];

  const layers = (await readLayers(base)).map((layer) => {
    const compact = compactOptional(layer);

    for (const key of keys) {
      if (compact[key] !== undefined) compact[key] = round(compact[key], key);
    }

    return { ...compact, waveform: resolveSoundEffect(layer).waveform };
  });

  if (!layers.length) throw new Error('Start with at least one layer.');
  const seeds = layers.some(
    ({ waveform }) => waveform === 'noise' || waveform === 'crackle',
  )
    ? [1, 2]
    : [1];
  const loss = (layers: SoundEffect[]) =>
    seeds.reduce(
      (sum, seed) => sum + score(analyzeSpectrum(render(layers, seed)).grid),
      0,
    ) / seeds.length;

  const initialErrorDb = loss(layers);
  let spectralErrorDb = initialErrorDb;

  // Search the supplied structure with progressively smaller numeric edits.
  for (let pass = 0; pass < passes; pass++) {
    const fraction = 0.5 ** (pass + 1);

    for (const layer of layers) {
      for (const key of keys) {
        const start = layer[key];

        if (start === undefined) continue;
        const { min, max, step } = effectParameters[key];
        const delta = Math.max(step, Math.abs(start)) * fraction;

        for (const direction of [-1, 1]) {
          const next = round(
            Math.min(max, Math.max(min, start + direction * delta)),
            key,
          );
          const previous = layer[key];

          if (next === previous) continue;
          layer[key] = next;
          const error = loss(layers);

          if (error < spectralErrorDb) {
            spectralErrorDb = error;
          } else {
            layer[key] = previous;
          }
        }
      }
    }
  }

  writeFileSync(
    output,
    JSON.stringify(layers.map(compactOptional), null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({ output, initialErrorDb, spectralErrorDb, seeds }),
  );
}
