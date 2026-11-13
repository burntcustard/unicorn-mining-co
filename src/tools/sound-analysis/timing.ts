import { sampleRate } from './render.ts';

export const repeatCount = 8;

const repeatOffset = (repeatMs: number) => {
  if (!Number.isFinite(repeatMs) || repeatMs <= 0 || repeatMs > 10000) {
    throw new Error('Use a positive repeat interval of at most 10000 ms.');
  }

  return Math.max(1, Math.round((repeatMs * sampleRate) / 1000));
};

export const renderRepeats = ({
  samples,
  repeatMs,
}: {
  samples: Float32Array;
  repeatMs: number;
}) => {
  const step = repeatOffset(repeatMs);
  const mix = new Float32Array(samples.length + step * (repeatCount - 1));

  for (let offset = 0; offset < step * repeatCount; offset += step) {
    samples.forEach((sample, i) => (mix[offset + i] += sample));
  }

  return mix;
};

export const summarizeTiming = ({
  samples,
  repeatMs = 50,
}: {
  samples: Float32Array;
  repeatMs?: number;
}) => {
  if (!samples.length) throw new Error('Timing analysis needs samples.');

  let peak = 0;
  let energy = 0;
  let energyAfterRepeat = 0;
  const repeatSample = repeatOffset(repeatMs);

  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];

    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite rendered sample at index ${i}.`);
    }

    peak = Math.max(peak, Math.abs(value));
    energy += value * value;

    if (i >= repeatSample) energyAfterRepeat += value * value;
  }

  let cumulative = 0;
  let energy99Sample = 0;
  let lastAbove40Db = -1;
  const threshold = peak * 0.01;

  for (let i = 0; i < samples.length; i++) {
    cumulative += samples[i] * samples[i];

    if (!energy99Sample && energy && cumulative >= energy * 0.99) {
      energy99Sample = i + 1;
    }

    if (Math.abs(samples[i]) > threshold) lastAbove40Db = i;
  }

  const repeatPeak =
    repeatSample < samples.length
      ? renderRepeats({ samples, repeatMs }).reduce(
          (peak, sample) => Math.max(peak, Math.abs(sample)),
          0,
        )
      : peak;

  return {
    durationMs: (samples.length / sampleRate) * 1000,
    peak,
    rms: Math.sqrt(energy / samples.length),
    energy99Ms: (energy99Sample / sampleRate) * 1000,
    lastAboveMinus40DbMs: ((lastAbove40Db + 1) / sampleRate) * 1000,
    energyAfterRepeatPercent: energy ? (energyAfterRepeat / energy) * 100 : 0,
    repeatMs,
    repeatPeak,
  };
};
