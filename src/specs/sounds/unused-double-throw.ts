import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.2,
    attack: 1,
    decay: 10,
    cutoff: 5900,
    highpass: 1300,
  },
  {
    volume: 0.16,
    attack: 5,
    decay: 55,
    delay: 6,
    frequency: 800,
  },
  {
    volume: 0.12,
    attack: 1,
    decay: 8,
    delay: 39,
    cutoff: 6500,
    highpass: 2400,
  },
  {
    volume: 0.135,
    attack: 4,
    decay: 75,
    delay: 43,
    waveform: 'triangle',
    frequency: 1067,
  },
] satisfies SoundEffect[];
