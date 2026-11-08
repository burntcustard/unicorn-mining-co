import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.14,
    frequency: 800,
    attack: 14,
    decay: 218,
    sustain: 0.12,
    release: 78,
  },
  {
    volume: 0.108,
    frequency: 754,
    endFrequency: 800,
    pitchDuration: 162,
    pitchCurve: 'ease-out',
    attack: 18,
    decay: 194,
    sustain: 0.13,
    release: 86,
  },
  {
    waveform: 'triangle',
    volume: 0.11,
    frequency: 1200,
    delay: 96,
    attack: 37,
    decay: 165,
    release: 72,
  },
  {
    volume: 0.073,
    frequency: 1600,
    delay: 146,
    attack: 37,
    decay: 166,
    release: 55,
  },
] satisfies SoundEffect[];
