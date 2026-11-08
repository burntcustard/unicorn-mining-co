import { parseArgs } from 'node:util';
import { writeSpectrogram } from './png.ts';
import { render } from './render.ts';
import { readLayers, readReference } from './runtime.ts';
import { analyzeSpectrum, compareSpectrum } from './spectrum.ts';
import { summarizeTiming } from './timing.ts';

const {
  values,
  positionals: [reference, ...candidates],
} = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean' },
    onset: { type: 'string', default: '0' },
    png: { type: 'string' },
  },
});

if (values.help || !reference) {
  console.log(
    'Usage: node compare.ts [--onset ms] [--png file.png] reference.f32|sound.ts|sound.json [candidate.ts|candidate.json ...]',
  );
} else {
  const { samples, ambience } = await readReference({
    file: reference,
    onsetMs: Number(values.onset),
  });

  const { grid, ...bands } = analyzeSpectrum(samples);

  const score = compareSpectrum({
    reference: grid,
    ambience: analyzeSpectrum(ambience).grid,
  });

  const plots = [grid];

  console.log(
    JSON.stringify({
      file: reference,
      ...summarizeTiming({ samples }),
      ...bands,
    }),
  );

  for (const file of candidates) {
    const samples = render(await readLayers(file));
    const { grid, ...bands } = analyzeSpectrum(samples);

    plots.push(grid);

    console.log(
      JSON.stringify({
        file,
        spectralErrorDb: score(grid),
        ...summarizeTiming({ samples }),
        ...bands,
      }),
    );
  }

  if (values.png) writeSpectrogram(values.png, plots);
}
