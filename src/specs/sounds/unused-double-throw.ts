import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    waveform: 'noise',
    volume: 0.2,
    attack: 1,
    decay: 10,
    highpass: 1300,
    cutoff: 5900,
  },
  {
    volume: 0.16,
    frequency: 800,
    delay: 6,
    attack: 5,
    decay: 55,
  },
  {
    waveform: 'noise',
    volume: 0.12,
    delay: 39,
    attack: 1,
    decay: 8,
    highpass: 2400,
    cutoff: 6500,
  },
  {
    waveform: 'triangle',
    volume: 0.135,
    frequency: 1067,
    delay: 43,
    attack: 4,
    decay: 75,
  },
] satisfies SoundEffect[];
