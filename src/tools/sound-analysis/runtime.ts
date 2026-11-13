import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSound } from '../sound-editor/parameters.ts';
import { render, sampleRate } from './render.ts';

export const readLayers = async (file: string) => {
  const value: unknown = file.endsWith('.json')
    ? JSON.parse(readFileSync(file, 'utf8'))
    : (await import(pathToFileURL(resolve(file)).href)).default;
  const layers = Array.isArray(value) ? value : [value];

  validateSound('sound', layers);
  return layers;
};

export const readFloat32 = (path: string) => {
  if (statSync(path).size > 4 * sampleRate * 10) {
    throw new Error('Trim the reference clip to at most 10 seconds.');
  }

  const bytes = readFileSync(path);

  if (!bytes.length || bytes.length % 4) {
    throw new Error(
      `Float32 PCM must contain complete four-byte samples: ${path}`,
    );
  }

  return Float32Array.from({ length: bytes.length / 4 }, (_, i) => {
    const sample = bytes.readFloatLE(i * 4);

    if (!Number.isFinite(sample)) {
      throw new Error(`Invalid PCM sample at index ${i}: ${path}`);
    }

    return sample;
  });
};

export const readReference = async ({
  file,
  onsetMs,
}: {
  file: string;
  onsetMs: number;
}) => {
  const clip = file.endsWith('.f32')
    ? readFloat32(file)
    : render(await readLayers(file));
  const onset = Math.round((onsetMs * sampleRate) / 1000);

  if (!Number.isFinite(onsetMs) || onsetMs < 0 || onset >= clip.length) {
    throw new Error(
      'The onset in milliseconds must fall inside the reference.',
    );
  }

  return {
    samples: clip.subarray(onset),
    ambience: clip.subarray(0, onset),
  };
};
