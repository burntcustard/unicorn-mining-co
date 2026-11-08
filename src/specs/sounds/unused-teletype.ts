import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    waveform: 'triangle',
    volume: 0.15,
    frequency: 1600,
    attack: 3,
    decay: 61,
  },
  {
    waveform: 'triangle',
    volume: 0.135,
    frequency: 1200,
    delay: 53,
    attack: 4,
    decay: 66,
  },
  {
    waveform: 'triangle',
    volume: 0.16,
    frequency: 1800,
    delay: 119,
    attack: 4,
    decay: 73,
  },
] satisfies SoundEffect[];
