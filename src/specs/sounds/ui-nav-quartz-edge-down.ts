import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.216,
    attack: 0.8,
    decay: 24,
    release: 8,
    waveform: 'triangle',
    frequency: 1666,
    cutoff: 12800,
    endCutoff: 6300,
    filterDuration: 15,
  },
  {
    volume: 0.072,
    attack: 0.5,
    decay: 9,
    delay: 1,
    release: 3,
    frequency: 2870,
    endFrequency: 2490,
    pitchDuration: 5,
  },
] satisfies SoundEffect[];
