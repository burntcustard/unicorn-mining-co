import { sampleRate } from './render.ts';

const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;

    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;

    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len,
      wr = Math.cos(a),
      wi = Math.sin(a);

    for (let s = 0; s < n; s += len) {
      let cr = 1,
        ci = 0;

      for (let k = 0; k < len / 2; k++) {
        const p = s + k,
          q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci,
          ti = re[q] * ci + im[q] * cr;

        re[q] = re[p] - tr;
        im[q] = im[p] - ti;
        re[p] += tr;
        im[p] += ti;
        const nr = cr * wr - ci * wi;

        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
};

const size = 1024;
const hop = 220;
const scale = (4 / size) ** 2;
const window = Float64Array.from(
  { length: size },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)),
);
const edges = [
  0,
  ...new Set(
    Array.from({ length: 49 }, (_, i) => Math.round((size / 2) ** (i / 48))),
  ),
];
const bands = edges.length - 1;
export const silenceDb = -100;

export const analyzeSpectrum = (samples: Float32Array) => {
  const grid: number[][] = [];
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const energyByBin = new Float64Array(size / 2);

  for (let i = 0; i < samples.length; i += hop) {
    for (let j = 0; j < size; j++) {
      re[j] = (samples[i - size / 2 + j] ?? 0) * window[j];
    }

    im.fill(0);
    fft(re, im);
    const column: number[] = [];

    for (let band = 0; band < bands; band++) {
      let energy = 0;

      for (let bin = edges[band]; bin < edges[band + 1]; bin++) {
        const value = re[bin] ** 2 + im[bin] ** 2;

        energy += value;
        energyByBin[bin] += value;
      }

      column.push(10 * Math.log10(Math.max(1e-10, energy * scale)));
    }

    grid.push(column);
  }

  let total = 0;
  let bass = 0;
  let bright = 0;
  let strongest = 0;

  energyByBin.forEach((energy, bin) => {
    const frequency = (bin * sampleRate) / size;

    total += energy;

    if (frequency < 200) bass += energy;

    if (frequency >= 4000) bright += energy;

    if (energy > energyByBin[strongest]) strongest = bin;
  });

  return {
    grid,
    dominantFrequencyHz: total
      ? Math.round((strongest * sampleRate) / size)
      : null,
    bassEnergyPercent: total ? (100 * bass) / total : 0,
    brightEnergyPercent: total ? (100 * bright) / total : 0,
  };
};

/**
 * Count differences above the recorded noise floor over both complete sounds.
 */
export const compareSpectrum = ({
  reference,
  ambience,
}: {
  reference: number[][];
  ambience: number[][];
}) => {
  const floor = Array.from({ length: bands }, (_, band) =>
    Math.max(-80, ...ambience.map((column) => column[band] + 3)),
  );

  return (candidate: number[][]) => {
    const length = Math.max(reference.length, candidate.length);
    let error = 0;

    for (let i = 0; i < length; i++) {
      for (let band = 0; band < bands; band++) {
        const target = Math.max(floor[band], reference[i]?.[band] ?? silenceDb);
        const actual = Math.max(floor[band], candidate[i]?.[band] ?? silenceDb);

        error += Math.abs(target - actual);
      }
    }

    return error / (reference.length * bands);
  };
};
