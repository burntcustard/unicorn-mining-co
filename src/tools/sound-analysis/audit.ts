import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolveSoundEffect } from '../../client/audio/synthesis.ts';
import { render, sampleRate } from './render.ts';
import { readLayers } from './runtime.ts';
import { analyzeSpectrum } from './spectrum.ts';
import { renderRepeats, summarizeTiming } from './timing.ts';

const { values, positionals: files } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean' },
    seed: { type: 'string', default: '1' },
    'repeat-ms': { type: 'string', default: '50' },
    'repeat-wav': { type: 'string' },
  },
});

if (values.help || !files.length) {
  console.log(
    'Usage: node audit.ts [--seed N] [--repeat-ms N] [--repeat-wav file.wav] sound.ts|sound.json [...]',
  );
} else {
  const repeatMs = Number(values['repeat-ms']);
  const seed = Number(values.seed);
  const output = values['repeat-wav'];

  if (!Number.isSafeInteger(seed)) {
    throw new Error('The seed must be an integer.');
  }

  if (output && files.length !== 1) {
    throw new Error('Choose one sound when exporting a repeat WAV.');
  }

  for (const file of files) {
    const layers = await readLayers(file);
    const samples = render(layers, seed);
    const { grid: _grid, ...spectrum } = analyzeSpectrum(samples);

    console.log(
      JSON.stringify(
        {
          file,
          seed,
          event: {
            ...summarizeTiming({ samples, repeatMs }),
            ...spectrum,
          },
          layers: layers.map((layer, index) => ({
            index,
            waveform: resolveSoundEffect(layer).waveform,
            ...summarizeTiming({ samples: render([layer], seed), repeatMs }),
          })),
        },
        null,
        2,
      ),
    );

    if (output) {
      const mix = renderRepeats({ samples, repeatMs });
      const wav = Buffer.alloc(44 + mix.length * 2);

      wav.write('RIFF');
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(sampleRate, 24);
      wav.writeUInt32LE(sampleRate * 2, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write('data', 36);
      wav.writeUInt32LE(mix.length * 2, 40);

      mix.forEach((sample, index) => {
        const pcm = Math.min(
          32767,
          Math.max(-32768, Math.round(sample * 32768)),
        );

        wav.writeInt16LE(pcm, 44 + index * 2);
      });

      writeFileSync(output, wav, { flag: 'wx' });
    }
  }
}
