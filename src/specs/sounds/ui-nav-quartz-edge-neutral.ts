import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    waveform: 'triangle',
    volume: 0.216,
    attack: 0.8,
    decay: 24,
    release: 8,
    frequency: 1700,
    cutoff: 12800,
    endCutoff: 6300,
    filterDuration: 15,
  },
  {
    waveform: 'sine',
    volume: 0.072,
    attack: 0.5,
    decay: 9,
    release: 3,
    delay: 0.7,
    frequency: 2870,
    endFrequency: 2490,
    pitchDuration: 5,
  },
] satisfies SoundEffect[];
