import type { SoundEffect } from '../../client/audio/synthesis';

export default [
  {
    volume: 0.12,
    attack: 10,
    decay: 31,
    waveform: 'pulse',
    pulseWidth: 0.22,
    frequency: 1200,
    cutoff: 3500,
  },
  {
    volume: 0.085,
    attack: 9,
    decay: 28,
    delay: 45,
    waveform: 'pulse',
    pulseWidth: 0.22,
    frequency: 1200,
    cutoff: 2600,
  },
] satisfies SoundEffect[];
